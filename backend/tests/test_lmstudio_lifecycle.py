"""100% mocked tests for on-demand LM Studio CLI (`lms`) lifecycle across all pipeline stages.

Verifies:
- `resolve_lms_binary()` Windows fallback discovery & `extract_json_from_cli_output` noise stripping.
- Full `analyze_job` lifecycle (`server status -> server start -> ls --json -> load -> inference -> unload --all -> server stop`).
- `pipeline_session()` + `topic_segmentation` CPU embedding (`--gpu off`) + immediate unload before LLM stage.
- `<150s` short video, `use_embeddings=False`, `block_embeddings_override`, and render-only runs never start LM Studio.
- Deterministic `unload --all` and `server stop` in `finally:` on exception or `OperationCancelledError`.
- `transcribe_job` and `render_job` call `ensure_idle_vram_released` before Whisper/FFmpeg touch VRAM.
- `/config/llm-models` and `/config/ollama-models` report LM Studio CLI installed models even when `:1234` is down, and `/config/llm-models/register` verifies via `stage()` + unloads/stops cleanly.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.application.orchestrator import run_job_pipeline
from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.domain.analysis.narrative_miner import analyze_job
from app.domain.rendering.rendering_service import RenderingService
from app.domain.segmentation.topic_segmentation import build_topic_segments, segment_blocks_into_topics
from app.domain.transcription.service import TranscriptionDomainService
from app.infrastructure.llm import lmstudio_cli
from app.infrastructure.llm.lmstudio_cli import (
    extract_json_from_cli_output,
    resolve_lms_binary,
)
from app.infrastructure.video.ffmpeg_executor import FFmpegNvencExecutor
from app.infrastructure.vision.face_tracker import FrameObservation
from app.models.domain import Cut, JobStatus, Segment, SemanticBlock


class FakeLmsHarness:
    """In-memory mock of `lms` CLI + `:1234/v1` HTTP server without real processes or network."""

    def __init__(
        self,
        *,
        server_running: bool = False,
        installed_models: list[dict[str, Any]] | None = None,
        loaded_models: list[dict[str, Any]] | None = None,
        chat_error: Exception | None = None,
        chat_status: int = 200,
    ) -> None:
        self.server_running = server_running
        self.installed_models = (
            list(installed_models)
            if installed_models is not None
            else [
                {
                    "modelKey": "google/gemma-4-e4b",
                    "type": "llm",
                    "sizeBytes": 5_200_000_000,
                },
                {
                    "modelKey": "text-embedding-nomic-embed-text-v1.5",
                    "type": "embedding",
                    "sizeBytes": 270_000_000,
                },
            ]
        )
        self.loaded_models: list[dict[str, Any]] = list(loaded_models or [])
        self.chat_error = chat_error
        self.chat_status = chat_status
        self.commands: list[list[str]] = []
        self.events: list[str] = []

    async def runner(self, args: list[str], timeout: float) -> tuple[int, str, str]:
        self.commands.append(list(args))
        self.events.append(f"lms:{' '.join(args)}")

        if args[:3] == ["server", "status", "--json"]:
            payload = json.dumps({"running": self.server_running})
            return 0, f"Checking server...\n{payload}\n", ""

        if args[:2] == ["server", "start"]:
            self.server_running = True
            return 0, "Starting local model service...\nServer started on port 1234.\n", ""

        if args[:2] == ["server", "stop"]:
            self.server_running = False
            self.loaded_models.clear()
            return 0, "Server stopped.\n", ""

        if args[:2] == ["ls", "--json"]:
            noisy = f"Scanning local models...\n{json.dumps(self.installed_models)}\n"
            return 0, noisy, ""

        if args[:2] == ["ps", "--json"]:
            if not self.server_running:
                return 1, "", "Server is not running"
            return 0, json.dumps(self.loaded_models), ""

        if args and args[0] == "load":
            model_key = args[1] if len(args) > 1 else ""
            gpu_val = None
            if "--gpu" in args:
                idx = args.index("--gpu")
                if idx + 1 < len(args):
                    gpu_val = args[idx + 1]
            self.loaded_models.append({"modelKey": model_key, "gpu": gpu_val})
            return 0, f"Loaded {model_key}", ""

        if args[:2] == ["unload", "--all"]:
            self.loaded_models.clear()
            return 0, "Unloaded all models.", ""

        return 1, "", f"Unsupported command: {args}"

    async def http_fetcher(
        self,
        method: str,
        url: str,
        body: dict[str, Any] | None = None,
    ) -> tuple[int, Any]:
        if ":11434" in url:
            raise httpx.ConnectError("Ollama offline in LM Studio lifecycle test")

        if not self.server_running:
            raise httpx.ConnectError("LM Studio HTTP server is stopped")

        if url.endswith("/models"):
            self.events.append("http:GET /models")
            return 200, {
                "data": [{"id": m["modelKey"]} for m in self.loaded_models if m.get("modelKey")]
            }

        if url.endswith("/embeddings"):
            self.events.append("http:POST /embeddings")
            texts = (body or {}).get("input") or []
            vectors: list[dict[str, Any]] = []
            for idx, _ in enumerate(texts):
                vec = [1.0, 0.0, 0.0] if idx < len(texts) // 2 else [0.0, 1.0, 0.0]
                vectors.append({"object": "embedding", "index": idx, "embedding": vec})
            return 200, {"data": vectors}

        if url.endswith("/chat/completions"):
            self.events.append("http:POST /chat/completions")
            if self.chat_error is not None:
                raise self.chat_error
            if self.chat_status != 200:
                return self.chat_status, {"error": "simulated failure"}
            user_content = ""
            for msg in (body or {}).get("messages") or []:
                if isinstance(msg, dict) and msg.get("role") == "user":
                    user_content = str(msg.get("content") or "")
            if "Responda apenas com: ok" in user_content:
                return 200, {"choices": [{"message": {"content": "ok"}}]}
            if "BOUNDARY LOOKAROUND" in user_content or "adjustments" in json.dumps(body or {}):
                return 200, {"choices": [{"message": {"content": json.dumps({"adjustments": []})}}]}
            cuts_payload = {
                "cuts": [
                    {
                        "title": "Corte Completo LM Studio",
                        "start_block_id": "b1",
                        "end_block_id": "b2",
                        "score": 94.0,
                        "beginning_hook": "Abertura direta.",
                        "middle_development": "Desenvolvimento claro.",
                        "end_conclusion": "Conclusão fechada.",
                        "hook_reason": "Gancho forte.",
                        "content_reason": "Arco completo.",
                    }
                ]
            }
            return 200, {"choices": [{"message": {"content": json.dumps(cuts_payload)}}]}

        return 404, {}

    def attach(self, container: ServiceContainer) -> None:
        container.lms_command_runner = self.runner
        container.llm_http_fetcher = self.http_fetcher


def test_resolve_lms_binary_windows_fallback_and_noise_json_stripping(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Windows `%USERPROFILE%\\.lmstudio\\bin\\lms.exe` fallback and noisy CLI JSON extraction."""
    lms_dir = tmp_path / ".lmstudio" / "bin"
    lms_dir.mkdir(parents=True, exist_ok=True)
    fake_lms = lms_dir / ("lms.exe" if os.name == "nt" else "lms")
    fake_lms.write_bytes(b"MZ")

    monkeypatch.setattr(lmstudio_cli.shutil, "which", lambda _name: None)
    monkeypatch.setattr(lmstudio_cli.Path, "home", classmethod(lambda cls: tmp_path))

    resolved = resolve_lms_binary()
    assert resolved == str(fake_lms)

    # Also verify PATH takes priority when available
    monkeypatch.setattr(lmstudio_cli.shutil, "which", lambda name: "C:/custom/lms.exe" if "lms" in name else None)
    assert resolve_lms_binary() == "C:/custom/lms.exe"

    # Noisy ANSI + diagnostic lines around JSON array/object
    noisy_array = (
        "\x1b[36mStarting local model service...\x1b[0m\n"
        "Loading catalog...\n"
        '[{"modelKey": "google/gemma-4-e4b", "type": "llm"}]\n'
        "Done."
    )
    parsed = extract_json_from_cli_output(noisy_array)
    assert isinstance(parsed, list)
    assert parsed[0]["modelKey"] == "google/gemma-4-e4b"

    noisy_obj = 'Booting daemon...\n{"running": true}\nFinished.'
    assert extract_json_from_cli_output(noisy_obj) == {"running": True}

    with pytest.raises(ValueError):
        extract_json_from_cli_output("no json payload here")


@pytest.mark.asyncio
async def test_analyze_job_full_lms_lifecycle_sequence(container: ServiceContainer) -> None:
    """Verify full on-demand lifecycle during `analyze_job`: start -> ls -> load -> infer -> unload --all -> server stop."""
    harness = FakeLmsHarness(server_running=False)
    harness.attach(container)

    container.update_tool_configs({"llm": {"model": "google/gemma-4-e4b", "provider": "lmstudio"}})

    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=lms1",
        status=JobStatus.ANALYZING,
        video_duration_seconds=90.0,
        video_name="Lms_Analyze",
    )
    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=30.0, text="Pergunta inicial importante sobre IA."),
        SemanticBlock(block_id="b2", start=30.5, end=75.0, text="Resposta completa com conclusão prática."),
    ]
    container.jobs.save_semantic_blocks(job.job_id, blocks)
    await build_topic_segments(job.job_id, container=container)

    result = await analyze_job(job.job_id, container=container)
    assert len(result["cuts"]) == 1
    assert container.jobs.load_job(job.job_id).status == JobStatus.WAITING_APPROVAL

    # Exact lifecycle ordering
    cmd_strs = [" ".join(c) for c in harness.commands]
    assert "server status --json" in cmd_strs
    assert "server start" in cmd_strs
    assert "ls --json" in cmd_strs
    load_cmds = [c for c in harness.commands if c and c[0] == "load"]
    assert len(load_cmds) == 1
    assert load_cmds[0][1] == "google/gemma-4-e4b"
    assert "-y" in load_cmds[0]

    # Inference happened AFTER load and BEFORE unload --all -> server stop
    idx_load = next(i for i, e in enumerate(harness.events) if e.startswith("lms:load "))
    idx_infer = next(i for i, e in enumerate(harness.events) if e == "http:POST /chat/completions")
    idx_unload = next(i for i, e in enumerate(harness.events) if e == "lms:unload --all")
    idx_stop = next(i for i, e in enumerate(harness.events) if e == "lms:server stop")
    assert idx_load < idx_infer < idx_unload < idx_stop

    assert harness.server_running is False
    assert harness.loaded_models == []


@pytest.mark.asyncio
async def test_long_video_pipeline_session_cpu_embedding_then_llm_and_stop_before_render(
    container: ServiceContainer,
) -> None:
    """Verify >=150s pipeline loads embedding with `--gpu off`, unloads before LLM, and stops server after analysis."""
    harness = FakeLmsHarness(server_running=False)
    harness.attach(container)
    container.update_tool_configs({"llm": {"model": "google/gemma-4-e4b", "provider": "lmstudio"}})

    video_dir = container.video_dir("job_lms_long", "Lms_Long")
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "video.mp4"
    video_file.write_bytes(b"FAKE_VIDEO")

    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=lms_long",
        job_id="job_lms_long",
        status=JobStatus.BUILDING_TOPICS,
        source_video_path=str(video_file),
        video_duration_seconds=220.0,
        video_name="Lms_Long",
    )
    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=35.0, text="Renda fixa e Tesouro Selic."),
        SemanticBlock(block_id="b2", start=35.5, end=70.0, text="Liquidez diária e proteção IPCA."),
        SemanticBlock(block_id="b3", start=70.5, end=105.0, text="Comparação entre CDB e LCI."),
        SemanticBlock(block_id="b4", start=105.5, end=140.0, text="Treino de hipertrofia na academia."),
        SemanticBlock(block_id="b5", start=140.5, end=175.0, text="Proteínas, creatina e sono."),
        SemanticBlock(block_id="b6", start=175.5, end=215.0, text="Conclusão sobre periodização."),
    ]
    container.jobs.save_semantic_blocks(job.job_id, blocks)

    final_job = await run_job_pipeline(job.job_id, include_render=False, container=container)
    assert final_job.status == JobStatus.WAITING_APPROVAL

    load_cmds = [c for c in harness.commands if c and c[0] == "load"]
    assert len(load_cmds) == 2

    emb_load, llm_load = load_cmds[0], load_cmds[1]
    assert emb_load[1] == "text-embedding-nomic-embed-text-v1.5"
    assert "--gpu" in emb_load and emb_load[emb_load.index("--gpu") + 1] == "off"

    assert llm_load[1] == "google/gemma-4-e4b"
    assert "--gpu" not in llm_load

    # Embedding unload happened BEFORE LLM load, and server stop happened ONLY at session end
    idx_emb_load = next(
        i for i, e in enumerate(harness.events) if e.startswith("lms:load text-embedding-nomic-embed-text-v1.5")
    )
    idx_emb_infer = next(i for i, e in enumerate(harness.events) if e == "http:POST /embeddings")
    idx_emb_unload = next(
        i for i, e in enumerate(harness.events) if i > idx_emb_infer and e == "lms:unload --all"
    )
    idx_llm_load = next(
        i for i, e in enumerate(harness.events) if e.startswith("lms:load google/gemma-4-e4b")
    )
    idx_llm_infer = next(i for i, e in enumerate(harness.events) if e == "http:POST /chat/completions")
    stop_indices = [i for i, e in enumerate(harness.events) if e == "lms:server stop"]

    assert idx_emb_load < idx_emb_infer < idx_emb_unload < idx_llm_load < idx_llm_infer
    assert len(stop_indices) == 1
    assert stop_indices[0] > idx_llm_infer
    assert harness.server_running is False
    assert harness.loaded_models == []


@pytest.mark.asyncio
async def test_short_video_and_non_embedding_paths_never_start_lmstudio(
    container: ServiceContainer,
) -> None:
    """Verify <150s short videos, use_embeddings=False, and overrides never touch `lms server start` or `load`."""
    harness = FakeLmsHarness(server_running=False)
    harness.attach(container)

    short_job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=short",
        status=JobStatus.BUILDING_TOPICS,
        video_duration_seconds=85.0,
        video_name="Short_Video",
    )
    short_blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=40.0, text="Bloco curto um."),
        SemanticBlock(block_id="b2", start=40.5, end=85.0, text="Bloco curto dois."),
    ]
    container.jobs.save_semantic_blocks(short_job.job_id, short_blocks)

    topics = await build_topic_segments(short_job.job_id, container=container)
    assert len(topics) == 1
    assert topics[0].topic_id == "t1"
    assert harness.commands == []

    # Long blocks with use_embeddings=False
    long_blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=90.0, text="Primeiro assunto."),
        SemanticBlock(block_id="b2", start=92.5, end=180.0, text="Segundo assunto."),
    ]
    await segment_blocks_into_topics(
        long_blocks,
        video_duration_seconds=180.0,
        use_embeddings=False,
        container=container,
    )
    assert harness.commands == []

    # Long blocks with block_embeddings_override
    await segment_blocks_into_topics(
        long_blocks,
        video_duration_seconds=180.0,
        use_embeddings=True,
        block_embeddings_override=[[1.0, 0.0], [0.0, 1.0]],
        container=container,
    )
    assert harness.commands == []

    # Render-only `run_job_pipeline` starting at WAITING_APPROVAL never opens pipeline_session / LM Studio
    from unittest.mock import patch
    from app.domain.rendering.rendering_service import get_rendering_service

    r_video_dir = container.video_dir("job_render_only", "Render_Only")
    r_video_dir.mkdir(parents=True, exist_ok=True)
    r_video_file = r_video_dir / "video.mp4"
    r_video_file.write_bytes(b"FAKE_VIDEO")
    r_job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=render_only",
        job_id="job_render_only",
        status=JobStatus.WAITING_APPROVAL,
        source_video_path=str(r_video_file),
        video_name="Render_Only",
        video_duration_seconds=120.0,
    )

    async def _fake_render_job(jid: str) -> list[str]:
        container.jobs.update_job_status(jid, JobStatus.DONE)
        return [f"/media/shorts/{jid}/00_00-00_30.mp4"]

    with patch.object(get_rendering_service(), "render_job", side_effect=_fake_render_job):
        done_job = await run_job_pipeline(r_job.job_id, include_render=True, container=container)
    assert done_job.status == JobStatus.DONE
    assert harness.commands == []


@pytest.mark.asyncio
async def test_cleanup_executes_in_finally_on_exception_and_cancellation(
    container: ServiceContainer,
) -> None:
    """Verify `unload --all` and `server stop` STILL run in `finally:` on inference errors or cancellation."""
    # 1. Runtime error during LLM inference
    err_harness = FakeLmsHarness(
        server_running=False,
        chat_error=RuntimeError("Simulated inference crash"),
    )
    err_harness.attach(container)
    container.update_tool_configs({"llm": {"model": "google/gemma-4-e4b", "provider": "lmstudio"}})

    job1 = container.jobs.create_job(
        "https://www.youtube.com/watch?v=err_case",
        status=JobStatus.ANALYZING,
        video_duration_seconds=80.0,
    )
    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=35.0, text="Primeiro bloco."),
        SemanticBlock(block_id="b2", start=35.5, end=75.0, text="Segundo bloco."),
    ]
    container.jobs.save_semantic_blocks(job1.job_id, blocks)
    await build_topic_segments(job1.job_id, container=container)

    with pytest.raises(RuntimeError, match="Simulated inference crash"):
        await analyze_job(job1.job_id, container=container)

    assert ["unload", "--all"] in err_harness.commands
    assert ["server", "stop"] in err_harness.commands
    assert err_harness.server_running is False
    assert err_harness.loaded_models == []

    # 2. Cooperative OperationCancelledError during run_job_pipeline analysis
    cancel_harness = FakeLmsHarness(
        server_running=False,
        chat_error=OperationCancelledError("job_cancel", "analysis"),
    )
    cancel_harness.attach(container)

    c_video_dir = container.video_dir("job_cancel_lms", "Cancel_Lms")
    c_video_dir.mkdir(parents=True, exist_ok=True)
    c_video_file = c_video_dir / "video.mp4"
    c_video_file.write_bytes(b"FAKE_VIDEO")

    job2 = container.jobs.create_job(
        "https://www.youtube.com/watch?v=cancel_case",
        job_id="job_cancel_lms",
        status=JobStatus.ANALYZING,
        source_video_path=str(c_video_file),
        video_name="Cancel_Lms",
        video_duration_seconds=80.0,
    )
    container.jobs.save_semantic_blocks(job2.job_id, blocks)
    await build_topic_segments(job2.job_id, container=container)

    await run_job_pipeline(job2.job_id, include_render=False, container=container)
    assert ["unload", "--all"] in cancel_harness.commands
    assert ["server", "stop"] in cancel_harness.commands
    assert cancel_harness.server_running is False
    assert cancel_harness.loaded_models == []


@pytest.mark.asyncio
async def test_transcription_and_render_release_idle_lmstudio_vram(
    container: ServiceContainer,
) -> None:
    """Verify `transcribe_job` and `render_job` call `ensure_idle_vram_released` before Whisper/FFmpeg."""
    # 1. Transcription releases idle LM Studio before loading WhisperModel
    tr_harness = FakeLmsHarness(
        server_running=True,
        loaded_models=[{"modelKey": "google/gemma-4-e4b", "gpu": "max"}],
    )
    tr_harness.attach(container)

    video_dir = container.video_dir("job_tr_lms", "Tr_Lms")
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "video.mp4"
    video_file.write_bytes(b"FAKE_VIDEO_BYTES")
    wav_file = container.jobs.transcriptions_dir_path("job_tr_lms", "Tr_Lms") / "audio_16k.wav"
    wav_file.write_bytes(b"RIFF0000WAVEfmt ")

    container.jobs.create_job(
        "https://www.youtube.com/watch?v=tr_lms",
        job_id="job_tr_lms",
        status=JobStatus.DOWNLOADED,
        source_video_path=str(video_file),
        video_name="Tr_Lms",
        video_duration_seconds=10.0,
    )

    events_order: list[str] = []

    class _FakeWhisperModel:
        def __init__(self, model_name: str, **kwargs: Any) -> None:
            events_order.append(f"whisper_init:server_running={tr_harness.server_running}")

        def transcribe(self, _audio: str, **kwargs: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
            return (
                [{"start": 0.0, "end": 4.0, "text": "Olá mundo teste.", "words": []}],
                {"duration": 10.0},
            )

    # Mock VRAM / CUDA / unloaders so zero nvidia-smi, CUDA DLLs, Ollama HTTP, or lms.exe subprocesses run
    vm = container.scheduler.vram_manager
    vm._vram_probe = lambda: 8.5
    vm._cuda_runtime_probe = lambda: (True, None)
    vm._ollama_unloader = lambda: []
    vm._lms_unloader = lambda: False
    vm._cuda_cache_clear = lambda: None

    tr_service = TranscriptionDomainService(container=container)
    from app.domain.transcription.service import FasterWhisperAdapter

    tr_service.whisper_adapter = FasterWhisperAdapter(model_factory=_FakeWhisperModel)
    await tr_service.transcribe_job("job_tr_lms")

    assert ["unload", "--all"] in tr_harness.commands
    assert ["server", "stop"] in tr_harness.commands
    assert tr_harness.server_running is False
    assert tr_harness.loaded_models == []
    assert events_order == ["whisper_init:server_running=False"]

    # 2. Rendering releases idle LM Studio before FFmpeg worker pool runs
    rd_harness = FakeLmsHarness(
        server_running=True,
        loaded_models=[{"modelKey": "google/gemma-4-e4b", "gpu": "max"}],
    )
    rd_harness.attach(container)

    r_video_dir = container.video_dir("job_rd_lms", "Rd_Lms")
    r_video_dir.mkdir(parents=True, exist_ok=True)
    r_video_file = r_video_dir / "video.mp4"
    r_video_file.write_bytes(b"FAKE_VIDEO_BYTES")

    container.jobs.create_job(
        "https://www.youtube.com/watch?v=rd_lms",
        job_id="job_rd_lms",
        status=JobStatus.WAITING_APPROVAL,
        source_video_path=str(r_video_file),
        video_name="Rd_Lms",
        video_duration_seconds=30.0,
    )
    container.jobs.save_cuts(
        "job_rd_lms",
        [
            Cut(
                cut_id="c1",
                block_ids=["b1"],
                start=0.0,
                end=12.0,
                title="Cut Render Guard",
                status="approved",
                approved=True,
                score=90.0,
            )
        ],
    )

    ffmpeg_saw_running: list[bool] = []

    async def _fake_ffmpeg_runner(cmd: list[str], on_log: Any, cancel_token: Any) -> int:
        ffmpeg_saw_running.append(rd_harness.server_running)
        out_path = Path(cmd[-1])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"FAKE_MP4")
        return 0

    rd_service = RenderingService(
        container=container,
        ffmpeg_executor=FFmpegNvencExecutor(container=container, subprocess_runner=_fake_ffmpeg_runner),
    )
    urls = await rd_service.render_job(
        "job_rd_lms",
        synthetic_observations_provider=lambda s, e: [
            FrameObservation(frame_index=0, timestamp=s, frame_width=1920, frame_height=1080, faces=[]),
            FrameObservation(frame_index=1, timestamp=e, frame_width=1920, frame_height=1080, faces=[]),
        ],
    )
    assert len(urls) == 1
    assert ["unload", "--all"] in rd_harness.commands
    assert ["server", "stop"] in rd_harness.commands
    assert rd_harness.server_running is False
    assert ffmpeg_saw_running == [False]


@pytest.mark.asyncio
async def test_config_llm_models_and_register_via_lms_cli_when_server_closed(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    """Verify `/config/llm-models` lists CLI-installed models when `:1234` is closed, and `/register` cleans up."""
    harness = FakeLmsHarness(server_running=False)
    harness.attach(container)

    for endpoint in ("/config/llm-models", "/config/ollama-models"):
        resp = await async_client.get(endpoint)
        assert resp.status_code == 200
        payload = resp.json()
        assert "google/gemma-4-e4b" in payload["models"]
        assert payload["localAvailable"] is True
        gemma_entry = next(c for c in payload["catalog"] if c["name"] == "google/gemma-4-e4b")
        assert gemma_entry["installed"] is True
        assert gemma_entry["running"] is False
        assert gemma_entry["provider"] == "lmstudio"
        assert gemma_entry["needsDownload"] is False
        # Embedding model excluded from chat LLM catalog
        assert all("nomic-embed" not in c["name"] for c in payload["catalog"])

    # Registering an LM Studio installed model when server is closed uses stage() to verify, then stops!
    reg_resp = await async_client.post(
        "/config/llm-models/register",
        json={"name": "google/gemma-4-e4b", "source": "local"},
    )
    assert reg_resp.status_code == 200
    assert reg_resp.json()["success"] is True
    assert ["server", "start"] in harness.commands
    assert ["unload", "--all"] in harness.commands
    assert ["server", "stop"] in harness.commands
    assert harness.server_running is False
    assert harness.loaded_models == []

"""Phase 6 (analysis v2) conditional vision: frames, eligibility, the model swap and the re-score.

100% mocked: the ffmpeg subprocess, the LM Studio CLI and its HTTP layer, the VRAM probe and the vision model are
fakes. Nothing here has ever run against a real model; these tests check the logic and the exact call order only.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import httpx
import pytest

from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.models import ScoreAnswers, ScoredCandidate
from app.domain.analysis.v2.pipeline import analyze_job_v2, resolve_stage_toggles, resolve_vision
from app.domain.analysis.v2.prompts import VISION_JSON_SCHEMA
from app.domain.analysis.v2.vision import eligible_for_vision, spoken_fraction
from app.infrastructure.vision import frames as frames_mod
from app.infrastructure.vision.frames import build_frame_command, extract_frames, frame_timestamps
from app.models.domain import JobStatus
from test_analysis_v2_pipeline import (
    MODEL,
    TURKISH,
    FakeLLM,
    _log_text,
    _scored,
    configure,
    good_answers,
    make_words,
    seed_job,
    user_text,
)
from test_lmstudio_lifecycle import FakeLmsHarness

VLM = "vl-test-8b"
N_CANDS = 6  # candidates S3 makes from the synthetic transcription
NOFRAME_FULL = {"brief": "llm", "units": "llm", "refine_boundaries": False}
FAKE_JPEG = b"\xff\xd8\xff fake jpeg"


# --- frames ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("count", range(C.VISION_FRAME_COUNT_MIN, C.VISION_FRAME_COUNT_MAX + 1))
@pytest.mark.parametrize("start,end", [(0.0, 60.0), (12.5, 13.5), (3600.0, 3722.25)])
def test_frame_timestamps_are_even_increasing_and_strictly_inside(count: int, start: float, end: float) -> None:
    stamps = frame_timestamps(start, end, count=count)
    assert len(stamps) == count
    assert all(start < t < end for t in stamps)
    assert stamps == sorted(set(stamps))
    gaps = [b - a for a, b in zip(stamps, stamps[1:])]
    assert max(gaps) - min(gaps) <= 0.0021  # evenly spaced up to the millisecond rounding
    # the first and last frame sit half a slice from the borders
    assert stamps[0] - start == pytest.approx(end - stamps[-1], abs=0.002)


def test_frame_timestamps_reject_bad_arguments() -> None:
    for bad in (C.VISION_FRAME_COUNT_MIN - 1, C.VISION_FRAME_COUNT_MAX + 1):
        with pytest.raises(ValueError):
            frame_timestamps(0.0, 10.0, count=bad)
    with pytest.raises(ValueError):
        frame_timestamps(5.0, 5.0, count=C.VISION_FRAME_COUNT)
    assert C.VISION_FRAME_COUNT_MIN <= C.VISION_FRAME_COUNT <= C.VISION_FRAME_COUNT_MAX


async def test_extract_frames_skips_failed_frames_and_pipes_jpeg_without_writing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    commands: list[list[str]] = []

    async def fake_ffmpeg(cmd: list[str]) -> tuple[int, bytes]:
        commands.append(cmd)
        n = len(commands)
        if n == 2:
            return 1, b""  # ffmpeg failed
        if n == 3:
            return 0, b""  # produced nothing
        if n == 4:
            raise OSError("ffmpeg vanished")
        return 0, FAKE_JPEG + bytes([n])

    monkeypatch.setattr(frames_mod, "run_ffmpeg_frame", fake_ffmpeg)
    video = tmp_path / "video.mp4"
    video.write_bytes(b"not a real video")
    before = sorted(p.name for p in tmp_path.iterdir())

    out = await extract_frames(video, [1.0, 2.0, 3.0, 4.0, 5.0], max_side_px=320)

    assert out == [FAKE_JPEG + b"\x01", FAKE_JPEG + b"\x05"]
    assert len(commands) == 5
    assert sorted(p.name for p in tmp_path.iterdir()) == before
    for cmd in commands:
        assert cmd[0] == "ffmpeg" and str(video) in cmd and cmd[-1] == "pipe:1"
        assert "image2pipe" in cmd and "mjpeg" in cmd
        assert not any(str(tmp_path) in a for a in cmd if a != str(video))  # no output path anywhere


def test_frame_command_limits_the_longer_side_and_seeks_before_the_input() -> None:
    cmd = build_frame_command("/v/x.mp4", 12.3456, max_side_px=512)
    assert cmd.index("-ss") < cmd.index("-i") and cmd[cmd.index("-ss") + 1] == "12.346"
    vf = cmd[cmd.index("-vf") + 1]
    assert "min(512\\,iw)" in vf and "min(512\\,ih)" in vf and "force_original_aspect_ratio=decrease" in vf


# --- eligibility ------------------------------------------------------------------------------------


def _cand(cid: str, *, interest: int = 4, visuals: bool = False, score: float | None = None, outcome: str = "pending",
          non_content: bool = False, answers: bool = True, start: float = 0.0) -> ScoredCandidate:
    ans = ScoreAnswers.model_validate(
        good_answers(interest=interest, depends_on_visuals=visuals, is_non_content=non_content)
    )
    return ScoredCandidate(
        candidate_id=cid, start_sentence_id="s1", end_sentence_id="s9", start=start, end=start + 40.0,
        answers=ans if answers else None, score=interest * 20.0 if score is None else score, outcome=outcome,
    )


def _eligible(scored: list[ScoredCandidate], fraction: float, **kw: Any) -> list[str]:
    return [
        c.candidate_id
        for c in eligible_for_vision(
            scored, spoken_fraction=fraction, min_interest=C.VISION_MIN_INTEREST,
            low_speech_threshold=C.VISION_LOW_SPEECH_FRACTION, **kw,
        )
    ]


def test_eligible_needs_depends_on_visuals_and_interest_for_speech_videos() -> None:
    scored = [
        _cand("k1", visuals=True, interest=4),
        _cand("k2", visuals=False, interest=5),  # speech does the work: not eligible
        _cand("k3", visuals=True, interest=C.VISION_MIN_INTEREST - 1),  # too little interest
        _cand("k4", visuals=True, interest=C.VISION_MIN_INTEREST),
        _cand("k5", visuals=True, answers=False),  # scoring error
        _cand("k6", visuals=True, outcome="rejected_gates"),  # superseded by a merge
    ]
    assert _eligible(scored, 0.9) == ["k1", "k4"]


def test_low_speech_videos_make_every_gate_relevant_candidate_eligible() -> None:
    scored = [
        _cand("k1", visuals=False, interest=4),
        _cand("k2", visuals=False, interest=C.VISION_MIN_INTEREST - 1),
        _cand("k3", visuals=False, interest=5, non_content=True),
        _cand("k4", visuals=True, interest=5),
    ]
    assert _eligible(scored, C.VISION_LOW_SPEECH_FRACTION - 0.01) == ["k4", "k1"]
    assert _eligible(scored, C.VISION_LOW_SPEECH_FRACTION) == ["k4"]  # the threshold itself is not low speech


def test_eligible_is_best_first_and_capped() -> None:
    scored = [_cand(f"k{i}", visuals=True, interest=3 + (i % 3), start=float(i)) for i in range(1, 15)]
    picked = _eligible(scored, 0.9)
    assert len(picked) == C.VISION_MAX_CANDIDATES
    by_id = {c.candidate_id: c for c in scored}
    scores = [by_id[i].score for i in picked]
    assert scores == sorted(scores, reverse=True)
    assert min(scores) >= max(c.score for c in scored if c.candidate_id not in picked)
    assert _eligible(scored, 0.9, max_candidates=2) == picked[:2]


def test_spoken_fraction_from_sentences() -> None:
    from app.domain.analysis.v2.models import Sentence

    sents = [Sentence(sentence_id=f"s{i}", start=i * 10.0, end=i * 10.0 + 4.0, text="x") for i in range(1, 6)]
    assert spoken_fraction(sents, 100.0) == pytest.approx(0.2)
    assert spoken_fraction(sents, None) == pytest.approx(20.0 / 54.0)
    assert spoken_fraction(sents, 10.0) == 1.0  # capped
    assert spoken_fraction([], 0.0) == 1.0 and spoken_fraction([], 50.0) == 0.0


def test_resolve_vision_and_the_key_is_not_an_unknown_toggle() -> None:
    warnings: list[str] = []
    assert resolve_vision(None) is False and resolve_vision({}) is False
    assert resolve_vision({"vision": True}) is True and resolve_vision({"vision": False}) is False
    assert resolve_vision({"vision": "yes"}, warnings.append) is False and warnings
    stage_warnings: list[str] = []
    resolve_stage_toggles({"vision": True}, stage_warnings.append)
    assert stage_warnings == []


# --- the pipeline ---------------------------------------------------------------------------------


class Rig(FakeLmsHarness):
    """Fake `lms` CLI + LM Studio HTTP + VRAM probe sharing one model state; records the ordered operations."""

    def __init__(
        self,
        container: ServiceContainer,
        fake: FakeLLM,
        *,
        vision: Callable[[dict[str, Any], int], Any] | None = None,
        vram_stuck: bool = False,
        installed: list[str] | None = None,
    ) -> None:
        keys = installed if installed is not None else [MODEL, VLM]
        super().__init__(
            installed_models=[{"modelKey": k, "type": "vlm" if k == VLM else "llm", "sizeBytes": 1} for k in keys]
        )
        self.container = container
        self.fake = fake
        self.vision = vision or (lambda body, n: self.default_vision())
        self.vram_stuck = vram_stuck
        self.ops: list[str] = []
        self.max_loaded = 0
        self.vision_bodies: list[dict[str, Any]] = []
        self.vision_calls = 0
        self.attach(container)
        container.scheduler.vram_manager._vram_probe = self.probe

    @staticmethod
    def default_vision() -> dict[str, Any]:
        return {
            "on_screen": "uma tela de jogo",
            "speech_refers_to_screen": True,
            "understandable_without_picture": False,
            "visual_summary": "o jogador derrota o chefe na tela",
        }

    def probe(self) -> float:
        self.ops.append("vram-check")
        return 1.0 if self.vram_stuck or self.loaded_models else 11.0

    def loaded_keys(self) -> list[str]:
        return [m["modelKey"] for m in self.loaded_models]

    async def runner(self, args: list[str], timeout: float) -> tuple[int, str, str]:
        result = await super().runner(args, timeout)
        if args and args[0] == "load":
            self.ops.append(f"load:{args[1]}")
        elif args[:2] == ["unload", "--all"]:
            self.ops.append("unload")
        self.max_loaded = max(self.max_loaded, len(self.loaded_models))
        return result

    async def http_fetcher(self, method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        if not url.endswith("/chat/completions"):
            return await super().http_fetcher(method, url, body)
        if not self.server_running:
            raise httpx.ConnectError("LM Studio HTTP server is stopped")
        body = body or {}
        schema = body["response_format"]["json_schema"]["schema"]
        if "on_screen" in schema.get("properties", {}):
            assert schema == VISION_JSON_SCHEMA
            self.ops.append("vlm-call")
            self.vision_bodies.append(body)
            self.vision_calls += 1
            answer = self.vision(body, self.vision_calls)
            if isinstance(answer, int):
                return answer, {"error": "vision failed"}
            return 200, {"choices": [{"message": {"content": json.dumps(answer)}}]}
        self.ops.append("text-call")
        status, payload = await self.fake._fetch("POST", "/api/chat", {"format": schema, "messages": body["messages"]})
        return status, payload

    def compact_ops(self) -> list[str]:
        out: list[str] = []
        for op in self.ops:
            if not out or out[-1] != op:
                out.append(op)
        return out


def _setup(container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, vision_toggle: bool = True,
           vision_model: str | None = VLM, video: bool = True, **rig_kw: Any) -> tuple[str, FakeLLM, Rig, list[list[str]]]:
    monkeypatch.setattr(C, "VISION_VRAM_CHECK_DELAY_SECONDS", 0.0)
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container, scoring=lambda ids: good_answers(depends_on_visuals=True))
    rig = Rig(container, fake, **rig_kw)
    commands: list[list[str]] = []

    async def fake_ffmpeg(cmd: list[str]) -> tuple[int, bytes]:
        commands.append(cmd)
        return 0, FAKE_JPEG

    monkeypatch.setattr(frames_mod, "run_ffmpeg_frame", fake_ffmpeg)
    video_path = tmp_path / "source_video.mp4"
    video_path.write_bytes(b"synthetic")
    monkeypatch.setattr(container.jobs, "find_source_video", lambda _jid: video_path if video else None)
    v2: dict[str, Any] = dict(NOFRAME_FULL)
    if vision_toggle:
        v2["vision"] = True
    extra: dict[str, Any] = {"vision_model": vision_model} if vision_model else {}
    configure(container, provider="auto", analysis_pipeline="v2", analysis_v2=v2, **extra)
    return jid, fake, rig, commands


def _cuts_bytes(container: ServiceContainer, jid: str) -> bytes:
    return (container.jobs.job_dir_path(jid) / "cuts.suggested.json").read_bytes()


async def test_toggle_absent_or_false_changes_nothing(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container, scoring=lambda ids: good_answers(depends_on_visuals=True))

    configure(container, analysis_pipeline="v2", analysis_v2=dict(NOFRAME_FULL))
    await analyze_job_v2(jid, container=container)
    cuts_a = _cuts_bytes(container, jid)
    scored_a = (container.jobs.job_dir_path(jid) / "candidates.scored.json").read_bytes()
    bodies_a = json.dumps(fake.bodies, sort_keys=True)
    log_a = _log_text(container, jid)
    assert "vision" not in json.loads(scored_a) and "vision" not in log_a.lower()

    fake.bodies.clear()
    configure(
        container, analysis_pipeline="v2", vision_model=VLM, analysis_v2={**NOFRAME_FULL, "vision": False}
    )
    await analyze_job_v2(jid, container=container)
    assert _cuts_bytes(container, jid) == cuts_a
    assert (container.jobs.job_dir_path(jid) / "candidates.scored.json").read_bytes() == scored_a
    assert json.dumps(fake.bodies, sort_keys=True) == bodies_a
    assert not any("image" in json.dumps(b) for b in fake.bodies)


async def test_toggle_true_without_a_vision_model_is_skipped_with_a_warning(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path, vision_model=None)
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert vision["skipped"] == "llm.vision_model is not set" and vision["applied"] is False
    assert "llm.vision_model is not set" in _log_text(container, jid)
    assert rig.vision_calls == 0 and not any(op.startswith("load:") and VLM in op for op in rig.ops)
    assert rig.ops.count("unload") == 1  # only the final stage exit


async def test_no_eligible_candidate_means_zero_extra_calls_and_no_model_swap(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, cmds = _setup(container, monkeypatch, tmp_path)
    fake.scoring = lambda ids: good_answers(depends_on_visuals=False)
    await analyze_job_v2(jid, container=container)

    vision = _scored(container, jid)["vision"]
    assert vision["skipped"] == "no eligible candidate" and vision["eligible"] == []
    assert rig.vision_calls == 0 and cmds == []
    assert [op for op in rig.ops if op.startswith("load:")] == [f"load:{MODEL}"]
    assert "vram-check" not in rig.ops and rig.ops.count("unload") == 1
    assert "Vision stage skipped" not in _log_text(container, jid)  # nothing went wrong, so no warning


async def test_eligible_candidates_run_the_exact_model_sequence(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, cmds = _setup(container, monkeypatch, tmp_path)
    await analyze_job_v2(jid, container=container)

    # text model loaded and used for S1-S4, then: unload, VRAM check, vision load, calls, unload, VRAM check,
    # text load, re-score, final unload.
    assert rig.compact_ops() == [
        f"load:{MODEL}", "text-call",
        "unload", "vram-check", f"load:{VLM}", "vlm-call",
        "unload", "vram-check", f"load:{MODEL}", "text-call",
        "unload",
    ]
    assert rig.max_loaded <= 1  # never two models loaded at once
    assert rig.loaded_keys() == []  # everything released at the end

    vision = _scored(container, jid)["vision"]
    assert vision["applied"] is True and vision["model"] == VLM and rig.vision_calls == len(vision["answers"]) == N_CANDS
    # every vision call carried the frames as data URIs, for the vision model
    for body in rig.vision_bodies:
        assert body["model"] == VLM
        parts = body["messages"][1]["content"]
        assert [p["type"] for p in parts] == ["text"] + ["image_url"] * C.VISION_FRAME_COUNT
    assert len(cmds) == N_CANDS * C.VISION_FRAME_COUNT
    # the re-score prompts carry the description of the picture
    rescored = [b for b in fake.calls("premise") if "ON SCREEN DURING THE CUT" in user_text(b)]
    assert len(rescored) == N_CANDS and all("o jogador derrota o chefe" in user_text(b) for b in rescored)


async def test_penalty_is_removed_only_for_described_candidates(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(C, "VISION_MAX_CANDIDATES", 2)
    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path)
    await analyze_job_v2(jid, container=container)

    scored = _scored(container, jid)
    described = set(scored["vision"]["answers"])
    assert len(described) == 2 and len(scored["candidates"]) == N_CANDS
    plain = 4 * C.SCORE_INTEREST_WEIGHT  # interest 4, payoff true
    for cand in scored["candidates"]:
        if cand["candidate_id"] in described:
            assert cand["score"] == plain  # penalty gone
            assert cand["before_vision"]["score"] == plain - C.SCORE_PENALTY_DEPENDS_ON_VISUALS
            assert cand["visual_summary"] and cand["answers"]["depends_on_visuals"] is True
        else:
            assert cand["score"] == plain - C.SCORE_PENALTY_DEPENDS_ON_VISUALS
            assert "before_vision" not in cand
    rescored = {r["candidate_id"]: r for r in scored["vision"]["rescored"]}
    assert set(rescored) == described
    assert all(r["score_after"] - r["score_before"] == C.SCORE_PENALTY_DEPENDS_ON_VISUALS for r in rescored.values())
    assert scored["vision"]["optional_prompt_hashes"]["vision_json_schema"]


async def test_vram_not_released_skips_vision_and_the_cuts_equal_the_text_only_run(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path, vram_stuck=True)
    await analyze_job_v2(jid, container=container)

    vision = _scored(container, jid)["vision"]
    assert vision["applied"] is False and vision["skipped"].startswith("VRAM was not released after unloading the text model")
    assert "Vision stage skipped: VRAM was not released" in _log_text(container, jid)
    assert rig.vision_calls == 0 and f"load:{VLM}" not in rig.ops
    assert rig.ops.count(f"load:{MODEL}") == 2 and rig.max_loaded <= 1  # the text model came back
    cuts_vision = _cuts_bytes(container, jid)

    # Same job, toggle off: identical cuts.
    configure(container, provider="auto", analysis_pipeline="v2", analysis_v2=dict(NOFRAME_FULL))
    await analyze_job_v2(jid, container=container)
    assert _cuts_bytes(container, jid) == cuts_vision
    assert "vision" not in _scored(container, jid)


async def test_one_failed_vision_call_keeps_the_original_score_of_that_candidate(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, _cmds = _setup(
        container, monkeypatch, tmp_path, vision=lambda body, n: 422 if n == 2 else Rig.default_vision()
    )
    await analyze_job_v2(jid, container=container)

    scored = _scored(container, jid)
    answers = scored["vision"]["answers"]
    failed = [cid for cid, a in answers.items() if "failed" in a]
    assert len(failed) == 1 and len(answers) == N_CANDS
    by_id = {c["candidate_id"]: c for c in scored["candidates"]}
    assert by_id[failed[0]]["score"] == 4 * C.SCORE_INTEREST_WEIGHT - C.SCORE_PENALTY_DEPENDS_ON_VISUALS
    assert "before_vision" not in by_id[failed[0]]
    assert len(scored["vision"]["rescored"]) == N_CANDS - 1 and scored["vision"]["applied"] is True
    assert f"candidate {failed[0]} skipped" in _log_text(container, jid)


async def test_invalid_vision_answer_is_recorded_as_a_failure(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bad = {"on_screen": "x", "speech_refers_to_screen": True, "understandable_without_picture": True, "visual_summary": "  "}
    jid, _fake, rig, _cmds = _setup(container, monkeypatch, tmp_path, vision=lambda body, n: bad)
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert all("failed" in a for a in vision["answers"].values()) and vision["skipped"] == "no candidate was described"
    assert vision["applied"] is False and rig.max_loaded <= 1


async def test_cancel_during_the_vision_stage_releases_everything(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    holder: dict[str, str] = {}

    def vision(body: dict[str, Any], n: int) -> Any:
        if n == 2:
            container.runtime.request_cancel(holder["jid"], "analysis")
        return Rig.default_vision()

    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path, vision=vision)
    holder["jid"] = jid
    container.runtime.create_cancel_token(jid, "analysis")
    before = _cuts_bytes_or_none(container, jid)

    with pytest.raises(OperationCancelledError):
        await analyze_job_v2(jid, container=container)

    assert rig.vision_calls == 2  # no call after the cancel
    assert rig.loaded_keys() == [] and rig.max_loaded <= 1
    assert rig.ops[-1] == "unload" and rig.ops.count(f"load:{MODEL}") == 1  # the text model never came back
    assert container.jobs.load_job(jid).status == JobStatus.DOWNLOADED
    assert _cuts_bytes_or_none(container, jid) == before
    assert not container.scheduler.gpu_mutex.locked


def _cuts_bytes_or_none(container: ServiceContainer, jid: str) -> bytes | None:
    p = container.jobs.job_dir_path(jid) / "cuts.suggested.json"
    return p.read_bytes() if p.exists() else None


async def test_missing_video_file_skips_vision_without_a_model_swap(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, cmds = _setup(container, monkeypatch, tmp_path, video=False)
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert vision["skipped"] == "the source video file was not found" and vision["eligible"]
    assert "Vision stage skipped: the source video file was not found" in _log_text(container, jid)
    assert cmds == [] and rig.vision_calls == 0 and "vram-check" not in rig.ops and rig.ops.count("unload") == 1


async def test_zero_extracted_frames_skip_vision_before_any_model_swap(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, cmds = _setup(container, monkeypatch, tmp_path)

    async def broken(cmd: list[str]) -> tuple[int, bytes]:
        cmds.append(cmd)
        return 1, b""

    monkeypatch.setattr(frames_mod, "run_ffmpeg_frame", broken)
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert vision["skipped"] == "zero frames could be extracted" and cmds
    assert rig.vision_calls == 0 and "vram-check" not in rig.ops and rig.ops.count("unload") == 1


async def test_vision_model_that_cannot_load_is_skipped_and_the_text_model_returns(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # The vision model is not installed: the CLI wrapper would fall back to another model, which must not describe frames.
    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path, installed=[MODEL, "other-model"])
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert vision["skipped"] == f"the vision model '{VLM}' could not be loaded" and vision["applied"] is False
    assert rig.vision_calls == 0 and rig.max_loaded <= 1 and rig.loaded_keys() == []
    assert rig.ops.count(f"load:{MODEL}") == 3  # text, the fallback the wrapper picked instead of the vision model, text again


async def test_vram_not_released_after_the_vision_model_discards_its_answers(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path)
    reads = {"n": 0}

    def probe() -> float:
        rig.ops.append("vram-check")
        reads["n"] += 1
        return 11.0 if reads["n"] == 1 else 1.0  # first check passes, every later one fails

    container.scheduler.vram_manager._vram_probe = probe
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert rig.vision_calls == N_CANDS and vision["applied"] is False
    assert vision["skipped"].startswith("VRAM was not released after unloading the vision model")
    assert all("before_vision" not in c for c in _scored(container, jid)["candidates"])
    assert not any("ON SCREEN DURING THE CUT" in user_text(b) for b in fake.calls("premise"))


async def test_vision_model_equal_to_the_text_model_needs_no_swap(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path, vision_model=MODEL, installed=[MODEL])
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert vision["applied"] is True and rig.vision_calls == N_CANDS
    assert rig.ops.count("unload") == 1 and "vram-check" not in rig.ops and rig.ops.count(f"load:{MODEL}") == 1


async def test_vision_needs_the_lmstudio_cli_stage_for_a_separate_model(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container, scoring=lambda ids: good_answers(depends_on_visuals=True))
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(container.jobs, "find_source_video", lambda _jid: video)
    configure(container, analysis_pipeline="v2", vision_model=VLM, analysis_v2={**NOFRAME_FULL, "vision": True})
    await analyze_job_v2(jid, container=container)
    vision = _scored(container, jid)["vision"]
    assert vision["skipped"].startswith("loading a separate vision model needs the LM Studio CLI")
    assert not any("image" in json.dumps(b) for b in fake.bodies)


def test_vision_model_key_is_preserved_by_the_config_normalizer() -> None:
    from app.core.tool_configs import normalize_llm_config

    assert normalize_llm_config({"vision_model": "  qwen-vl  "})["vision_model"] == "qwen-vl"
    assert "vision_model" not in normalize_llm_config({})
    assert "vision_model" not in normalize_llm_config({"vision_model": 5})
    assert "vision_model" not in normalize_llm_config({"vision_model": "  "})


async def test_s5_rescore_keeps_the_on_screen_block_of_a_described_candidate(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jid, fake, rig, _cmds = _setup(container, monkeypatch, tmp_path)
    fake.refine_start = lambda options, current: {"reason": "x", "start_sentence_id": options[0]}
    fake.refine_end = lambda options, current: {"reason": "x", "end_sentence_id": options[-1]}
    configure(
        container, provider="auto", analysis_pipeline="v2", vision_model=VLM,
        analysis_v2={**NOFRAME_FULL, "refine_boundaries": True, "vision": True},
    )
    await analyze_job_v2(jid, container=container)
    scored = _scored(container, jid)
    assert any(c.get("refined_from") for c in scored["candidates"]), "the refine fake must move at least one span"
    with_block = [b for b in fake.calls("premise") if "ON SCREEN DURING THE CUT" in user_text(b)]
    assert len(with_block) > N_CANDS  # the vision re-scores plus the S5 re-scores of described candidates
    for cand in scored["candidates"]:
        if cand.get("refined_from") and cand.get("visual_summary"):
            assert cand["score"] == 4 * C.SCORE_INTEREST_WEIGHT  # no penalty came back after the span moved


def test_frames_module_imports_first_in_a_fresh_interpreter() -> None:
    import subprocess
    import sys

    res = subprocess.run(
        [sys.executable, "-c", "import app.infrastructure.vision.frames"], capture_output=True, text=True, check=False
    )
    assert res.returncode == 0, res.stderr

"""Phase 5 Logical Tests: 3-Phase Narrative Arc Mining Engine, Boundary Lookaround, RMS Snap & Curation.

100% logical/in-memory/tmp_path tests using synthetic audio PCM arrays and mocked LLM adapters (ZERO hardware).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest

from app.application.runtime_service import ServiceContainer
from app.domain.analysis import (
    CandidateCut,
    apply_deterministic_lookaround_single,
    approve_cut,
    compute_rms_10ms,
    compute_temporal_iou,
    deduplicate_candidates_by_iou,
    find_nearest_zero_crossing,
    list_cuts,
    reject_cut,
    replace_cuts,
    run_phase_4b_top_k_lookaround,
    snap_cut_boundaries,
    snap_timestamp_to_rms_valley,
)
from app.infrastructure.llm.unified_adapter import (
    BOUNDARY_LOOKAROUND_JSON_SCHEMA,
    LocalLLMUnavailableError,
    UnifiedLocalLLMAdapter,
)
from app.models.domain import Cut, JobStatus, Segment, SemanticBlock, WordTiming


def test_pure_numpy_rms_10ms_energy_valley_and_zero_crossing_snap() -> None:
    """Verify pure-numpy 10ms RMS energy calculation, valley search, and zero-crossing alignment."""
    sample_rate = 16000
    duration_sec = 2.0
    total_samples = int(sample_rate * duration_sec)
    t = np.linspace(0, duration_sec, total_samples, endpoint=False, dtype=np.float32)

    # Synthetic waveform: 440Hz tone with an intentional silence/breath valley around 0.5s - 0.7s
    audio = np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
    # Valley from t=0.50s to t=0.70s (samples 8000 to 11200)
    audio[int(0.50 * sample_rate) : int(0.70 * sample_rate)] *= 0.005

    # 1. 10ms RMS frame calculation
    rms = compute_rms_10ms(audio, sample_rate=sample_rate)
    assert len(rms) == int(duration_sec * 100)
    # Frames 50..70 should have significantly lower energy
    valley_mean_rms = float(np.mean(rms[52:68]))
    tone_mean_rms = float(np.mean(rms[10:30]))
    assert valley_mean_rms < 0.1 * tone_mean_rms

    # 2. Zero-crossing locator
    sample_target = 8500
    zc_sample = find_nearest_zero_crossing(audio, sample_target, search_radius_samples=80)
    assert abs(zc_sample - sample_target) <= 80
    assert abs(float(audio[zc_sample])) < 0.05

    # 3. Snap timestamp to RMS valley
    target_time = 0.65
    snapped_t = snap_timestamp_to_rms_valley(
        target_time,
        window_before_sec=0.20,
        window_after_sec=0.10,
        pcm_samples=audio,
        rms_10ms=rms,
        sample_rate=sample_rate,
    )
    assert 0.50 <= snapped_t <= 0.70

    # 4. Snap cut boundaries with [-350ms, +50ms] at start and [-50ms, +450ms] at end
    snapped_start, snapped_end = snap_cut_boundaries(
        0.60,
        1.50,
        pcm_samples=audio,
        rms_10ms=rms,
        sample_rate=sample_rate,
    )
    assert 0.50 <= snapped_start <= 0.65
    assert snapped_end >= 1.45


def test_boundary_lookaround_start_backup_and_end_extension() -> None:
    """Verify Lookaround [-3, +3] backs up dependent/anaphoric starts and extends cut-off conclusions."""
    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=15.0, text="Apresentador dá boas-vindas ao podcast."),
        SemanticBlock(block_id="b2", start=15.5, end=30.0, text="Introduz o convidado e o tema de finanças."),
        # b3 is host question
        SemanticBlock(block_id="b3", start=30.5, end=42.0, text="Qual é o maior risco de investir sem reserva de emergência?", speaker="HOST"),
        # b4 is guest answer that starts anaphorically
        SemanticBlock(block_id="b4", start=42.5, end=58.0, text="Isso acontece porque as pessoas confundem liquidez com rentabilidade.", speaker="GUEST"),
        SemanticBlock(block_id="b5", start=58.5, end=75.0, text="Se você precisar do dinheiro no curto prazo, vai vender na baixa com prejuízo.", speaker="GUEST"),
        # b6 lacks sentence punctuation
        SemanticBlock(block_id="b6", start=75.5, end=92.0, text="E a melhor estratégia para se blindar disso", speaker="GUEST"),
        # b7 finishes the thought with conclusion marker
        SemanticBlock(block_id="b7", start=92.5, end=110.0, text="Resumindo, é manter 6 meses de custo fixo no Tesouro Selic.", speaker="GUEST"),
        SemanticBlock(block_id="b8", start=112.0, end=130.0, text="Agora falando sobre outro assunto completamente diferente.", speaker="HOST"),
    ]

    # Candidate extracted mid-thought from b4 to b6
    cand = CandidateCut(
        title="Risco de investir sem reserva",
        start_block_id="b4",
        end_block_id="b6",
        score=90.0,
    )

    adjusted = apply_deterministic_lookaround_single(cand, blocks, neighbor_k=3)
    # Start must back up to b3 (the question that b4's "Isso acontece porque" answers)
    assert adjusted.start_block_id == "b3"
    # End must extend to b7 (completes b6's thought and delivers the summary takeaway)
    assert adjusted.end_block_id == "b7"
    assert adjusted.block_ids == ["b3", "b4", "b5", "b6", "b7"]
    assert adjusted.start == pytest.approx(30.5)
    assert adjusted.end == pytest.approx(110.0)


@pytest.mark.asyncio
async def test_run_phase_4b_batched_llm_lookaround() -> None:
    """Verify Phase 4B batched LLM lookaround validates candidate cuts and refines boundaries."""
    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=10.0, text="Pergunta introdutória do apresentador?"),
        SemanticBlock(block_id="b2", start=10.5, end=25.0, text="Essa segunda regra é fundamental para o sucesso."),
        SemanticBlock(block_id="b3", start=25.5, end=40.0, text="Desenvolvimento do método passo a passo."),
        SemanticBlock(block_id="b4", start=40.5, end=55.0, text="Portanto, aplique essa técnica todo dia."),
    ]
    raw_cands = [
        CandidateCut(
            title="Segunda regra",
            start_block_id="b2",
            end_block_id="b3",
            score=92.0,
        )
    ]

    class FakeLLM(UnifiedLocalLLMAdapter):
        async def chat_json(self, system_prompt: str, user_prompt: str, **kwargs: Any) -> tuple[dict, str]:
            return {
                "adjustments": [
                    {
                        "candidate_index": 0,
                        "adjusted_start_block_id": "b1",
                        "adjusted_end_block_id": "b4",
                        "is_complete_story": True,
                        "reason": "Expanded to include question and closing summary.",
                    }
                ]
            }, "{}"

    adjusted = await run_phase_4b_top_k_lookaround(
        raw_cands,
        blocks,
        llm_adapter=FakeLLM(),
        use_llm_lookaround=True,
    )
    assert len(adjusted) == 1
    assert adjusted[0].start_block_id == "b1"
    assert adjusted[0].end_block_id == "b4"


def test_iou_deduplication_keeps_higher_score() -> None:
    """Verify IoU > 0.35 deduplication keeps higher scoring candidate and removes overlapping duplicates."""
    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=40.0, text="Bloco 1"),
        SemanticBlock(block_id="b2", start=40.0, end=80.0, text="Bloco 2"),
        SemanticBlock(block_id="b3", start=80.0, end=120.0, text="Bloco 3"),
        SemanticBlock(block_id="b4", start=120.0, end=160.0, text="Bloco 4"),
        SemanticBlock(block_id="b5", start=160.0, end=200.0, text="Bloco 5"),
    ]

    # cand1: [40, 120] (dur 80s)
    # cand2: [0, 80] (dur 80s) -> intersection [40, 80] (40s), union [0, 120] (120s) -> IoU = 40/120 = 0.333
    # cand3: [40, 160] (dur 120s) -> intersection with cand1 is [40, 120] (80s), union is 120s -> IoU = 80/120 = 0.667 (> 0.35)
    cand_low = CandidateCut(
        title="Low Score Overlap",
        start_block_id="b2",
        end_block_id="b3",
        score=65.0,
    )
    cand_high = CandidateCut(
        title="High Score Overlap",
        start_block_id="b2",
        end_block_id="b4",
        score=95.0,
    )
    cand_distinct = CandidateCut(
        title="Distinct Cut",
        start_block_id="b5",
        end_block_id="b5",
        score=85.0,
    )

    # IoU between cand_low and cand_high is > 0.35
    iou = compute_temporal_iou(40.0, 120.0, 40.0, 160.0)
    assert iou > 0.35

    deduped = deduplicate_candidates_by_iou([cand_low, cand_high, cand_distinct], blocks, iou_threshold=0.35)
    titles = [c.title for c in deduped]
    assert "High Score Overlap" in titles
    assert "Distinct Cut" in titles
    assert "Low Score Overlap" not in titles


@pytest.mark.asyncio
async def test_post_analyze_flow_and_auto_prerequisites(
    container: ServiceContainer,
    async_client: httpx.AsyncClient,
) -> None:
    """Verify `POST /jobs/{id}/analyze` auto-prepares blocks/topics if missing and persists cuts with WAITING_APPROVAL status."""
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=analyze999",
        status=JobStatus.DOWNLOADED,
        video_duration_seconds=120.0,
        video_name="Podcast_Investimentos",
    )
    segments = [
        Segment(segment_id="s1", start=0.0, end=15.0, text="Muita gente acha que investir em renda fixa é perder dinheiro."),
        Segment(segment_id="s2", start=16.0, end=35.0, text="Mas deixa eu te mostrar a conta real contra a inflação."),
        Segment(segment_id="s3", start=36.0, end=65.0, text="Descontando o imposto de renda, o retorno real é positivo."),
        Segment(segment_id="s4", start=66.0, end=95.0, text="Portanto, a regra prática é manter a reserva no Tesouro Selic."),
    ]
    container.jobs.save_transcription_segments(job.job_id, segments)

    # Mock LLM returning structured JSON matching CUTS_RESPONSE_JSON_SCHEMA
    mock_cuts_response = {
        "cuts": [
            {
                "title": "A conta real da Renda Fixa",
                "start_block_id": "b1",
                "end_block_id": "b2",
                "score": 96.0,
                "beginning_hook": "Abre com pergunta direta e contraintuitiva.",
                "middle_development": "Compara retorno líquido descontando inflação.",
                "end_conclusion": "Fecha com a regra prática de alocação.",
                "hook_reason": "Hook forte de quebra de padrão.",
                "content_reason": "Raciocínio completo.",
            }
        ]
    }

    async def _mock_llm(method: str, url: str, body: dict | None = None) -> tuple[int, Any]:
        if url.endswith("/models") or url.endswith("/api/tags") or url.endswith("/api/ps"):
            return 200, {"models": [{"name": "qwen2.5:14b"}]}
        if url.endswith("/chat/completions") or url.endswith("/api/chat"):
            return 200, {"message": {"content": json.dumps(mock_cuts_response)}}
        return 404, {}

    container.llm_http_fetcher = _mock_llm

    # Blocks and topics artifacts do not exist yet on disk
    assert not container.jobs.semantic_blocks_path(job.job_id).exists()
    assert not container.jobs.topic_segments_path(job.job_id).exists()

    resp = await async_client.post(f"/jobs/{job.job_id}/analyze")
    assert resp.status_code == 200
    data = resp.json()
    assert "cuts" in data
    assert len(data["cuts"]) == 1
    cut = data["cuts"][0]
    assert cut["cut_id"] == "c1"
    assert cut["title"] == "A conta real da Renda Fixa"
    assert cut["status"] == "pending"
    assert cut["score"] == 96.0
    assert cut["duration_seconds"] > 0

    # Verify automatic prerequisite generation and persistence
    assert container.jobs.semantic_blocks_path(job.job_id).exists()
    assert container.jobs.topic_segments_path(job.job_id).exists()
    assert container.jobs.cuts_path(job.job_id).exists()

    updated_job = container.jobs.load_job(job.job_id)
    assert updated_job.status == JobStatus.WAITING_APPROVAL


@pytest.mark.asyncio
async def test_cuts_curation_endpoints_get_put_approve_reject(
    container: ServiceContainer,
    async_client: httpx.AsyncClient,
) -> None:
    """Verify GET /jobs/:id/cuts, PUT /jobs/:id/cuts, and approve/reject endpoints."""
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=curation",
        status=JobStatus.WAITING_APPROVAL,
    )
    initial_cuts = [
        Cut(
            cut_id="c1",
            block_ids=["b1", "b2"],
            start=10.0,
            end=45.0,
            title="Corte Um",
            status="pending",
            score=88.0,
        ),
        Cut(
            cut_id="c2",
            block_ids=["b3", "b4"],
            start=50.0,
            end=95.0,
            title="Corte Dois",
            status="pending",
            score=82.0,
        ),
    ]
    container.jobs.save_cuts(job.job_id, initial_cuts)

    # 1. GET /jobs/:id/cuts
    get_res = await async_client.get(f"/jobs/{job.job_id}/cuts")
    assert get_res.status_code == 200
    assert len(get_res.json()) == 2
    assert get_res.json()[0]["cut_id"] == "c1"

    # 2. POST /jobs/:id/cuts/:cut_id/approve
    appr_res = await async_client.post(f"/jobs/{job.job_id}/cuts/c1/approve")
    assert appr_res.status_code == 200
    assert appr_res.json()["status"] == "approved"
    assert container.jobs.load_cuts(job.job_id)[0].status == "approved"

    # 3. POST /jobs/:id/cuts/:cut_id/reject
    rej_res = await async_client.post(f"/jobs/{job.job_id}/cuts/c2/reject")
    assert rej_res.status_code == 200
    assert rej_res.json()["status"] == "rejected"
    assert container.jobs.load_cuts(job.job_id)[1].status == "rejected"

    # 4. 404 on missing cut_id
    notfound_res = await async_client.post(f"/jobs/{job.job_id}/cuts/c999/approve")
    assert notfound_res.status_code == 404

    # 5. PUT /jobs/:id/cuts replaces the entire array
    replacement = [
        {
            "cut_id": "c1",
            "block_ids": ["b1"],
            "start": 12.0,
            "end": 40.0,
            "title": "Corte Editado Manualmente",
            "status": "approved",
            "score": 90.0,
        }
    ]
    put_res = await async_client.put(f"/jobs/{job.job_id}/cuts", json={"cuts": replacement})
    assert put_res.status_code == 200
    assert put_res.json()["ok"] is True
    saved = container.jobs.load_cuts(job.job_id)
    assert len(saved) == 1
    assert saved[0].title == "Corte Editado Manualmente"

    # 6. PUT /jobs/:id/cuts rejects non-array payload with 400
    bad_put = await async_client.put(f"/jobs/{job.job_id}/cuts", json={"cuts": "not-an-array"})
    assert bad_put.status_code == 400
    assert bad_put.json()["detail"] == "cuts must be an array"


@pytest.mark.asyncio
async def test_local_llm_unavailable_returns_503_error_envelope(
    container: ServiceContainer,
    async_client: httpx.AsyncClient,
) -> None:
    """Verify when local LLM (LM Studio and Ollama) are offline, POST /analyze returns 503 error envelope."""
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=offline",
        status=JobStatus.DOWNLOADED,
        video_duration_seconds=80.0,
    )
    container.jobs.save_semantic_blocks(
        job.job_id,
        [SemanticBlock(block_id="b1", start=0.0, end=30.0, text="Texto de teste.")],
    )
    container.jobs.save_topic_segments(
        job.job_id,
        [],
    )

    # Mock fetcher returns 503 / connection failure on all LLM URLs
    async def _failing_fetcher(method: str, url: str, body: dict | None = None) -> tuple[int, Any]:
        return 503, {"detail": "Connection refused"}

    container.llm_http_fetcher = _failing_fetcher

    resp = await async_client.post(f"/jobs/{job.job_id}/analyze")
    assert resp.status_code == 503
    payload = resp.json()
    assert "detail" in payload
    assert payload.get("error_code") == "LOCAL_LLM_UNAVAILABLE"
    assert payload.get("stage") == "ANALYZING"
    assert payload.get("recoverable") is True

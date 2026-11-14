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


def test_telemetry_briefing_adaptive_cadence_and_sparse_signal_tags() -> None:
    """Verify sparse signal_tags formatting and adaptive Telemetry Briefing without hardcoded ~90s."""
    from app.domain.analysis import (
        build_global_context_header,
        format_block_line,
    )
    from app.models.domain import TopicSegment

    plain_blk = SemanticBlock(block_id="b1", start=0.0, end=8.0, text="Abertura limpa.", speaker="SPEAKER_00")
    assert format_block_line(plain_blk) == "b1 [0.00-8.00] (SPEAKER_00): Abertura limpa."

    tagged_blk = SemanticBlock(
        block_id="b2",
        start=8.5,
        end=16.0,
        text="Cupom de desconto na descrição.",
        speaker="SPEAKER_01",
        signal_tags=["AD_CUE", "WPM_SHIFT"],
    )
    assert format_block_line(tagged_blk) == (
        "b2 [8.50-16.00] (SPEAKER_01) [AD_CUE, WPM_SHIFT]: Cupom de desconto na descrição."
    )

    # 1. Fast-paced multi-topic news roundup (median topic < 65s)
    news_blocks = [
        SemanticBlock(block_id=f"b{i+1}", start=i * 10.0, end=i * 10.0 + 9.0, text=f"Notícia {i+1}.", speaker=f"SPK_{i % 2}")
        for i in range(12)
    ]
    news_topics = [
        TopicSegment(
            topic_id=f"t{t+1}",
            start=t * 30.0,
            end=t * 30.0 + 29.0,
            block_ids=[f"b{t*3+1}", f"b{t*3+2}", f"b{t*3+3}"],
            blockCount=3,
            durationSeconds=29.0,
            embedding_backend="lmstudio_nomic",
        )
        for t in range(4)
    ]
    news_header = build_global_context_header(
        video_title="Resumo de Notícias",
        video_duration_seconds=120.0,
        topics=news_topics,
        blocks=news_blocks,
    )
    assert "Target Flexible Average Cut Duration" not in news_header
    assert "Block count: 12" in news_header
    assert "speaker count: 2" in news_header
    assert "embedding_backend: lmstudio_nomic" in news_header
    assert "Topic count: 4" in news_header
    assert "15s-65s" in news_header
    assert "multi-item / fast-paced roundup" in news_header.lower()

    # 2. Slow mono-topic essay
    essay_blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=45.0, text="Introdução longa.", speaker="HOST"),
        SemanticBlock(block_id="b2", start=46.0, end=105.0, text="Desenvolvimento profundo.", speaker="HOST"),
        SemanticBlock(block_id="b3", start=106.0, end=160.0, text="Conclusão final.", speaker="HOST"),
    ]
    essay_topics = [
        TopicSegment(
            topic_id="t1",
            start=0.0,
            end=160.0,
            block_ids=["b1", "b2", "b3"],
            blockCount=3,
            durationSeconds=160.0,
        )
    ]
    essay_header = build_global_context_header(
        video_title="Ensaio Longo",
        video_duration_seconds=160.0,
        topics=essay_topics,
        blocks=essay_blocks,
    )
    assert "45s-150s" in essay_header
    assert "mono-topic" in essay_header.lower()


def test_topic_aligned_windowing_8000_chars_and_oversized_topic_overlap() -> None:
    """Verify MAX_WINDOW_CHARS=8000, topic-aligned packing, and 25% overlap when one topic exceeds limit."""
    from app.domain.analysis import MAX_WINDOW_CHARS, build_overlapping_windows, format_block_line
    from app.models.domain import TopicSegment

    assert MAX_WINDOW_CHARS == 8000

    # Create 3 topics: t1 ~2800 chars, t2 ~2800 chars, t3 ~2800 chars (total ~8400 > 8000)
    blocks: list[SemanticBlock] = []
    topics: list[TopicSegment] = []
    for t_idx in range(3):
        t_bids: list[str] = []
        for k in range(5):
            b_idx = t_idx * 5 + k + 1
            bid = f"b{b_idx}"
            t_bids.append(bid)
            blocks.append(
                SemanticBlock(
                    block_id=bid,
                    start=float(b_idx * 10),
                    end=float(b_idx * 10 + 9),
                    text=f"Tópico {t_idx + 1} bloco {k + 1} " + ("palavra " * 68) + "fim.",
                )
            )
        topics.append(
            TopicSegment(
                topic_id=f"t{t_idx + 1}",
                start=float((t_idx * 5 + 1) * 10),
                end=float((t_idx * 5 + 5) * 10 + 9),
                block_ids=t_bids,
                blockCount=5,
                durationSeconds=49.0,
            )
        )

    windows = build_overlapping_windows(blocks, topics=topics, max_window_chars=MAX_WINDOW_CHARS)
    assert len(windows) >= 2
    for win in windows:
        win_chars = sum(len(format_block_line(b)) + 1 for b in win)
        assert win_chars <= MAX_WINDOW_CHARS
    # Topics are packed whole (no split inside t1, t2, or t3)
    win0_ids = {b.block_id for b in windows[0]}
    assert set(topics[0].block_ids).issubset(win0_ids)
    for tp in topics:
        assert any(set(tp.block_ids).issubset({b.block_id for b in w}) for w in windows)

    # Oversized single topic (> max_window_chars) is subdivided with overlap while small topics stay intact
    small_blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=10.0, text="Pequeno tópico um."),
        SemanticBlock(block_id="b2", start=10.5, end=20.0, text="Fim do pequeno tópico um."),
        SemanticBlock(block_id="b3", start=21.0, end=30.0, text="Gigante bloco A " + ("x" * 160)),
        SemanticBlock(block_id="b4", start=30.5, end=40.0, text="Gigante bloco B " + ("y" * 160)),
        SemanticBlock(block_id="b5", start=40.5, end=50.0, text="Gigante bloco C " + ("z" * 160)),
        SemanticBlock(block_id="b6", start=50.5, end=60.0, text="Gigante bloco D " + ("w" * 160)),
    ]
    mixed_topics = [
        TopicSegment(topic_id="t1", start=0.0, end=20.0, block_ids=["b1", "b2"], blockCount=2, durationSeconds=20.0),
        TopicSegment(topic_id="t2", start=21.0, end=60.0, block_ids=["b3", "b4", "b5", "b6"], blockCount=4, durationSeconds=39.0),
    ]
    sub_windows = build_overlapping_windows(small_blocks, topics=mixed_topics, max_window_chars=420)
    assert [b.block_id for b in sub_windows[0]] == ["b1", "b2"]
    assert len(sub_windows) >= 3
    # Consecutive sub-windows of t2 overlap on at least one block
    t2_wins = sub_windows[1:]
    assert set(b.block_id for b in t2_wins[0]) & set(b.block_id for b in t2_wins[1])


def test_evidence_first_v4_parsing_calibration_and_temporal_coverage_balancing() -> None:
    """Verify v4 Evidence-First parsing, deterministic calibration, and temporal coverage across >=3 topics."""
    from app.domain.analysis import finalize_cuts_phase_4c, parse_candidate_cuts_from_llm_payload
    from app.models.domain import TopicSegment

    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=15.0, text="O segredo da produtividade real."),
        SemanticBlock(block_id="b2", start=15.5, end=35.0, text="A resposta surpreende muita gente no final."),
        SemanticBlock(block_id="b3", start=36.0, end=50.0, text="Porque isso tudo muda seu dia", signal_tags=["AD_CUE"]),
        SemanticBlock(block_id="b4", start=51.0, end=65.0, text="Patrocinador exclusivo do canal", signal_tags=["AD_CUE"]),
        SemanticBlock(block_id="b5", start=66.0, end=80.0, text="Segundo assunto do vídeo começa aqui."),
        SemanticBlock(block_id="b6", start=80.5, end=95.0, text="Terceiro assunto começa bem."),
        SemanticBlock(block_id="b7", start=95.5, end=110.0, text="Quarto assunto tem ótimo desfecho."),
    ]
    topics = [
        TopicSegment(topic_id="t1", start=0.0, end=65.0, block_ids=["b1", "b2", "b3", "b4"], blockCount=4, durationSeconds=65.0),
        TopicSegment(topic_id="t2", start=66.0, end=80.0, block_ids=["b5"], blockCount=1, durationSeconds=14.0),
        TopicSegment(topic_id="t3", start=80.5, end=95.0, block_ids=["b6"], blockCount=1, durationSeconds=14.5),
        TopicSegment(topic_id="t4", start=95.5, end=110.0, block_ids=["b7"], blockCount=1, durationSeconds=14.5),
    ]

    v4_payload = {
        "cuts": [
            {
                "title": "Corte Limpo V4",
                "start_block_id": "b1",
                "end_block_id": "b2",
                "score": 85.0,
                "cut_type": "insight",
                "opening_evidence": "O segredo da produtividade real.",
                "closing_evidence": "A resposta surpreende muita gente no final.",
                "self_contained_start": True,
                "complete_resolution": True,
                "no_topic_drift": True,
                "novel_punchline": True,
            },
            {
                "title": "Corte Ruim AD + Incompleto",
                "start_block_id": "b3",
                "end_block_id": "b4",
                "score": 90.0,
                "cut_type": "insight",
                "opening_evidence": "Porque isso tudo muda seu dia",
                "closing_evidence": "Patrocinador exclusivo do canal",
                "self_contained_start": False,
                "complete_resolution": False,
                "no_topic_drift": False,
                "novel_punchline": False,
            },
        ]
    }

    parsed = parse_candidate_cuts_from_llm_payload(v4_payload, blocks, topics=topics)
    assert len(parsed) == 2

    clean, bad = parsed[0], parsed[1]
    assert clean.score == pytest.approx(90.0)  # 85 + 5 (novel_punchline)
    assert clean.beginning_hook == "O segredo da produtividade real."
    assert clean.end_conclusion == "A resposta surpreende muita gente no final."
    assert clean.topic_id == "t1"
    assert clean.predicates["novel_punchline"] is True

    # 90 - 15 - 15 - 10 - 25 (>50% AD_CUE) - 8 (starts with "Porque" & lacks terminal punct) = 17.0
    assert bad.score == pytest.approx(17.0)
    assert bad.predicates["self_contained_start"] is False

    # Temporal Coverage Balancing: 4 cuts clustered in t1 with higher score than t2, t3, t4
    t1_blocks = [
        SemanticBlock(block_id=f"tb{i+1}", start=i * 15.0, end=i * 15.0 + 14.0, text=f"Bloco {i+1}.")
        for i in range(7)
    ]
    bal_topics = [
        TopicSegment(topic_id="t1", start=0.0, end=59.0, block_ids=["tb1", "tb2", "tb3", "tb4"], blockCount=4, durationSeconds=59.0),
        TopicSegment(topic_id="t2", start=60.0, end=74.0, block_ids=["tb5"], blockCount=1, durationSeconds=14.0),
        TopicSegment(topic_id="t3", start=75.0, end=89.0, block_ids=["tb6"], blockCount=1, durationSeconds=14.0),
        TopicSegment(topic_id="t4", start=90.0, end=104.0, block_ids=["tb7"], blockCount=1, durationSeconds=14.0),
    ]
    clustered_cands = [
        CandidateCut(title="T1-A", start_block_id="tb1", end_block_id="tb1", score=98.0, topic_id="t1"),
        CandidateCut(title="T1-B", start_block_id="tb2", end_block_id="tb2", score=97.0, topic_id="t1"),
        CandidateCut(title="T1-C", start_block_id="tb3", end_block_id="tb3", score=96.0, topic_id="t1"),
        CandidateCut(title="T1-D", start_block_id="tb4", end_block_id="tb4", score=95.0, topic_id="t1"),
        CandidateCut(title="T2-A", start_block_id="tb5", end_block_id="tb5", score=84.0, topic_id="t2"),
        CandidateCut(title="T3-A", start_block_id="tb6", end_block_id="tb6", score=83.0, topic_id="t3"),
        CandidateCut(title="T4-A", start_block_id="tb7", end_block_id="tb7", score=82.0, topic_id="t4"),
    ]
    balanced_cuts = finalize_cuts_phase_4c(
        clustered_cands,
        t1_blocks,
        topics=bal_topics,
        max_suggested_cuts=4,
    )
    chosen_titles = {c.title for c in balanced_cuts}
    assert chosen_titles == {"T1-A", "T2-A", "T3-A", "T4-A"}


@pytest.mark.asyncio
async def test_phase_4b_micro_batching_det_adjusted_feed_and_regression_guards() -> None:
    """Verify Phase 4B splits >4 candidates into micro-batches, feeds det_adjusted, and blocks LLM regressions."""
    from app.core.config import config

    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=10.0, text="Qual é o segredo principal?", speaker="HOST"),
        SemanticBlock(block_id="b2", start=10.5, end=22.0, text="Isso acontece por causa do foco.", speaker="GUEST"),
        SemanticBlock(block_id="b3", start=22.5, end=35.0, text="Aqui está o exemplo sem ponto final", speaker="GUEST"),
        SemanticBlock(block_id="b4", start=35.5, end=48.0, text="E essa é a conclusão completa.", speaker="GUEST"),
        SemanticBlock(block_id="b5", start=48.5, end=60.0, text="Use o cupom DESCONTO10 agora.", speaker="HOST", signal_tags=["AD_CUE"]),
        SemanticBlock(block_id="b6", start=61.0, end=75.0, text="Segundo bloco independente.", speaker="HOST"),
        SemanticBlock(block_id="b7", start=76.0, end=90.0, text="Terceiro bloco independente.", speaker="HOST"),
        SemanticBlock(block_id="b8", start=91.0, end=105.0, text="Quarto bloco independente.", speaker="HOST"),
        SemanticBlock(block_id="b9", start=106.0, end=120.0, text="Quinto bloco independente.", speaker="HOST"),
        SemanticBlock(block_id="b10", start=121.0, end=135.0, text="Sexto bloco independente.", speaker="HOST"),
    ]

    # Candidate 0 starts on b2 (anaphoric) and ends on b3 (incomplete) -> det_adjusted expands to b1..b4!
    # Plus 5 more distinct candidates -> total 6 candidates -> must split into batches of [4, 2].
    raw_cands = [
        CandidateCut(title="C0", start_block_id="b2", end_block_id="b3", score=95.0),
        CandidateCut(title="C1", start_block_id="b6", end_block_id="b6", score=90.0),
        CandidateCut(title="C2", start_block_id="b7", end_block_id="b7", score=89.0),
        CandidateCut(title="C3", start_block_id="b8", end_block_id="b8", score=88.0),
        CandidateCut(title="C4", start_block_id="b9", end_block_id="b9", score=87.0),
        CandidateCut(title="C5", start_block_id="b10", end_block_id="b10", score=86.0),
    ]

    calls: list[tuple[dict[str, Any], int | None]] = []

    class _MockMicroBatchLLM(UnifiedLocalLLMAdapter):
        async def chat_json(self, system_prompt: str, user_prompt: str, **kwargs: Any) -> tuple[dict, str]:
            payload = json.loads(user_prompt)
            calls.append((payload, kwargs.get("max_tokens")))
            if len(calls) == 1:
                # Batch 0: LLM tries to regress C0 forward onto b2 (past backed-up question b1),
                # truncate C0 backward onto incomplete b3, AND extend C0 onto AD_CUE block b5.
                return {
                    "adjustments": [
                        {
                            "candidate_index": 0,
                            "adjusted_start_block_id": "b2",
                            "adjusted_end_block_id": "b3",
                            "is_complete_story": True,
                        },
                        {
                            "candidate_index": 1,
                            "adjusted_start_block_id": "b6",
                            "adjusted_end_block_id": "b5",  # wait, b5 is before b6, test AD_CUE on C0 separately
                            "is_complete_story": True,
                        },
                    ]
                }, "{}"
            return {"adjustments": []}, "{}"

    res = await run_phase_4b_top_k_lookaround(
        raw_cands,
        blocks,
        llm_adapter=_MockMicroBatchLLM(),
        use_llm_lookaround=True,
    )
    assert len(calls) == 2
    assert len(calls[0][0]["candidates"]) == 4
    assert len(calls[1][0]["candidates"]) == 2
    assert calls[0][1] == config.LLM_MAX_TOKENS_LOOKAROUND
    assert calls[1][1] == config.LLM_MAX_TOKENS_LOOKAROUND

    # Verify det_adjusted was fed to LLM (C0 already had start=b1, end=b4 in payload!)
    c0_sent = calls[0][0]["candidates"][0]
    assert c0_sent["start_block_id"] == "b1"
    assert c0_sent["end_block_id"] == "b4"

    # Regression guards prevented LLM from reverting C0 back to b2..b3
    c0_out = next(c for c in res if c.title == "C0")
    assert c0_out.start_block_id == "b1"
    assert c0_out.end_block_id == "b4"

    # Also test AD_CUE extension guard specifically
    class _MockAdExtendLLM(UnifiedLocalLLMAdapter):
        async def chat_json(self, system_prompt: str, user_prompt: str, **kwargs: Any) -> tuple[dict, str]:
            return {
                "adjustments": [
                    {
                        "candidate_index": 0,
                        "adjusted_start_block_id": "b1",
                        "adjusted_end_block_id": "b5",  # b5 has AD_CUE
                        "is_complete_story": True,
                    }
                ]
            }, "{}"

    ad_res = await run_phase_4b_top_k_lookaround(
        [CandidateCut(title="C0-AD", start_block_id="b1", end_block_id="b4", score=95.0)],
        blocks,
        llm_adapter=_MockAdExtendLLM(),
        use_llm_lookaround=True,
    )
    assert ad_res[0].end_block_id == "b4"


def test_rms_snap_prev_word_end_clamp_and_consonant_margin() -> None:
    """Verify RMS snap clamps start >= prev_word_end + 0.03 and <= first_w - 0.02 without absorbing adjacent short words."""
    sr = 16000
    t = np.arange(sr * 12, dtype=np.float32) / float(sr)
    # Deep silence valley at [9.55..9.80], short adjacent word "e" at [9.85..9.95],
    # brief pause [9.95..10.05], cut opening word "Fala" at [10.05..10.60]
    env = np.full_like(t, 0.002)
    env[(t >= 9.55) & (t <= 9.80)] = 0.0001  # tempting lowest RMS valley inside prior pause
    env[(t >= 9.85) & (t <= 9.95)] = 0.6     # short word "e"
    env[(t >= 10.05) & (t <= 10.60)] = 0.6   # first word of cut
    pcm = env * np.sin(2.0 * np.pi * 220.0 * t).astype(np.float32)

    words = [
        WordTiming(word="e", start=9.85, end=9.95),  # midpoint 9.90 -> outside 10.05 - 0.06 = 9.99!
        WordTiming(word="Fala", start=10.05, end=10.45),
        WordTiming(word="pessoal.", start=10.46, end=10.90),
    ]

    snapped_start, snapped_end = snap_cut_boundaries(
        10.05,
        10.90,
        words=words,
        pcm_samples=pcm,
        sample_rate=sr,
    )
    # Must NOT pull back into "e" (9.95) or the 9.70 valley; must clamp >= prev_word_end + 0.03 (9.98)
    assert snapped_start >= 9.98 - 1e-4
    # Must NOT advance past first_w - 0.02 (10.03) so opening consonant of "Fala" is never clipped
    assert snapped_start <= 10.03 + 1e-4
    assert snapped_end > 10.90


@pytest.mark.asyncio
async def test_end_to_end_stage3_to_stage4_telemetry_v4_lookaround_and_rms_snap(
    container: ServiceContainer,
) -> None:
    """End-to-end mocked Stage 3 -> Stage 4 integration test:
    build_semantic_blocks + build_topic_segments (>=150s, neural embeddings, signal_tags)
    -> analyze_job (Telemetry Briefing, v4 Evidence-First schema, micro-batched Lookaround, WAV+words RMS snap).
    """
    from app.domain.analysis.narrative_miner import analyze_job
    from app.domain.segmentation.semantic_blocks import build_semantic_blocks
    from app.domain.segmentation.topic_segmentation import build_topic_segments
    from app.infrastructure.audio.pcm_extractor import write_synthetic_pcm16_wav

    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=stage3to4e2e",
        status=JobStatus.BUILDING_BLOCKS,
        video_duration_seconds=200.0,
        video_name="Podcast_Tech_E2E",
    )

    segments = [
        Segment(
            segment_id="s1",
            start=1.0,
            end=20.0,
            text="Por que a arquitetura local de IA está mudando tudo?",
            speaker="HOST",
        ),
        Segment(
            segment_id="s2",
            start=21.8,
            end=55.0,
            text="Nesse caso você elimina custos de nuvem e mantém privacidade total.",
            speaker="GUEST",
        ),
        Segment(
            segment_id="s3",
            start=56.5,
            end=85.0,
            text="Portanto a lição prática é rodar modelos quantizados na GPU local.",
            speaker="GUEST",
        ),
        Segment(
            segment_id="s4",
            start=87.0,
            end=115.0,
            text="Antes de seguir, use o cupom LOCAL20 no link na descrição para patrocinar o canal.",
            speaker="HOST",
        ),
        Segment(
            segment_id="s5",
            start=117.0,
            end=155.0,
            text="Agora falando sobre culinária italiana e fermentação natural de massas.",
            speaker="HOST",
        ),
        Segment(
            segment_id="s6",
            start=156.5,
            end=195.0,
            text="Deixar a massa descansar por 48 horas transforma completamente a textura.",
            speaker="GUEST",
        ),
    ]
    words = [
        WordTiming(word="Por", start=1.0, end=1.3, segment_id="s1", speaker="HOST"),
        WordTiming(word="tudo?", start=19.4, end=19.9, segment_id="s1", speaker="HOST"),
        WordTiming(word="Nesse", start=21.8, end=22.2, segment_id="s2", speaker="GUEST"),
        WordTiming(word="total.", start=54.3, end=54.9, segment_id="s2", speaker="GUEST"),
        WordTiming(word="Portanto", start=56.5, end=57.0, segment_id="s3", speaker="GUEST"),
        WordTiming(word="local.", start=84.3, end=84.9, segment_id="s3", speaker="GUEST"),
        WordTiming(word="Agora", start=117.0, end=117.4, segment_id="s5", speaker="HOST"),
        WordTiming(word="massas.", start=154.2, end=154.8, segment_id="s5", speaker="HOST"),
        WordTiming(word="Deixar", start=156.5, end=157.0, segment_id="s6", speaker="GUEST"),
        WordTiming(word="textura.", start=194.2, end=194.8, segment_id="s6", speaker="GUEST"),
    ]
    container.jobs.save_transcription_segments(job.job_id, segments)
    container.jobs.save_transcription_words(job.job_id, words)

    # Synthetic 200s 16kHz mono WAV with loud speech bands and quiet valleys near cut boundaries
    sr = 16000
    total_samples = sr * 200
    t = np.arange(total_samples, dtype=np.float32) / float(sr)
    env = np.full(total_samples, 0.002, dtype=np.float32)
    for seg in segments:
        lo = int(seg.start * sr)
        hi = min(total_samples, int(seg.end * sr))
        env[lo:hi] = 0.45
    # Quiet breathing valley right before s1 (0.70..0.96s) and after s3 (85.05..85.30s)
    env[int(0.70 * sr) : int(0.96 * sr)] = 0.0001
    env[int(85.05 * sr) : int(85.30 * sr)] = 0.0001
    pcm = env * np.sin(2.0 * np.pi * 220.0 * t).astype(np.float32)
    wav_path = container.jobs.audio_16k_path(job.job_id)
    write_synthetic_pcm16_wav(wav_path, pcm, sample_rate=sr)

    chat_requests: list[dict[str, Any]] = []

    async def _mock_e2e_fetcher(
        method: str, url: str, body: dict[str, Any] | None = None
    ) -> tuple[int, Any]:
        if url.endswith("/models"):
            return 200, {"data": [{"id": "qwen2.5-14b-instruct"}]}
        if url.endswith("/api/tags") or url.endswith("/api/ps"):
            return 200, {"models": [{"name": "qwen2.5:14b"}]}
        if url.endswith("/api/embed") and body is not None:
            n_in = len(body["input"])
            # Distinct topic vectors: [b1..b3] tech, [b4] ad, [b5, b6] cooking
            vecs = []
            for idx in range(n_in):
                if idx < 3:
                    vecs.append([1.0, 0.0, 0.0])
                elif idx == 3:
                    vecs.append([0.0, 1.0, 0.0])
                else:
                    vecs.append([0.0, 0.0, 1.0])
            return 200, {"embeddings": vecs}
        if (url.endswith("/chat/completions") or url.endswith("/api/chat")) and body is not None:
            chat_requests.append(body)
            fmt = body.get("response_format") or body.get("format") or {}
            schema_name = (
                fmt.get("json_schema", {}).get("name")
                if isinstance(fmt, dict) and "json_schema" in fmt
                else None
            )
            user_msg = body["messages"][-1]["content"]
            if schema_name == "boundary_lookaround" or "preceding_blocks" in user_msg:
                # Lookaround receives det_adjusted candidate 0 already backed up to b1 (question) and extended to b3 (Portanto...)
                parsed_in = json.loads(user_msg)
                assert parsed_in["candidates"][0]["start_block_id"] == "b1"
                assert parsed_in["candidates"][0]["end_block_id"] == "b3"
                return 200, {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "adjustments": [
                                            {
                                                "candidate_index": 0,
                                                "adjusted_start_block_id": "b1",
                                                "adjusted_end_block_id": "b3",
                                                "is_complete_story": True,
                                                "reason": "Question + answer + conclusion intact.",
                                            }
                                        ]
                                    }
                                )
                            }
                        }
                    ]
                }

            # Phase 4A: deliberate cut starting on b2 (anaphoric "Nesse caso...") and ending on b2
            # so Phase 4B Lookaround backs up to b1 (question) and extends to b3 ("Portanto...")
            v4_resp = {
                "cuts": [
                    {
                        "title": "Por que IA Local Muda Tudo",
                        "start_block_id": "b2",
                        "end_block_id": "b2",
                        "score": 91.0,
                        "cut_type": "qa_insight",
                        "opening_evidence": "Nesse caso você elimina custos de nuvem",
                        "closing_evidence": "mantém privacidade total.",
                        "self_contained_start": True,
                        "complete_resolution": True,
                        "no_topic_drift": True,
                        "novel_punchline": True,
                        "beginning_hook": "Explica a vantagem da IA local.",
                        "middle_development": "Elimina custos e protege dados.",
                        "end_conclusion": "Regra prática com modelos quantizados.",
                        "hook_reason": "Pergunta forte do host.",
                        "content_reason": "Resposta completa do convidado.",
                    },
                    {
                        "title": "Segredo da Fermentação 48h",
                        "start_block_id": "b5",
                        "end_block_id": "b6",
                        "score": 84.0,
                        "cut_type": "tip",
                        "opening_evidence": "Agora falando sobre culinária italiana",
                        "closing_evidence": "transforma completamente a textura.",
                        "self_contained_start": True,
                        "complete_resolution": True,
                        "no_topic_drift": True,
                        "novel_punchline": False,
                        "beginning_hook": "Abertura direta sobre massas.",
                        "middle_development": "Explica o descanso de 48h.",
                        "end_conclusion": "Fecha com impacto na textura.",
                        "hook_reason": "Gancho culinário direto.",
                        "content_reason": "Dica prática completa.",
                    },
                ]
            }
            return 200, {"choices": [{"message": {"content": json.dumps(v4_resp)}}]}
        return 404, {}

    container.llm_http_fetcher = _mock_e2e_fetcher

    # Stage 3A: build_semantic_blocks
    blocks = build_semantic_blocks(job.job_id, container=container)
    assert len(blocks) == 6
    assert any("AD_CUE" in b.signal_tags for b in blocks)
    assert all(b.wpm is not None and b.wpm > 0 for b in blocks)
    assert all(b.noise_floor_p10 is not None for b in blocks)

    # Stage 3B: build_topic_segments (>=150s with mocked neural embeddings)
    topics = await build_topic_segments(job.job_id, container=container)
    assert len(topics) >= 2
    assert all(tp.embedding_backend == "neural" for tp in topics)
    assert any(tp.topic_type == "ad_span" for tp in topics)

    # Stage 4: analyze_job (Phase 4A Telemetry + v4 -> Phase 4B Lookaround -> Phase 4C RMS snap)
    result = await analyze_job(job.job_id, container=container)
    cuts = result["cuts"]
    assert len(cuts) == 2

    # Verify Telemetry Briefing & v4 system prompt in Phase 4A request
    phase_4a_req = chat_requests[0]
    assert "Evidence-First" in phase_4a_req["messages"][0]["content"] or "opening_evidence" in phase_4a_req["messages"][0]["content"]
    user_4a = phase_4a_req["messages"][1]["content"]
    assert "=== TELEMETRY BRIEFING & GLOBAL CONTEXT ===" in user_4a
    assert "embedding_backend: neural" in user_4a
    assert "AD_CUE" in user_4a

    # Verify Phase 4B Lookaround fired and backed up b2 -> b1 and extended to b3
    assert len(chat_requests) == 2
    tech_cut = next(c for c in cuts if c.title == "Por que IA Local Muda Tudo")
    assert tech_cut.block_ids == ["b1", "b2", "b3"]
    assert tech_cut.score == pytest.approx(88.0)  # 91 + 5 (novel_punchline=True) - 8 (initial anaphoric "Nesse caso...")
    # Verify RMS snap adjusted boundaries safely near word edges (<= 0.99s start, >= 84.9s end)
    assert 0.65 <= tech_cut.start <= 0.99
    assert 84.9 <= tech_cut.end <= 85.5

    reloaded_job = container.jobs.load_job(job.job_id)
    assert reloaded_job.status == JobStatus.WAITING_APPROVAL
    assert container.jobs.cuts_path(job.job_id).exists()



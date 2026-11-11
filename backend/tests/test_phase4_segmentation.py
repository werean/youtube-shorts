"""Phase 4 Logical Tests: Discourse-Aware Semantic Blocks & Contextual TextTiling (`domain/segmentation`).

100% logical/in-memory/tmp_path tests using mocked embedding vectors and HTTP fetchers (ZERO hardware).
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.application.runtime_service import ServiceContainer
from app.domain.segmentation import (
    build_semantic_blocks,
    build_sliding_windows,
    build_topic_segments,
    compute_depth_scores,
    compute_lexical_tfidf_embeddings,
    compute_window_similarities,
    group_segments_into_semantic_blocks,
    select_boundaries_by_depth,
    starts_with_blocking_connective,
)
from app.models.domain import JobStatus, Segment, SemanticBlock, WordTiming


def test_blocking_connectives_pt_and_en_prevent_false_block_openings() -> None:
    """Verify PT/EN dependent connectives and lowercase continuations never start a new block."""
    for phrase in (
        "Mas isso muda completamente o cálculo no longo prazo.",
        "Porém, quase ninguém faz essa conta antes de investir.",
        "Então você acaba pagando imposto demais.",
        "Porque a taxa real desconta a inflação acumulada.",
        "Como eu disse antes, liquidez não é rentabilidade.",
        "Ou seja, o risco estava escondido no contrato.",
        "However, the real return is much lower after taxes.",
        "Therefore, you should diversify early.",
        "Because compound interest needs time to work.",
        "so that is why we wait for confirmation.",
        "continuando a frase anterior em letra minúscula.",
    ):
        assert starts_with_blocking_connective(phrase) is True, f"Should block: {phrase}"

    for independent in (
        "Muita gente acha que investir em renda fixa é perder dinheiro.",
        "Agora falando sobre o segundo erro mais comum na carteira.",
        "What is the best strategy for beginners?",
        "A regra prática para montar sua reserva é simples.",
    ):
        assert starts_with_blocking_connective(independent) is False, f"Should allow: {independent}"

    segments = [
        Segment(
            segment_id="s1",
            start=0.0,
            end=7.5,
            text="Muita gente acredita que o Tesouro Selic rende pouco.",
            speaker="SPEAKER_00",
        ),
        # Even after a 1.0s pause and >5s duration, "Mas" must NOT open a new block
        Segment(
            segment_id="s2",
            start=8.5,
            end=14.0,
            text="Mas quando você desconta a volatilidade, ele protege o caixa.",
            speaker="SPEAKER_00",
        ),
        # "Porque" also continues the same reasoning
        Segment(
            segment_id="s3",
            start=14.8,
            end=20.2,
            text="Porque você consegue aproveitar oportunidades na baixa.",
            speaker="SPEAKER_00",
        ),
        # Explicit topic opener after pause opens b2
        Segment(
            segment_id="s4",
            start=21.5,
            end=28.0,
            text="Agora falando sobre ações pagadoras de dividendos.",
            speaker="SPEAKER_00",
        ),
    ]

    blocks = group_segments_into_semantic_blocks(segments)
    assert len(blocks) == 2
    assert blocks[0].block_id == "b1"
    assert blocks[0].segment_ids == ["s1", "s2", "s3"]
    assert "Mas quando" in blocks[0].text
    assert "Porque você" in blocks[0].text
    assert blocks[1].block_id == "b2"
    assert blocks[1].segment_ids == ["s4"]
    assert blocks[1].is_topic_opener is True


def test_speaker_shift_qa_trigger_and_word_timing_alignment() -> None:
    """Verify Q&A speaker transitions open new blocks and word timings refine start/end."""
    segments = [
        Segment(
            segment_id="s1",
            start=1.0,
            end=6.0,
            text="Qual foi o maior aprendizado que você teve criando empresas?",
            speaker="SPEAKER_00",
        ),
        Segment(
            segment_id="s2",
            start=6.4,
            end=14.0,
            text="O maior aprendizado foi controlar o fluxo de caixa desde o dia um.",
            speaker="SPEAKER_01",
        ),
    ]
    words = [
        WordTiming(word="Qual", start=1.12, end=1.40, segment_id="s1"),
        WordTiming(word="empresas?", start=5.60, end=5.88, segment_id="s1"),
        WordTiming(word="O", start=6.45, end=6.55, segment_id="s2"),
        WordTiming(word="um.", start=13.50, end=13.82, segment_id="s2"),
    ]

    blocks = group_segments_into_semantic_blocks(segments, words=words)
    assert len(blocks) == 2
    assert blocks[0].speaker == "SPEAKER_00"
    assert blocks[0].start == pytest.approx(1.12, abs=1e-3)
    assert blocks[0].end == pytest.approx(5.88, abs=1e-3)
    assert blocks[1].speaker == "SPEAKER_01"
    assert blocks[1].start == pytest.approx(6.45, abs=1e-3)
    assert blocks[1].end == pytest.approx(13.82, abs=1e-3)
    assert blocks[1].is_topic_opener is True


def test_texttiling_sliding_windows_and_depth_score_math() -> None:
    """Verify sliding windows k=3 and exact Depth Score valley formula + adaptive threshold."""
    blocks = [
        SemanticBlock(block_id=f"b{i}", start=(i - 1) * 30.0, end=i * 30.0, text=f"Block {i}.")
        for i in range(1, 9)
    ]

    windows = build_sliding_windows(blocks, k=3)
    assert len(windows) == 7
    # At boundary i=2 (between b3 and b4), left window has b1,b2,b3 and right window has b4,b5,b6
    left_2, right_2 = windows[2]
    assert left_2 == "Block 1. Block 2. Block 3."
    assert right_2 == "Block 4. Block 5. Block 6."

    # Synthetic similarity curve with a clear topic shift valley at index 3 (between b4 and b5)
    similarities = [0.92, 0.90, 0.88, 0.20, 0.86, 0.90, 0.91]
    depths = compute_depth_scores(similarities)
    assert len(depths) == len(similarities)

    # At index 3: Peak_left = 0.92, Peak_right = 0.91, Sim(3) = 0.20
    # Depth(3) = ((0.92 - 0.20) + (0.91 - 0.20)) / 2 = (0.72 + 0.71) / 2 = 0.715
    assert depths[3] == pytest.approx(0.715, abs=1e-6)
    assert depths[0] == pytest.approx(0.0, abs=1e-6)

    boundaries = select_boundaries_by_depth(blocks, depths, sigma_factor=0.5)
    assert "b5" in boundaries


@pytest.mark.asyncio
async def test_short_video_under_150s_always_generates_single_topic_t1(
    container: ServiceContainer,
) -> None:
    """Verify videos < 150s always generate and persist `topic.segments.json` with single topic `t1`."""
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=short123",
        status=JobStatus.DOWNLOADED,
        video_duration_seconds=92.0,
    )
    segments = [
        Segment(segment_id="s1", start=0.0, end=12.0, text="Primeiro pensamento completo sobre foco."),
        Segment(segment_id="s2", start=13.0, end=28.0, text="Segundo pensamento sobre produtividade real."),
        Segment(segment_id="s3", start=29.0, end=55.0, text="Terceiro argumento com exemplo prático."),
        Segment(segment_id="s4", start=56.0, end=90.0, text="Conclusão final direta para aplicar hoje."),
    ]
    container.jobs.save_transcription_segments(job.job_id, segments)

    blocks = build_semantic_blocks(job.job_id, container=container)
    assert len(blocks) >= 2

    topics = await build_topic_segments(job.job_id, container=container)
    assert len(topics) == 1
    assert topics[0].topic_id == "t1"
    assert topics[0].block_ids == [b.block_id for b in blocks]
    assert topics[0].start == pytest.approx(0.0)
    assert topics[0].end == pytest.approx(90.0)
    assert container.jobs.topic_segments_path(job.job_id).exists()


@pytest.mark.asyncio
async def test_long_video_topic_segmentation_with_mocked_embeddings_and_cpu_offload(
    container: ServiceContainer,
) -> None:
    """Verify videos >= 150s call `nomic-embed-text` with `num_gpu=0` and split topics at semantic valleys."""
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=long456",
        status=JobStatus.DOWNLOADED,
        video_duration_seconds=240.0,
    )
    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=30.0, text="Renda fixa e Tesouro Selic para reserva."),
        SemanticBlock(block_id="b2", start=30.5, end=60.0, text="Liquidez diária e proteção contra inflação IPCA."),
        SemanticBlock(block_id="b3", start=60.5, end=90.0, text="Comparação de CDB e LCI isenta de imposto."),
        SemanticBlock(block_id="b4", start=90.5, end=120.0, text="Treino de hipertrofia e progressão de carga na academia."),
        SemanticBlock(block_id="b5", start=120.5, end=150.0, text="Consumo de proteínas, creatina e recuperação muscular."),
        SemanticBlock(block_id="b6", start=150.5, end=185.0, text="Periodização de treino de força e descanso adequado."),
    ]
    container.jobs.save_semantic_blocks(job.job_id, blocks)

    embed_requests: list[dict[str, Any]] = []

    async def _mock_embed_fetcher(
        method: str, url: str, body: dict[str, Any] | None = None
    ) -> tuple[int, Any]:
        if url.endswith("/api/embed") and body is not None:
            embed_requests.append(body)
            # Topic 1 (b1..b3): orthogonal to Topic 2 (b4..b6)
            return 200, {
                "embeddings": [
                    [1.0, 0.0, 0.0],
                    [0.98, 0.05, 0.0],
                    [0.97, 0.08, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.05, 0.99, 0.0],
                    [0.02, 0.98, 0.0],
                ]
            }
        return 404, {}

    container.llm_http_fetcher = _mock_embed_fetcher

    topics = await build_topic_segments(job.job_id, use_embeddings=True, container=container)
    assert len(embed_requests) == 1
    assert embed_requests[0]["model"] == "nomic-embed-text"
    assert embed_requests[0]["options"] == {"num_gpu": 0}
    assert embed_requests[0]["keep_alive"] == 0

    assert len(topics) == 2
    assert topics[0].topic_id == "t1"
    assert topics[0].block_ids == ["b1", "b2", "b3"]
    assert topics[1].topic_id == "t2"
    assert topics[1].block_ids == ["b4", "b5", "b6"]
    assert container.jobs.topic_segments_path(job.job_id).exists()


@pytest.mark.asyncio
async def test_blocks_endpoint_and_offline_lexical_tfidf_fallback(
    container: ServiceContainer,
    async_client: httpx.AsyncClient,
) -> None:
    """Verify `POST /jobs/{id}/blocks` saves both artifacts and falls back to TF-IDF when embed server is offline."""
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=blocksroute",
        status=JobStatus.DOWNLOADED,
        video_duration_seconds=200.0,
    )
    segments = [
        Segment(segment_id="s1", start=0.0, end=35.0, text="Introdução sobre arquitetura de computadores e GPUs modernas."),
        Segment(segment_id="s2", start=36.0, end=75.0, text="Memória GDDR7 e largura de banda nos Tensor Cores."),
        Segment(segment_id="s3", start=78.5, end=120.0, text="Agora falando sobre culinária italiana e massas artesanais."),
        Segment(segment_id="s4", start=121.0, end=180.0, text="Molho de tomate fresco, manjericão e fermentação lenta."),
    ]
    container.jobs.save_transcription_segments(job.job_id, segments)

    async def _offline_fetcher(method: str, url: str, body: dict | None = None) -> tuple[int, Any]:
        return 503, {"detail": "offline"}

    container.llm_http_fetcher = _offline_fetcher

    resp = await async_client.post(f"/jobs/{job.job_id}/blocks")
    assert resp.status_code == 200
    payload = resp.json()
    assert isinstance(payload, list)
    assert len(payload) >= 2
    assert payload[0]["block_id"] == "b1"

    assert container.jobs.semantic_blocks_path(job.job_id).exists()
    assert container.jobs.topic_segments_path(job.job_id).exists()
    topics = container.jobs.load_topic_segments(job.job_id)
    assert len(topics) >= 1

    tfidf_vecs = compute_lexical_tfidf_embeddings([b["text"] for b in payload])
    assert len(tfidf_vecs) == len(payload)
    sims = compute_window_similarities(tfidf_vecs, k=2)
    assert len(sims) == len(payload) - 1

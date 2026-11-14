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


def test_news_and_list_transitions_split_after_sentence_while_connectives_stay_blocked() -> None:
    """Verify news/list transitions open new blocks after terminal punctuation, while mid-sentence/anaphoric connectives stay blocked."""
    segments = [
        Segment(
            segment_id="s1",
            start=0.0,
            end=5.0,
            text="A inflação recuou pelo terceiro mês consecutivo no país.",
            speaker="SPEAKER_00",
        ),
        # Terminal punctuation + news transition "Agora," splits cleanly even with tiny 0.1s pause
        Segment(
            segment_id="s2",
            start=5.1,
            end=9.0,
            text="Agora, veja os números do varejo em São Paulo.",
            speaker="SPEAKER_00",
        ),
        # No terminal punctuation before "Por outro lado" -> must NOT split mid-sentence
        Segment(
            segment_id="s3",
            start=9.1,
            end=13.5,
            text="Os analistas destacaram que o setor cresceu rápido",
            speaker="SPEAKER_00",
        ),
        Segment(
            segment_id="s4",
            start=13.6,
            end=18.0,
            text="Por outro lado alguns custos de frete subiram bastante.",
            speaker="SPEAKER_00",
        ),
        # Terminal punctuation + "Já em" / "Enquanto isso" splits cleanly
        Segment(
            segment_id="s5",
            start=18.1,
            end=23.0,
            text="Já em Brasília, o Congresso aprovou o novo marco fiscal.",
            speaker="SPEAKER_00",
        ),
        # "Mas" after terminal punctuation remains blocked as dependent continuation
        Segment(
            segment_id="s6",
            start=23.2,
            end=28.0,
            text="Mas o texto ainda depende de regulamentação no Senado.",
            speaker="SPEAKER_00",
        ),
        Segment(
            segment_id="s7",
            start=28.1,
            end=33.0,
            text="Enquanto isso, as bolsas europeias fecharam em alta.",
            speaker="SPEAKER_00",
        ),
    ]

    blocks = group_segments_into_semantic_blocks(segments)
    assert [b.segment_ids for b in blocks] == [
        ["s1"],
        ["s2", "s3", "s4"],
        ["s5", "s6"],
        ["s7"],
    ]
    assert blocks[1].is_topic_opener is True
    assert "NEWS_TRANSITION" in blocks[1].signal_tags
    assert blocks[2].is_topic_opener is True
    assert "NEWS_TRANSITION" in blocks[2].signal_tags
    assert blocks[3].is_topic_opener is True
    assert "NEWS_TRANSITION" in blocks[3].signal_tags


def test_zero_gpu_signals_wpm_overlap_and_ad_cta_vs_analogy() -> None:
    """Verify WPM_SHIFT, LOW_OVERLAP/TOPIC_SHIFT, explicit AD_CUE, soft-cue agreement, and Analogy exclusion."""
    segments = [
        Segment(
            segment_id="s1",
            start=0.0,
            end=12.0,
            text="Juros compostos funcionam multiplicando capital investido ao longo das décadas.",
            speaker="SPEAKER_00",
        ),
        # Didactic analogy containing "desconto" -> must NOT be tagged AD_CUE
        Segment(
            segment_id="s2",
            start=13.5,
            end=25.5,
            text="Por exemplo, imagina que você ganha desconto comprando ações baratas todo mês.",
            speaker="SPEAKER_00",
        ),
        # Explicit sponsor/CTA with fast delivery (~240 WPM vs ~55 WPM baseline) -> WPM_SHIFT + LOW_OVERLAP + AD_CUE
        Segment(
            segment_id="s3",
            start=27.0,
            end=31.0,
            text="Antes de continuar use o cupom DEV20 no link na descrição para patrocinar o canal agora mesmo.",
            speaker="SPEAKER_00",
        ),
        # Soft cue ("acesse") corroborated by LOW_OVERLAP after sentence end -> AD_CUE
        Segment(
            segment_id="s4",
            start=32.5,
            end=42.5,
            text="Acesse nossa plataforma exclusiva da Alura para desenvolvedores Python.",
            speaker="SPEAKER_00",
        ),
    ]

    blocks = group_segments_into_semantic_blocks(segments)
    assert len(blocks) == 4
    assert blocks[0].wpm is not None and blocks[0].wpm > 0
    assert "AD_CUE" not in blocks[1].signal_tags
    assert "WPM_SHIFT" in blocks[2].signal_tags
    assert "LOW_OVERLAP" in blocks[2].signal_tags
    assert "AD_CUE" in blocks[2].signal_tags
    assert "LOW_OVERLAP" in blocks[3].signal_tags
    assert "AD_CUE" in blocks[3].signal_tags


def test_acoustic_block_signals_p10_and_prosody_shift(tmp_path: Any) -> None:
    """Verify compute_p10_noise_floor, bounded WAV/sample signal extraction, and graceful None handling."""
    import numpy as np

    from app.infrastructure.audio.acoustic_dsp import (
        compute_block_acoustic_signals,
        compute_p10_noise_floor,
    )
    from app.infrastructure.audio.pcm_extractor import write_synthetic_pcm16_wav

    blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=2.0, text="Bloco um."),
        SemanticBlock(block_id="b2", start=2.0, end=4.0, text="Bloco dois."),
    ]

    # None audio -> graceful empty signals
    assert compute_block_acoustic_signals(blocks) == {}
    assert compute_p10_noise_floor(np.zeros(0, dtype=np.float32)) == 0.0

    sr = 16000
    t = np.linspace(0.0, 2.0, sr * 2, endpoint=False, dtype=np.float32)
    # b1: low-frequency 140Hz tone + tiny noise floor; b2: higher 330Hz tone + louder noise floor
    rng = np.random.default_rng(42)
    s1 = 0.25 * np.sin(2.0 * np.pi * 140.0 * t) + 0.005 * rng.standard_normal(t.size).astype(np.float32)
    s2 = 0.25 * np.sin(2.0 * np.pi * 330.0 * t) + 0.04 * rng.standard_normal(t.size).astype(np.float32)
    # Add short quiet gaps so P10 measures noise floor accurately
    s1[: sr // 4] *= 0.1
    s2[: sr // 4] *= 0.1
    samples = np.concatenate([s1, s2])

    wav_path = tmp_path / "audio_16k.wav"
    write_synthetic_pcm16_wav(wav_path, samples, sample_rate=sr)

    signals = compute_block_acoustic_signals(blocks, audio_wav_path=wav_path)
    assert set(signals.keys()) == {"b1", "b2"}
    assert signals["b1"]["noise_floor_p10"] < signals["b2"]["noise_floor_p10"]
    assert signals["b1"]["prosody_shift_score"] == 0.0
    assert signals["b2"]["prosody_shift_score"] > 0.15


def test_anisotropic_mean_centering_and_duration_weighted_similarities() -> None:
    """Verify mean-centering activates only at >=10 blocks and sharpens anisotropic topic shifts."""
    from app.domain.segmentation.topic_segmentation import center_embeddings_anisotropic

    # < 10 blocks -> untouched
    small = [[1.0, 0.0], [0.0, 1.0]]
    assert center_embeddings_anisotropic(small) == small

    # >= 10 blocks sharing a strong common cone [0.9, ...]
    aniso = [[0.9, 0.3, 0.0]] * 5 + [[0.9, 0.0, 0.3]] * 5
    centered = center_embeddings_anisotropic(aniso)
    sims_uncentered = compute_window_similarities(aniso, k=2)
    sims_centered = compute_window_similarities(
        centered, k=2, block_durations=[15.0] * 10
    )
    # Valley at index 4 becomes much deeper after centering
    assert sims_centered[4] < sims_uncentered[4]
    assert sims_centered[4] < 0.0


@pytest.mark.asyncio
async def test_k1_spike_dmin_uniform_guard_backend_and_bidirectional_affinity_merge(
    container: ServiceContainer,
) -> None:
    """Verify k=1 spike detection, d_min preventing uniform splits, embedding_backend tracking, and ad/bidirectional merge."""
    from app.domain.segmentation.topic_segmentation import (
        build_topics_from_boundaries,
        segment_blocks_into_topics,
    )

    # 1. Uniform 12-block video with tiny jitter must NOT split (d_min floor)
    uniform_blocks = [
        SemanticBlock(
            block_id=f"b{i}",
            start=(i - 1) * 20.0,
            end=i * 20.0,
            text=f"Explicação contínua parte {i} sobre engenharia de software.",
        )
        for i in range(1, 13)
    ]
    uniform_embs = [[0.99, 0.01 * ((i % 3) - 1), 0.0] for i in range(12)]
    uniform_topics = await segment_blocks_into_topics(
        uniform_blocks,
        video_duration_seconds=240.0,
        block_embeddings_override=uniform_embs,
        container=container,
    )
    assert len(uniform_topics) == 1
    assert uniform_topics[0].embedding_backend == "neural"
    assert uniform_topics[0].topic_type == "content"

    # 2. Sharp 1-block news/sponsor spike at b5 inside a 10-block video is caught by k=1 delta_1 curve
    spike_blocks = [
        SemanticBlock(
            block_id=f"b{i}",
            start=(i - 1) * 30.0,
            end=i * 30.0,
            text=(
                "Use o cupom TECH para desconto, link na descrição."
                if i == 5
                else f"Discussão principal sobre inteligência artificial bloco {i}."
            ),
            signal_tags=["AD_CUE"] if i == 5 else [],
        )
        for i in range(1, 11)
    ]
    spike_embs = [
        [0.0, 1.0, 0.0] if i == 4 else [1.0, 0.0, 0.0]
        for i in range(10)
    ]
    spike_topics = await segment_blocks_into_topics(
        spike_blocks,
        video_duration_seconds=300.0,
        block_embeddings_override=spike_embs,
        container=container,
    )
    ad_topics = [t for t in spike_topics if t.topic_type == "ad_span"]
    assert len(ad_topics) == 1
    assert ad_topics[0].block_ids == ["b5"]

    # 3. Bidirectional affinity merge + ad-span isolation for short (<25s) fragments
    merge_blocks = [
        SemanticBlock(block_id="b1", start=0.0, end=40.0, text="Futebol campeonato brasileiro."),
        # Short 10s fragment that matches right neighbor (b3) much better than left (b1)
        SemanticBlock(block_id="b2", start=40.5, end=50.5, text="Receita de pizza napolitana."),
        SemanticBlock(block_id="b3", start=51.0, end=90.0, text="Fermentação de massa de pizza."),
        # Short 12s ad span must stay isolated as topic_type="ad_span"
        SemanticBlock(
            block_id="b4",
            start=91.0,
            end=103.0,
            text="Link na descrição com cupom.",
            signal_tags=["AD_CUE"],
        ),
        SemanticBlock(block_id="b5", start=104.0, end=160.0, text="Economia e taxa Selic."),
    ]
    merge_embs = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.99, 0.05],
        [0.0, 0.0, 1.0],
        [0.8, 0.0, 0.6],
    ]
    merged_topics = build_topics_from_boundaries(
        merge_blocks,
        {"b2", "b3", "b4", "b5"},
        min_topic_duration=25.0,
        block_embeddings=merge_embs,
        embedding_backend="neural",
    )
    assert [t.block_ids for t in merged_topics] == [
        ["b1"],
        ["b2", "b3"],
        ["b4"],
        ["b5"],
    ]
    assert [t.topic_type for t in merged_topics] == ["content", "content", "ad_span", "content"]
    assert all(t.embedding_backend == "neural" for t in merged_topics)

    # 4. Offline TF-IDF fallback sets embedding_backend="tfidf_fallback"
    async def _offline_fetcher(method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        return 503, {"detail": "offline"}

    container.llm_http_fetcher = _offline_fetcher
    fallback_topics = await segment_blocks_into_topics(
        spike_blocks[:4],
        video_duration_seconds=200.0,
        container=container,
    )
    assert all(t.embedding_backend == "tfidf_fallback" for t in fallback_topics)


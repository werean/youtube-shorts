"""Stage 3B: Contextual TextTiling Topic Segmentation (`topic.segments.json`).

Implements:
- Short-video guarantee (`< 150s`): always generates and saves `topic.segments.json` with
  a single topic `t1` covering all semantic blocks.
- Contextual TextTiling (`>= 150s`):
  - Sliding windows of size `k = 3` blocks (`[b_{i-2}, b_{i-1}, b_i]` vs `[b_{i+1}, b_{i+2}, b_{i+3}]`).
  - Local embeddings via `UnifiedLocalLLMAdapter` (`nomic-embed-text` with `num_gpu=0` and `keep_alive=0`
    to prevent VRAM model thrashing against the 14B chat LLM), with deterministic lexical TF-IDF
    cosine fallback when the embedding server is offline.
  - Depth Score calculation at local valleys of the cosine similarity curve:
    `Depth(i) = ((Peak_left(i) - Sim(i)) + (Peak_right(i) - Sim(i))) / 2`
    with adaptive threshold `mu_d + 0.5 * sigma_d`.
  - Integration with YouTube `chapters` anchors (`source.info.json`), pauses >= 2.2s,
    opening-connective blocking, and minimum topic duration (`25.0s`).
"""

from __future__ import annotations

import math
import re
from collections import Counter
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Callable, Sequence

import numpy as np

from app.application.runtime_service import (
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.domain.segmentation.semantic_blocks import (
    compute_token_jaccard,
    ends_sentence,
    is_news_or_list_transition_text,
    is_topic_opener_text,
    starts_with_blocking_connective,
)
from app.infrastructure.llm.unified_adapter import UnifiedLocalLLMAdapter
from app.models.domain import JobStatus, SemanticBlock, TopicSegment

SHORT_VIDEO_THRESHOLD_SECONDS: float = 150.0
MIN_TOPIC_DURATION_SECONDS: float = 25.0
WINDOW_K: int = 3
DEFAULT_DEPTH_SIGMA_FACTOR: float = 0.5
LONG_PAUSE_BOUNDARY_SECONDS: float = 2.2
NEURAL_MIN_DEPTH: float = 0.06
TFIDF_MIN_DEPTH: float = 0.12

_TOKEN_RE = re.compile(r"[a-zA-ZÀ-ÿ0-9]{2,}")

_STOPWORDS_PT_EN: frozenset[str] = frozenset(
    {
        "de",
        "da",
        "do",
        "das",
        "dos",
        "em",
        "na",
        "no",
        "nas",
        "nos",
        "um",
        "uma",
        "para",
        "por",
        "com",
        "que",
        "se",
        "ao",
        "os",
        "as",
        "the",
        "and",
        "of",
        "to",
        "in",
        "is",
        "it",
        "for",
        "on",
        "with",
        "that",
        "this",
        "are",
        "was",
        "be",
    }
)


def cosine_similarity(vec_a: Sequence[float] | np.ndarray, vec_b: Sequence[float] | np.ndarray) -> float:
    """Compute cosine similarity in `[-1.0, 1.0]` between two vectors."""
    a = np.asarray(vec_a, dtype=np.float64)
    b = np.asarray(vec_b, dtype=np.float64)
    if a.size == 0 or b.size == 0 or a.size != b.size:
        return 0.0
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a <= 1e-12 or norm_b <= 1e-12:
        return 0.0
    sim = float(np.dot(a, b) / (norm_a * norm_b))
    return max(-1.0, min(1.0, sim))


def _tokenize_for_tfidf(text: str) -> list[str]:
    words = [w.lower() for w in _TOKEN_RE.findall(text or "")]
    filtered = [w for w in words if w not in _STOPWORDS_PT_EN]
    tokens = filtered if filtered else words
    # Include word stems (prefix 4) to capture morphological variants in PT/EN
    stems = [f"#{w[:4]}" for w in tokens if len(w) >= 4]
    return tokens + stems


def compute_lexical_tfidf_embeddings(texts: Sequence[str]) -> list[list[float]]:
    """Deterministic TF-IDF vector embeddings for offline fallback when embedding server is unreachable."""
    if not texts:
        return []

    tokenized_docs = [_tokenize_for_tfidf(t) for t in texts]
    vocab_set: set[str] = set()
    for doc in tokenized_docs:
        vocab_set.update(doc)

    vocab = sorted(vocab_set)
    if not vocab:
        return [[1.0] for _ in texts]

    vocab_index = {term: idx for idx, term in enumerate(vocab)}
    n_docs = len(texts)
    df = np.zeros(len(vocab), dtype=np.float64)
    for doc in tokenized_docs:
        for term in set(doc):
            df[vocab_index[term]] += 1.0

    idf = np.log((1.0 + n_docs) / (1.0 + df)) + 1.0
    embeddings: list[list[float]] = []

    for doc in tokenized_docs:
        vec = np.zeros(len(vocab), dtype=np.float64)
        if doc:
            counts = Counter(doc)
            total = float(len(doc))
            for term, cnt in counts.items():
                idx = vocab_index[term]
                vec[idx] = (cnt / total) * idf[idx]
            norm = float(np.linalg.norm(vec))
            if norm > 1e-12:
                vec = vec / norm
        embeddings.append(vec.tolist())

    return embeddings


def center_embeddings_anisotropic(
    embeddings: Sequence[Sequence[float]],
    *,
    min_blocks: int = 10,
) -> list[list[float]]:
    """Subtract per-video mean embedding and L2-renormalize when `len(embeddings) >= min_blocks`.

    Skipping when `< min_blocks` preserves small orthogonal unit fixtures; guarding tiny
    residual variance avoids magnifying floating-point jitter on uniform videos.
    """
    if len(embeddings) < min_blocks:
        return [[float(x) for x in vec] for vec in embeddings]

    mat = np.asarray(embeddings, dtype=np.float64)
    if mat.ndim != 2 or mat.shape[1] == 0:
        return [[float(x) for x in vec] for vec in embeddings]

    orig_norms = np.linalg.norm(mat, axis=1)
    mean_vec = np.mean(mat, axis=0, keepdims=True)
    centered = mat - mean_vec
    norms = np.linalg.norm(centered, axis=1, keepdims=True)
    mean_orig = float(np.mean(orig_norms)) if orig_norms.size > 0 else 0.0
    mean_res = float(np.mean(norms)) if norms.size > 0 else 0.0

    if np.all(norms <= 1e-12) or (mean_orig > 1e-12 and mean_res < 0.05 * mean_orig):
        return [[float(x) for x in vec] for vec in embeddings]

    safe_norms = np.where(norms > 1e-12, norms, 1.0)
    normalized = centered / safe_norms
    return normalized.tolist()


def build_sliding_windows(
    blocks: Sequence[SemanticBlock],
    k: int = WINDOW_K,
) -> list[tuple[str, str]]:
    """Construct concatenated text windows of size `k` on each side of boundary `i` (`i` in `0..N-2`)."""
    n = len(blocks)
    if n < 2:
        return []
    win_size = max(1, int(k))
    windows: list[tuple[str, str]] = []
    for i in range(n - 1):
        left_slice = blocks[max(0, i - win_size + 1) : i + 1]
        right_slice = blocks[i + 1 : min(n, i + 1 + win_size)]
        left_text = " ".join(b.text.strip() for b in left_slice if b.text.strip())
        right_text = " ".join(b.text.strip() for b in right_slice if b.text.strip())
        windows.append((left_text, right_text))
    return windows


def compute_window_similarities(
    block_embeddings: Sequence[Sequence[float]],
    *,
    k: int = WINDOW_K,
    smooth: bool = False,
    block_durations: Sequence[float] | None = None,
) -> list[float]:
    """Compute cosine similarity between sliding windows `[i-k+1..i]` and `[i+1..i+k]` for each gap `i`."""
    n = len(block_embeddings)
    if n < 2:
        return []

    mat = np.asarray(block_embeddings, dtype=np.float64)
    win_size = max(1, int(k))

    weights: np.ndarray | None = None
    if block_durations is not None and len(block_durations) == n:
        weights = np.array(
            [math.sqrt(max(3.0, min(30.0, float(d)))) for d in block_durations],
            dtype=np.float64,
        )

    raw_sims: list[float] = []
    for i in range(n - 1):
        l_lo = max(0, i - win_size + 1)
        l_hi = i + 1
        r_lo = i + 1
        r_hi = min(n, i + 1 + win_size)
        left_vecs = mat[l_lo:l_hi]
        right_vecs = mat[r_lo:r_hi]
        if weights is not None:
            left_mean = np.average(left_vecs, axis=0, weights=weights[l_lo:l_hi])
            right_mean = np.average(right_vecs, axis=0, weights=weights[r_lo:r_hi])
        else:
            left_mean = np.mean(left_vecs, axis=0)
            right_mean = np.mean(right_vecs, axis=0)
        raw_sims.append(cosine_similarity(left_mean, right_mean))

    if not smooth or len(raw_sims) < 3:
        return raw_sims

    smoothed: list[float] = []
    for i in range(len(raw_sims)):
        if i == 0:
            val = 0.7 * raw_sims[0] + 0.3 * raw_sims[1]
        elif i == len(raw_sims) - 1:
            val = 0.3 * raw_sims[-2] + 0.7 * raw_sims[-1]
        else:
            val = 0.25 * raw_sims[i - 1] + 0.5 * raw_sims[i] + 0.25 * raw_sims[i + 1]
        smoothed.append(float(val))
    return smoothed


def compute_depth_scores(similarities: Sequence[float]) -> list[float]:
    """Compute TextTiling Depth Score at each boundary `i`:

    `Depth(i) = ((Peak_left(i) - Sim(i)) + (Peak_right(i) - Sim(i))) / 2`
    """
    m = len(similarities)
    if m == 0:
        return []

    sims = [float(x) for x in similarities]
    depths: list[float] = []

    for i in range(m):
        sim_i = sims[i]

        # Climb left to local peak
        peak_left = sim_i
        j = i - 1
        while j >= 0:
            if sims[j] >= peak_left:
                peak_left = sims[j]
                j -= 1
            else:
                break

        # Climb right to local peak
        peak_right = sim_i
        j = i + 1
        while j < m:
            if sims[j] >= peak_right:
                peak_right = sims[j]
                j += 1
            else:
                break

        depth = ((peak_left - sim_i) + (peak_right - sim_i)) / 2.0
        depths.append(max(0.0, float(depth)))

    return depths


def select_boundaries_by_depth(
    blocks: Sequence[SemanticBlock],
    depth_scores: Sequence[float],
    *,
    sigma_factor: float = DEFAULT_DEPTH_SIGMA_FACTOR,
    min_depth: float = 0.0,
) -> set[str]:
    """Select topic-opening `block_id`s using adaptive mean/std + MAD fallback and `min_depth` floor."""
    if len(blocks) < 2 or not depth_scores:
        return set()

    arr = np.asarray(depth_scores, dtype=np.float64)
    mu_d = float(np.mean(arr))
    sigma_d = float(np.std(arr))
    med_d = float(np.median(arr))
    mad_d = float(np.median(np.abs(arr - med_d))) * 1.4826

    stat_threshold = mu_d + float(sigma_factor) * sigma_d
    if mad_d > 1e-6 and sigma_d > 1.5 * mad_d:
        robust_threshold = med_d + max(float(sigma_factor), 1.5) * mad_d
        stat_threshold = min(stat_threshold, robust_threshold)

    threshold = max(float(min_depth), stat_threshold)

    boundaries: set[str] = set()
    limit = min(len(depth_scores), len(blocks) - 1)
    for i in range(limit):
        d = float(depth_scores[i])
        if d <= 0.0 or d < float(min_depth):
            continue
        is_local_max = True
        if i > 0 and depth_scores[i - 1] > d:
            is_local_max = False
        if i + 1 < limit and depth_scores[i + 1] > d:
            is_local_max = False

        if d >= threshold and (is_local_max or d > mu_d + sigma_d):
            next_block = blocks[i + 1]
            if not starts_with_blocking_connective(next_block.text):
                boundaries.add(next_block.block_id)

    return boundaries


def detect_adjacent_transition_spikes(
    blocks: Sequence[SemanticBlock],
    embeddings: Sequence[Sequence[float]],
    *,
    embedding_backend: str = "neural",
) -> set[str]:
    """Detect sharp 1-block topic switches via unsmoothed `k=1` curve `delta_1(i) = 1 - cos(e_i, e_{i+1})`."""
    n = min(len(blocks), len(embeddings))
    if n < 2:
        return set()

    deltas = [
        max(0.0, 1.0 - cosine_similarity(embeddings[i], embeddings[i + 1]))
        for i in range(n - 1)
    ]
    if not deltas:
        return set()

    arr = np.asarray(deltas, dtype=np.float64)
    mu_1 = float(np.mean(arr))
    sigma_1 = float(np.std(arr))
    med_1 = float(np.median(arr))
    mad_1 = float(np.median(np.abs(arr - med_1))) * 1.4826

    min_delta = 0.50 if embedding_backend == "neural" else 0.72
    extreme_delta = 0.75 if embedding_backend == "neural" else 0.90

    boundaries: set[str] = set()
    for i, d_val in enumerate(deltas):
        nxt = blocks[i + 1]
        if starts_with_blocking_connective(nxt.text):
            continue

        curr = blocks[i]
        curr_tags = set(curr.signal_tags or [])
        nxt_tags = set(nxt.signal_tags or [])
        has_corroboration = bool(
            ("AD_CUE" in curr_tags) != ("AD_CUE" in nxt_tags)
            or "NEWS_TRANSITION" in nxt_tags
            or "LOW_OVERLAP" in nxt_tags
            or "TOPIC_SHIFT" in nxt_tags
            or ends_sentence(curr.text)
        )

        stat_spike = (d_val >= mu_1 + 1.25 * sigma_1) or (
            mad_1 > 1e-6 and d_val >= med_1 + 2.5 * mad_1
        )
        if d_val >= extreme_delta or (d_val >= min_delta and stat_spike and has_corroboration):
            boundaries.add(nxt.block_id)

    return boundaries


def detect_heuristic_and_chapter_boundaries(
    blocks: Sequence[SemanticBlock],
    chapters: Sequence[dict[str, Any]] | None = None,
) -> tuple[set[str], dict[str, str]]:
    """Detect heuristic discourse boundaries and YouTube chapter anchors.

    Returns `(boundary_block_ids, chapter_titles_by_block_id)`.
    """
    boundaries: set[str] = set()
    chapter_titles: dict[str, str] = {}
    if len(blocks) < 2:
        return boundaries, chapter_titles

    # 1. Anchor boundaries from YouTube chapters
    if chapters:
        for ch in chapters:
            if not isinstance(ch, dict):
                continue
            ch_start = float(ch.get("start_time") or ch.get("start") or 0.0)
            ch_title = str(ch.get("title") or "").strip()
            # Find block whose start is closest to ch_start (within 15s)
            best_block = min(blocks, key=lambda b: abs(float(b.start) - ch_start))
            if abs(float(best_block.start) - ch_start) <= 15.0:
                if best_block.block_id != blocks[0].block_id:
                    boundaries.add(best_block.block_id)
                if ch_title:
                    chapter_titles[best_block.block_id] = ch_title

    # 2. Corroborated acoustic pauses, explicit topic/news openers, and AdCTA transitions
    for i in range(len(blocks) - 1):
        curr = blocks[i]
        nxt = blocks[i + 1]
        if starts_with_blocking_connective(nxt.text):
            continue

        pause = max(0.0, float(nxt.start) - float(curr.end))
        curr_ended = ends_sentence(curr.text)
        next_is_opener = is_topic_opener_text(nxt.text) or (
            curr_ended and is_news_or_list_transition_text(nxt.text)
        )
        curr_tags = set(curr.signal_tags or [])
        nxt_tags = set(nxt.signal_tags or [])
        ad_shift = ("AD_CUE" in curr_tags) != ("AD_CUE" in nxt_tags)
        low_overlap = (
            "LOW_OVERLAP" in nxt_tags
            or compute_token_jaccard(curr.text, nxt.text) <= 0.12
        )
        strong_pause = pause >= 3.0

        if ad_shift and (curr_ended or pause >= 1.0 or "AD_CUE" in nxt_tags):
            boundaries.add(nxt.block_id)
        elif pause >= LONG_PAUSE_BOUNDARY_SECONDS and (
            (curr_ended and (next_is_opener or low_overlap or strong_pause))
            or ad_shift
        ):
            boundaries.add(nxt.block_id)
        elif next_is_opener:
            boundaries.add(nxt.block_id)
        elif nxt.is_topic_opener and pause >= 1.0 and (curr_ended or low_overlap):
            boundaries.add(nxt.block_id)

    return boundaries, chapter_titles


def _is_ad_group(grp: Sequence[SemanticBlock]) -> bool:
    if not grp:
        return False
    ad_count = sum(1 for b in grp if "AD_CUE" in (b.signal_tags or []))
    return ad_count >= max(1, (len(grp) + 1) // 2)


def _group_affinity(
    grp_a: Sequence[SemanticBlock],
    grp_b: Sequence[SemanticBlock],
    *,
    emb_by_block_id: dict[str, np.ndarray] | None = None,
) -> float:
    if emb_by_block_id:
        vecs_a = [emb_by_block_id[b.block_id] for b in grp_a if b.block_id in emb_by_block_id]
        vecs_b = [emb_by_block_id[b.block_id] for b in grp_b if b.block_id in emb_by_block_id]
        if vecs_a and vecs_b:
            mean_a = np.mean(np.stack(vecs_a, axis=0), axis=0)
            mean_b = np.mean(np.stack(vecs_b, axis=0), axis=0)
            return cosine_similarity(mean_a, mean_b)

    text_a = " ".join(b.text for b in grp_a if b.text)
    text_b = " ".join(b.text for b in grp_b if b.text)
    score = compute_token_jaccard(text_a, text_b)
    spk_a = grp_a[-1].speaker if grp_a else None
    spk_b = grp_b[0].speaker if grp_b else None
    if spk_a and spk_b and spk_a == spk_b:
        score += 0.15
    return score


def build_topics_from_boundaries(
    blocks: Sequence[SemanticBlock],
    boundary_block_ids: set[str],
    *,
    chapter_titles: dict[str, str] | None = None,
    min_topic_duration: float = MIN_TOPIC_DURATION_SECONDS,
    block_embeddings: Sequence[Sequence[float]] | None = None,
    embedding_backend: str | None = None,
) -> list[TopicSegment]:
    """Assemble `TopicSegment` items from boundary `block_id`s with ad-span isolation and bidirectional affinity merge."""
    if not blocks:
        return []

    total_span = float(blocks[-1].end) - float(blocks[0].start)
    if total_span < min_topic_duration or len(blocks) == 1:
        title = (chapter_titles or {}).get(blocks[0].block_id)
        topic_type = "ad_span" if _is_ad_group(blocks) else "content"
        return [
            TopicSegment(
                topic_id="t1",
                start=round(float(blocks[0].start), 3),
                end=round(float(blocks[-1].end), 3),
                block_ids=[b.block_id for b in blocks],
                blockCount=len(blocks),
                durationSeconds=round(max(0.0, float(blocks[-1].end) - float(blocks[0].start)), 3),
                title=title,
                embedding_backend=embedding_backend,
                topic_type=topic_type,
            )
        ]

    # Split into raw groups of blocks
    groups: list[list[SemanticBlock]] = []
    current_group: list[SemanticBlock] = []

    for idx, blk in enumerate(blocks):
        if idx > 0 and blk.block_id in boundary_block_ids and not starts_with_blocking_connective(blk.text):
            if current_group:
                groups.append(current_group)
            current_group = [blk]
        else:
            current_group.append(blk)
    if current_group:
        groups.append(current_group)

    emb_by_block_id: dict[str, np.ndarray] | None = None
    if block_embeddings is not None and len(block_embeddings) == len(blocks):
        emb_by_block_id = {
            blk.block_id: np.asarray(vec, dtype=np.float64)
            for blk, vec in zip(blocks, block_embeddings)
        }

    # Merge short fragments (< min_topic_duration) using ad-span isolation + bidirectional affinity
    merged_groups: list[list[SemanticBlock]] = []
    i = 0
    while i < len(groups):
        grp = groups[i]
        grp_dur = float(grp[-1].end) - float(grp[0].start)
        grp_is_ad = _is_ad_group(grp)

        if grp_is_ad:
            if merged_groups and _is_ad_group(merged_groups[-1]):
                merged_groups[-1].extend(grp)
            else:
                merged_groups.append(grp)
            i += 1
            continue

        if grp_dur < min_topic_duration and (len(merged_groups) > 0 or i + 1 < len(groups)):
            left_valid = bool(merged_groups) and not _is_ad_group(merged_groups[-1])
            right_valid = (i + 1 < len(groups)) and not _is_ad_group(groups[i + 1])

            if left_valid and right_valid:
                aff_left = _group_affinity(merged_groups[-1], grp, emb_by_block_id=emb_by_block_id)
                aff_right = _group_affinity(grp, groups[i + 1], emb_by_block_id=emb_by_block_id)
                if aff_right > aff_left + 1e-6:
                    groups[i + 1] = grp + groups[i + 1]
                else:
                    merged_groups[-1].extend(grp)
            elif left_valid:
                merged_groups[-1].extend(grp)
            elif right_valid:
                groups[i + 1] = grp + groups[i + 1]
            else:
                # Flanked only by ad spans: keep content fragment isolated rather than gluing into an ad
                merged_groups.append(grp)
        else:
            merged_groups.append(grp)
        i += 1

    if not merged_groups:
        merged_groups = [list(blocks)]

    topics: list[TopicSegment] = []
    for idx, grp in enumerate(merged_groups, start=1):
        t_start = round(float(grp[0].start), 3)
        t_end = round(float(grp[-1].end), 3)
        t_dur = round(max(0.0, t_end - t_start), 3)
        title = None
        if chapter_titles:
            for b in grp:
                if b.block_id in chapter_titles:
                    title = chapter_titles[b.block_id]
                    break
        topics.append(
            TopicSegment(
                topic_id=f"t{idx}",
                start=t_start,
                end=t_end,
                block_ids=[b.block_id for b in grp],
                blockCount=len(grp),
                durationSeconds=t_dur,
                title=title,
                embedding_backend=embedding_backend,
                topic_type="ad_span" if _is_ad_group(grp) else "content",
            )
        )

    return topics


@asynccontextmanager
async def _maybe_topics_gpu_slot(c_ref: Any) -> AsyncIterator[None]:
    sched = getattr(c_ref, "scheduler", None)
    gpu_mutex = getattr(sched, "gpu_mutex", None) if sched is not None else None
    if sched is None or (gpu_mutex is not None and gpu_mutex.current_task_holds_slot()):
        yield
        return
    async with sched.gpu_slot(holder="topics"):
        yield


async def segment_blocks_into_topics(
    blocks: Sequence[SemanticBlock],
    *,
    video_duration_seconds: float | None = None,
    chapters: Sequence[dict[str, Any]] | None = None,
    use_embeddings: bool = True,
    embedding_model: str | None = None,
    sigma_factor: float = DEFAULT_DEPTH_SIGMA_FACTOR,
    window_k: int | None = None,
    min_topic_duration: float = MIN_TOPIC_DURATION_SECONDS,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
    block_embeddings_override: Sequence[Sequence[float]] | None = None,
    on_embedding_fallback: Callable[[str], None] | None = None,
    job_id: str | None = None,
    container: ServiceContainer | None = None,
) -> list[TopicSegment]:
    """Run contextual TextTiling over `blocks` and return `TopicSegment` list."""
    if not blocks:
        return []

    inferred_duration = (
        float(video_duration_seconds)
        if video_duration_seconds and video_duration_seconds > 0
        else float(blocks[-1].end)
    )

    # Edge Case: Short videos (< 150s / 2.5 min) ALWAYS get a single topic `t1`
    if inferred_duration < SHORT_VIDEO_THRESHOLD_SECONDS:
        first_title = None
        if chapters:
            for ch in chapters:
                if isinstance(ch, dict) and ch.get("title"):
                    first_title = str(ch["title"]).strip()
                    break
        return [
            TopicSegment(
                topic_id="t1",
                start=round(float(blocks[0].start), 3),
                end=round(float(blocks[-1].end), 3),
                block_ids=[b.block_id for b in blocks],
                blockCount=len(blocks),
                durationSeconds=round(max(0.0, float(blocks[-1].end) - float(blocks[0].start)), 3),
                title=first_title,
                embedding_backend="none",
                topic_type="ad_span" if _is_ad_group(blocks) else "content",
            )
        ]

    heuristic_boundaries, chapter_titles = detect_heuristic_and_chapter_boundaries(
        blocks, chapters=chapters
    )
    all_boundaries = set(heuristic_boundaries)
    embedding_backend = "none"
    centered_embeddings: list[list[float]] | None = None

    if use_embeddings and len(blocks) >= 2:
        embeddings: list[list[float]] = []
        if block_embeddings_override is not None:
            embeddings = [[float(x) for x in vec] for vec in block_embeddings_override]
        else:
            adapter = llm_adapter or UnifiedLocalLLMAdapter(
                container=container,
                embedding_model=embedding_model,
            )
            texts = [b.text for b in blocks]
            c_ref = container or getattr(adapter, "container", None) or get_container()
            lmstudio = getattr(c_ref, "lmstudio", None)
            cfg = (
                adapter.get_configured_urls_and_models()
                if hasattr(adapter, "get_configured_urls_and_models")
                else {}
            )
            provider_pref = str(cfg.get("provider") or "auto").strip().lower()
            pref_emb_model = (
                (embedding_model or cfg.get("embedding_model") or "").strip() or None
            )

            if (
                lmstudio is not None
                and provider_pref in ("auto", "lmstudio")
                and lmstudio.cli_enabled()
            ):
                try:
                    async with _maybe_topics_gpu_slot(c_ref):
                        async with lmstudio.stage(
                            model_type="embedding",
                            preferred_model=pref_emb_model,
                            gpu="off",
                            job_id=job_id,
                            task_log="topics",
                        ) as loaded_emb_key:
                            if loaded_emb_key:
                                embeddings = await adapter.embed_texts(texts, model=loaded_emb_key)
                            elif provider_pref == "auto" and hasattr(adapter, "_request_ollama_embeddings"):
                                embeddings = (
                                    await adapter._request_ollama_embeddings(
                                        str(cfg.get("ollama_base_url") or ""),
                                        texts,
                                        pref_emb_model or "",
                                    )
                                    or []
                                )
                except OperationCancelledError:
                    raise
                except Exception as exc:
                    msg = (
                        f"Falha ao executar embeddings via LM Studio CLI ({exc}); "
                        "usando fallback TF-IDF léxico para TextTiling"
                    )
                    if on_embedding_fallback is not None:
                        on_embedding_fallback(msg)
                    embeddings = []
            else:
                try:
                    embeddings = await adapter.embed_texts(texts, model=embedding_model)
                except OperationCancelledError:
                    raise
                except Exception as exc:
                    msg = (
                        f"Embeddings indisponíveis ({exc}); "
                        "usando fallback TF-IDF léxico para TextTiling"
                    )
                    if on_embedding_fallback is not None:
                        on_embedding_fallback(msg)
                    embeddings = []

        if embeddings and len(embeddings) == len(blocks):
            embedding_backend = "neural"
        else:
            msg = (
                f"Embeddings indisponíveis ou incompletos ({len(embeddings)}/{len(blocks)}); "
                "usando fallback TF-IDF léxico para TextTiling"
            )
            if on_embedding_fallback is not None:
                on_embedding_fallback(msg)
            embeddings = compute_lexical_tfidf_embeddings([b.text for b in blocks])
            embedding_backend = "tfidf_fallback"

        centered_embeddings = center_embeddings_anisotropic(embeddings, min_blocks=10)
        effective_k = (
            (2 if len(blocks) < 12 else WINDOW_K)
            if window_k is None
            else max(1, int(window_k))
        )
        block_durations = [max(0.5, float(b.end) - float(b.start)) for b in blocks]
        similarities = compute_window_similarities(
            centered_embeddings,
            k=effective_k,
            smooth=True,
            block_durations=block_durations,
        )
        depth_scores = compute_depth_scores(similarities)
        d_min = NEURAL_MIN_DEPTH if embedding_backend == "neural" else TFIDF_MIN_DEPTH
        depth_boundaries = select_boundaries_by_depth(
            blocks,
            depth_scores,
            sigma_factor=sigma_factor,
            min_depth=d_min,
        )
        spike_boundaries = detect_adjacent_transition_spikes(
            blocks,
            centered_embeddings,
            embedding_backend=embedding_backend,
        )
        all_boundaries.update(depth_boundaries)
        all_boundaries.update(spike_boundaries)

    return build_topics_from_boundaries(
        blocks,
        all_boundaries,
        chapter_titles=chapter_titles,
        min_topic_duration=min_topic_duration,
        block_embeddings=centered_embeddings,
        embedding_backend=embedding_backend,
    )


async def build_topic_segments(
    job_id: str,
    *,
    use_embeddings: bool = True,
    embedding_model: str | None = None,
    sigma_factor: float = DEFAULT_DEPTH_SIGMA_FACTOR,
    min_topic_duration: float = MIN_TOPIC_DURATION_SECONDS,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
    block_embeddings_override: Sequence[Sequence[float]] | None = None,
    container: ServiceContainer | None = None,
) -> list[TopicSegment]:
    """Load `semantic.blocks.json`, build `topic.segments.json` (guaranteed even for `< 150s`), and persist to disk."""
    c = container or get_container()
    job = c.jobs.load_job(job_id)
    c.jobs.update_job_status(job_id, JobStatus.BUILDING_TOPICS)
    c.runtime.log_stage_start(
        job_id,
        "topics",
        message="[segmentation] Segmentando tópicos via TextTiling contextual...",
    )
    c.runtime.publish_state_change(
        job_id,
        status=JobStatus.BUILDING_TOPICS.value,
        message="[segmentation] Segmentando tópicos via TextTiling contextual...",
    )

    try:
        blocks_file = c.jobs.semantic_blocks_path(job_id)
        if not blocks_file.exists():
            raise ValueError(
                f"Semantic blocks not found for job {job_id}. Run build_semantic_blocks first."
            )

        blocks = c.jobs.load_semantic_blocks(job_id)
        if not blocks:
            raise ValueError(f"No semantic blocks available for job {job_id}")

        source_info = c.jobs.load_source_info(job_id) or {}
        chapters = source_info.get("chapters") if isinstance(source_info, dict) else None

        topics = await segment_blocks_into_topics(
            blocks,
            video_duration_seconds=job.video_duration_seconds,
            chapters=chapters if isinstance(chapters, list) else None,
            use_embeddings=use_embeddings,
            embedding_model=embedding_model,
            sigma_factor=sigma_factor,
            min_topic_duration=min_topic_duration,
            llm_adapter=llm_adapter or UnifiedLocalLLMAdapter(container=c, embedding_model=embedding_model),
            block_embeddings_override=block_embeddings_override,
            on_embedding_fallback=lambda msg: c.runtime.log_warning(job_id, "topics", msg),
            job_id=job_id,
            container=c,
        )

        c.jobs.save_topic_segments(job_id, topics)
        c.jobs.update_job_status(job_id, JobStatus.ANALYZING)
        c.runtime.log_stage_end(
            job_id,
            "topics",
            message=f"[segmentation] {len(topics)} tópicos identificados",
        )
        return topics
    except OperationCancelledError:
        raise
    except Exception as exc:
        c.runtime.log_exception(
            job_id,
            "topics",
            exc,
            message="[segmentation] Erro na segmentação de tópicos",
        )
        c.jobs.update_job_status(job_id, JobStatus.ERROR)
        c.runtime.publish_state_change(
            job_id, JobStatus.ERROR.value, f"[segmentation] {exc}"
        )
        raise

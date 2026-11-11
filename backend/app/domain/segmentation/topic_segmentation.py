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
from typing import Any, Sequence

import numpy as np

from app.application.runtime_service import ServiceContainer, get_container
from app.domain.segmentation.semantic_blocks import (
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
) -> list[float]:
    """Compute cosine similarity between sliding windows `[i-k+1..i]` and `[i+1..i+k]` for each gap `i`."""
    n = len(block_embeddings)
    if n < 2:
        return []

    mat = np.asarray(block_embeddings, dtype=np.float64)
    win_size = max(1, int(k))
    raw_sims: list[float] = []

    for i in range(n - 1):
        left_vecs = mat[max(0, i - win_size + 1) : i + 1]
        right_vecs = mat[i + 1 : min(n, i + 1 + win_size)]
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
) -> set[str]:
    """Select topic-opening `block_id`s where `Depth(i) > mu_d + sigma_factor * sigma_d`."""
    if len(blocks) < 2 or not depth_scores:
        return set()

    arr = np.asarray(depth_scores, dtype=np.float64)
    mu_d = float(np.mean(arr))
    sigma_d = float(np.std(arr))
    threshold = mu_d + float(sigma_factor) * sigma_d

    boundaries: set[str] = set()
    limit = min(len(depth_scores), len(blocks) - 1)
    for i in range(limit):
        d = float(depth_scores[i])
        if d <= 0.0:
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

    # 2. Acoustic pauses >= 2.2s, explicit topic openers, and Q&A shifts
    for i in range(len(blocks) - 1):
        curr = blocks[i]
        nxt = blocks[i + 1]
        if starts_with_blocking_connective(nxt.text):
            continue

        pause = max(0.0, float(nxt.start) - float(curr.end))
        if pause >= LONG_PAUSE_BOUNDARY_SECONDS:
            boundaries.add(nxt.block_id)
        elif is_topic_opener_text(nxt.text):
            boundaries.add(nxt.block_id)
        elif nxt.is_topic_opener and pause >= 1.0:
            boundaries.add(nxt.block_id)

    return boundaries, chapter_titles


def build_topics_from_boundaries(
    blocks: Sequence[SemanticBlock],
    boundary_block_ids: set[str],
    *,
    chapter_titles: dict[str, str] | None = None,
    min_topic_duration: float = MIN_TOPIC_DURATION_SECONDS,
) -> list[TopicSegment]:
    """Assemble `TopicSegment` items from boundary `block_id`s and merge topics shorter than `min_topic_duration`."""
    if not blocks:
        return []

    total_span = float(blocks[-1].end) - float(blocks[0].start)
    if total_span < min_topic_duration or len(blocks) == 1:
        title = (chapter_titles or {}).get(blocks[0].block_id)
        return [
            TopicSegment(
                topic_id="t1",
                start=round(float(blocks[0].start), 3),
                end=round(float(blocks[-1].end), 3),
                block_ids=[b.block_id for b in blocks],
                blockCount=len(blocks),
                durationSeconds=round(max(0.0, float(blocks[-1].end) - float(blocks[0].start)), 3),
                title=title,
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

    # Merge any group shorter than min_topic_duration into an adjacent group
    merged_groups: list[list[SemanticBlock]] = []
    i = 0
    while i < len(groups):
        grp = groups[i]
        grp_dur = float(grp[-1].end) - float(grp[0].start)
        if grp_dur < min_topic_duration and (len(merged_groups) > 0 or i + 1 < len(groups)):
            if merged_groups:
                merged_groups[-1].extend(grp)
            else:
                groups[i + 1] = grp + groups[i + 1]
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
            )
        )

    return topics


async def segment_blocks_into_topics(
    blocks: Sequence[SemanticBlock],
    *,
    video_duration_seconds: float | None = None,
    chapters: Sequence[dict[str, Any]] | None = None,
    use_embeddings: bool = True,
    embedding_model: str | None = None,
    sigma_factor: float = DEFAULT_DEPTH_SIGMA_FACTOR,
    window_k: int = WINDOW_K,
    min_topic_duration: float = MIN_TOPIC_DURATION_SECONDS,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
    block_embeddings_override: Sequence[Sequence[float]] | None = None,
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
            )
        ]

    heuristic_boundaries, chapter_titles = detect_heuristic_and_chapter_boundaries(
        blocks, chapters=chapters
    )
    all_boundaries = set(heuristic_boundaries)

    if use_embeddings and len(blocks) >= 2:
        embeddings: list[list[float]] = []
        if block_embeddings_override is not None:
            embeddings = [[float(x) for x in vec] for vec in block_embeddings_override]
        else:
            adapter = llm_adapter or UnifiedLocalLLMAdapter(embedding_model=embedding_model)
            texts = [b.text for b in blocks]
            embeddings = await adapter.embed_texts(texts, model=embedding_model)

        if not embeddings or len(embeddings) != len(blocks):
            embeddings = compute_lexical_tfidf_embeddings([b.text for b in blocks])

        similarities = compute_window_similarities(embeddings, k=window_k)
        depth_scores = compute_depth_scores(similarities)
        depth_boundaries = select_boundaries_by_depth(
            blocks,
            depth_scores,
            sigma_factor=sigma_factor,
        )
        all_boundaries.update(depth_boundaries)

    return build_topics_from_boundaries(
        blocks,
        all_boundaries,
        chapter_titles=chapter_titles,
        min_topic_duration=min_topic_duration,
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
    c.runtime.publish_state_change(
        job_id,
        status=JobStatus.BUILDING_TOPICS.value,
        message="[segmentation] Segmentando tópicos via TextTiling contextual...",
    )

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
    )

    c.jobs.save_topic_segments(job_id, topics)
    c.jobs.update_job_status(job_id, JobStatus.ANALYZING)
    return topics

"""Stage 3A: Discourse-aware semantic block grouping (`semantic.blocks.json`).

Groups word/segment-level transcription into coherent discourse blocks (`5s`–`20s`, max `30s`)
while enforcing:
- Opening-blocking connectives (PT/EN): never starts a new block on continuation or anaphoric
  connectives ("mas", "porém", "então", "porque", "however", "therefore", etc.) or lowercase.
- Topic-opener & Q&A triggers: opens a new block on speaker shifts, question-to-answer
  transitions, pauses >= 0.65s after sentence boundaries, or explicit discourse topic markers.
- Word timing alignment from `transcription.words.json` when available.
"""

from __future__ import annotations

import re
from typing import Any, Sequence

from app.application.runtime_service import ServiceContainer, get_container
from app.infrastructure.audio.acoustic_dsp import compute_block_acoustic_signals
from app.models.domain import JobStatus, Segment, SemanticBlock, WordTiming

TARGET_MIN_SECONDS: float = 5.0
TARGET_MAX_SECONDS: float = 20.0
HARD_MAX_SECONDS: float = 30.0
EMERGENCY_MAX_SECONDS: float = 60.0
PAUSE_THRESHOLD_SECONDS: float = 0.65
LONG_PAUSE_THRESHOLD_SECONDS: float = 1.2
STRONG_PAUSE_SPLIT_SECONDS: float = 1.5
SENTENCE_BOUNDARIES: tuple[str, ...] = (".", "!", "?", "…")

BLOCKING_OPENING_CONNECTIVES_PT_EN: tuple[str, ...] = (
    # Portuguese continuation / dependent / anaphoric connectives
    "porque",
    "por que",
    "então",
    "entao",
    "mas",
    "porém",
    "porem",
    "contudo",
    "entretanto",
    "todavia",
    "como eu disse",
    "como eu falei",
    "como falei",
    "como disse",
    "como vimos",
    "e aí",
    "e ai",
    "ou seja",
    "portanto",
    "por isso",
    "dessa forma",
    "desse modo",
    "assim",
    "logo",
    "além disso",
    "alem disso",
    "inclusive",
    "aliás",
    "alias",
    "sendo assim",
    "consequentemente",
    "embora",
    "apesar disso",
    "isso acontece",
    "essa segunda",
    "esse segundo",
    "e o segundo",
    "e a segunda",
    # English continuation / dependent / anaphoric connectives
    "because",
    "so",
    "but",
    "however",
    "therefore",
    "thus",
    "hence",
    "consequently",
    "furthermore",
    "moreover",
    "nevertheless",
    "nonetheless",
    "as i said",
    "as i mentioned",
    "that's why",
    "that is why",
    "in other words",
    "and then",
    "and the second",
    "which means",
    "even though",
)

TOPIC_OPENER_MARKERS_PT_EN: tuple[str, ...] = (
    # Portuguese topic transition markers
    "agora falando sobre",
    "vamos falar sobre",
    "o primeiro ponto",
    "o segundo ponto",
    "o terceiro ponto",
    "outro ponto",
    "muita gente me pergunta",
    "muita gente acha",
    "outro erro muito comum",
    "um erro muito comum",
    "mudando de assunto",
    "em primeiro lugar",
    "em segundo lugar",
    "a grande questão",
    "a pergunta que fica",
    "deixa eu te contar",
    "vou te explicar",
    # English topic transition markers
    "now talking about",
    "let's talk about",
    "the first point",
    "the second point",
    "the third point",
    "another common mistake",
    "a lot of people ask",
    "moving on to",
    "first of all",
    "the big question is",
)

# News / list / bulletin transition phrases (only treated as topic openers after terminal sentence punctuation)
NEWS_TRANSITION_OPENERS_PT_EN: tuple[str, ...] = (
    "agora,",
    "e agora",
    "já em",
    "ja em",
    "já no",
    "ja no",
    "já na",
    "ja na",
    "enquanto isso",
    "passando para",
    "outro destaque",
    "outra notícia",
    "outra noticia",
    "próxima notícia",
    "proxima noticia",
    "próximo assunto",
    "proximo assunto",
    "por outro lado",
    "next up",
    "moving on",
    "meanwhile",
    "in other news",
    "turning to",
    "on the other hand",
)

EXPLICIT_AD_CTA_PATTERNS: tuple[str, ...] = (
    "cupom",
    "link na descrição",
    "link na descricao",
    "link in description",
    "link in the description",
    "sponsor",
    "patrocin",
    "use o código",
    "use o codigo",
    "use code",
    "promo code",
    "código promocional",
    "codigo promocional",
    "apoiador",
    "oferecimento",
    "parceria paga",
    "paid partnership",
)

SOFT_AD_CUE_PATTERNS: tuple[str, ...] = (
    "desconto",
    "acesse",
    "discount",
    "promoção",
    "promocao",
    "oferta",
    "clique no link",
    "click the link",
    "check out",
    "sign up",
    "cadastre-se",
    "garanta",
)

ANALOGY_MARKERS_PT_EN: tuple[str, ...] = (
    "por exemplo",
    "imagina que",
    "imagine que",
    "digamos que",
    "suponha que",
    "for example",
    "imagine if",
    "let's say",
    "suppose that",
)

_SIGNAL_TOKEN_RE = re.compile(r"[a-zA-ZÀ-ÿ0-9]{3,}")
_WORD_RE = re.compile(r"\b[\wÀ-ÿ]+\b")
_PROPER_NOUN_RE = re.compile(r"\b[A-ZÀ-Ý][a-zA-ZÀ-ÿ0-9]{2,}\b")

_SIGNAL_STOPWORDS_PT_EN: frozenset[str] = frozenset(
    {
        "que",
        "para",
        "com",
        "uma",
        "por",
        "mais",
        "como",
        "mas",
        "foi",
        "são",
        "sao",
        "tem",
        "seu",
        "sua",
        "dos",
        "das",
        "nos",
        "nas",
        "ele",
        "ela",
        "isso",
        "esse",
        "essa",
        "aqui",
        "muito",
        "agora",
        "então",
        "entao",
        "também",
        "tambem",
        "sobre",
        "quando",
        "porque",
        "the",
        "and",
        "for",
        "that",
        "this",
        "with",
        "you",
        "are",
        "was",
        "from",
        "have",
        "not",
        "but",
        "what",
        "all",
        "were",
        "when",
        "can",
        "there",
        "your",
        "which",
        "their",
        "will",
        "about",
    }
)

_LEADING_PUNCT_RE = re.compile(r"^[\s\"'“”‘’«»\-–—….,;:()\[\]]+")


def _strip_leading_punctuation(text: str) -> str:
    return _LEADING_PUNCT_RE.sub("", (text or "").strip())


def _matches_phrase_prefix(cleaned_lower: str, phrase: str) -> bool:
    if not cleaned_lower or not phrase:
        return False
    if phrase.endswith(","):
        return cleaned_lower.startswith(phrase)
    if cleaned_lower == phrase:
        return True
    if cleaned_lower.startswith(phrase):
        rest = cleaned_lower[len(phrase) :]
        return bool(rest and rest[0] in (" ", ",", ";", ":", ".", "!", "?", "—", "-"))
    return False


def ends_sentence(text: str) -> bool:
    """Return True if text ends with terminal sentence punctuation."""
    trimmed = (text or "").strip().rstrip("\"'”’)]")
    if not trimmed:
        return False
    return trimmed.endswith(SENTENCE_BOUNDARIES)


def is_news_or_list_transition_text(text: str) -> bool:
    """Return True if `text` starts with a news/bulletin/list transition opener."""
    cleaned = _strip_leading_punctuation(text).lower()
    if not cleaned:
        return False
    return any(_matches_phrase_prefix(cleaned, marker) for marker in NEWS_TRANSITION_OPENERS_PT_EN)


def starts_with_blocking_connective(text: str) -> bool:
    """Return True if `text` starts with a dependent PT/EN connective or lowercase continuation."""
    cleaned = _strip_leading_punctuation(text)
    if not cleaned:
        return True

    # Check if the first alphabetic character is lowercase (mid-sentence continuation)
    for ch in cleaned:
        if ch.isalpha():
            if ch.islower():
                # Even if lowercase, check whether it's an explicit topic opener
                low_check = cleaned.lower()
                if any(low_check.startswith(m) for m in TOPIC_OPENER_MARKERS_PT_EN):
                    break
                return True
            break

    low = cleaned.lower()
    for conn in BLOCKING_OPENING_CONNECTIVES_PT_EN:
        if _matches_phrase_prefix(low, conn):
            return True

    return False


def is_topic_opener_text(text: str) -> bool:
    """Return True if `text` begins with a discourse topic-opener phrase."""
    cleaned = _strip_leading_punctuation(text).lower()
    if not cleaned:
        return False
    for marker in TOPIC_OPENER_MARKERS_PT_EN:
        if cleaned.startswith(marker):
            return True
    return False


def has_analogy_marker(text: str) -> bool:
    """Return True if `text` contains a didactic analogy marker (PT/EN)."""
    low = (text or "").lower()
    return any(marker in low for marker in ANALOGY_MARKERS_PT_EN)


def _extract_signal_tokens(text: str) -> set[str]:
    """Extract meaningful content tokens + proper-noun tags for lexical overlap tracking."""
    tokens = {
        tok
        for tok in _SIGNAL_TOKEN_RE.findall((text or "").lower())
        if tok not in _SIGNAL_STOPWORDS_PT_EN
    }
    proper = {f"pn:{m.lower()}" for m in _PROPER_NOUN_RE.findall(text or "")}
    return tokens | proper


def compute_token_jaccard(text_a: str, text_b: str) -> float:
    """Compute Jaccard similarity over content/proper-noun tokens between two texts."""
    a = _extract_signal_tokens(text_a)
    b = _extract_signal_tokens(text_b)
    if not a or not b:
        return 0.0
    union = a | b
    return float(len(a & b)) / float(len(union)) if union else 0.0


def _compute_block_wpm(
    block: SemanticBlock,
    words: Sequence[WordTiming] | None = None,
) -> float:
    duration_sec = max(0.5, float(block.end) - float(block.start))
    word_count = 0
    if words:
        seg_ids = set(block.segment_ids or [])
        matched = [
            w
            for w in words
            if (w.segment_id and w.segment_id in seg_ids)
            or (w.start >= float(block.start) - 0.15 and w.end <= float(block.end) + 0.15)
        ]
        word_count = sum(1 for w in matched if _WORD_RE.search(w.word or ""))
    if word_count <= 0:
        word_count = len(_WORD_RE.findall(block.text or ""))
    if word_count <= 0:
        return 0.0
    return round((float(word_count) / duration_sec) * 60.0, 2)


def enrich_blocks_with_signals(
    blocks: Sequence[SemanticBlock],
    *,
    words: Sequence[WordTiming] | None = None,
    acoustic_signals: dict[str, dict[str, float]] | None = None,
) -> list[SemanticBlock]:
    """Populate 0-GPU lexical, WPM, overlap, AdCTA, and optional acoustic signals on SemanticBlocks."""
    if not blocks:
        return []

    block_list = list(blocks)
    wpms: list[float] = []
    jaccards: list[float] = []
    p10_values: list[float | None] = []

    for idx, blk in enumerate(block_list):
        tags: list[str] = []

        def _add_tag(tag: str) -> None:
            if tag not in tags:
                tags.append(tag)

        # 1. WPM & WPM_SHIFT (>= 35% change vs preceding rolling mean)
        wpm_val = _compute_block_wpm(blk, words=words)
        blk.wpm = wpm_val
        if idx > 0 and wpm_val > 0.0:
            prev_valid = [w for w in wpms[-4:] if w > 0.0]
            if prev_valid:
                rolling_mean = sum(prev_valid) / float(len(prev_valid))
                if rolling_mean > 0.0 and abs(wpm_val - rolling_mean) / rolling_mean >= 0.35:
                    _add_tag("WPM_SHIFT")
        wpms.append(wpm_val)

        # 2. Acoustic P10 noise floor & prosody shift (when audio signals provided)
        curr_p10: float | None = None
        if acoustic_signals and blk.block_id in acoustic_signals:
            sig_map = acoustic_signals[blk.block_id]
            if "noise_floor_p10" in sig_map:
                curr_p10 = float(sig_map["noise_floor_p10"])
                blk.noise_floor_p10 = curr_p10
            prosody_score = float(sig_map.get("prosody_shift_score") or 0.0)
            if idx > 0 and prosody_score >= 0.28:
                _add_tag("PROSODY_SHIFT")
            prev_p10 = p10_values[-1] if p10_values else None
            if (
                idx > 0
                and curr_p10 is not None
                and prev_p10 is not None
                and min(curr_p10, prev_p10) > 1e-6
            ):
                ratio = max(curr_p10, prev_p10) / min(curr_p10, prev_p10)
                if ratio >= 1.8:
                    _add_tag("NOISE_FLOOR_SHIFT")
        p10_values.append(curr_p10)

        # 3. Adjacent lexical/proper-noun overlap & news/topic shift
        if idx > 0:
            prev_blk = block_list[idx - 1]
            prev_ended = ends_sentence(prev_blk.text)
            prev_tokens = _extract_signal_tokens(prev_blk.text)
            curr_tokens = _extract_signal_tokens(blk.text)
            jaccard = compute_token_jaccard(prev_blk.text, blk.text)
            prev_jaccards = [j for j in jaccards[-3:] if j > 0.0]
            rolling_jaccard = sum(prev_jaccards) / float(len(prev_jaccards)) if prev_jaccards else 0.0
            jaccards.append(jaccard)

            sharp_drop = (
                len(prev_tokens) >= 2
                and len(curr_tokens) >= 2
                and (
                    jaccard <= 0.08
                    or (rolling_jaccard > 0.15 and jaccard < rolling_jaccard * 0.4 and jaccard <= 0.12)
                )
            )
            if prev_ended and sharp_drop:
                _add_tag("LOW_OVERLAP")
                if (
                    jaccard <= 0.05
                    or is_topic_opener_text(blk.text)
                    or is_news_or_list_transition_text(blk.text)
                    or bool(blk.is_topic_opener)
                ) and not starts_with_blocking_connective(blk.text):
                    _add_tag("TOPIC_SHIFT")

            if prev_ended and is_news_or_list_transition_text(blk.text):
                _add_tag("NEWS_TRANSITION")
                _add_tag("TOPIC_SHIFT")

        # 4. Lexical Ad/Sponsor CTA vs Analogy + Multi-Signal Agreement
        low_text = (blk.text or "").lower()
        is_analogy = has_analogy_marker(low_text)
        explicit_hits = [p for p in EXPLICIT_AD_CTA_PATTERNS if p in low_text]
        soft_hits = [p for p in SOFT_AD_CUE_PATTERNS if p in low_text]

        hard_sponsor_markers = (
            "sponsor",
            "patrocin",
            "apoiador",
            "oferecimento",
            "parceria paga",
            "paid partnership",
            "link na descrição",
            "link na descricao",
            "link in description",
            "link in the description",
        )
        has_hard_sponsor = any(m in low_text for m in hard_sponsor_markers)
        corroborating_signals = [
            t for t in tags if t in ("WPM_SHIFT", "PROSODY_SHIFT", "LOW_OVERLAP", "NOISE_FLOOR_SHIFT")
        ]

        if has_hard_sponsor:
            _add_tag("AD_CUE")
        elif explicit_hits and not is_analogy:
            _add_tag("AD_CUE")
        elif soft_hits and not is_analogy and (corroborating_signals or len(soft_hits) >= 2):
            _add_tag("AD_CUE")

        blk.signal_tags = tags

    return block_list


def align_block_bounds_with_words(
    segments: Sequence[Segment],
    words: Sequence[WordTiming] | None = None,
) -> tuple[float, float]:
    """Refine block `(start, end)` using word-level timestamps when available."""
    if not segments:
        return 0.0, 0.0

    raw_start = float(segments[0].start)
    raw_end = float(segments[-1].end)
    if not words:
        return round(raw_start, 3), round(raw_end, 3)

    seg_ids = {s.segment_id for s in segments if s.segment_id}
    matched_words = [
        w
        for w in words
        if (w.segment_id and w.segment_id in seg_ids)
        or (w.start >= raw_start - 0.15 and w.end <= raw_end + 0.15)
    ]
    if not matched_words:
        return round(raw_start, 3), round(raw_end, 3)

    aligned_start = float(matched_words[0].start)
    aligned_end = float(matched_words[-1].end)
    if aligned_end <= aligned_start:
        return round(raw_start, 3), round(raw_end, 3)
    return round(aligned_start, 3), round(aligned_end, 3)


def group_segments_into_semantic_blocks(
    segments: Sequence[Segment],
    words: Sequence[WordTiming] | None = None,
) -> list[SemanticBlock]:
    """Group segments into discourse-aware SemanticBlock items (`b1`, `b2`, ...)."""
    if not segments:
        return []

    blocks: list[SemanticBlock] = []
    current_segments: list[Segment] = []
    current_is_opener: bool = True

    def _finalize_current() -> None:
        nonlocal current_segments, current_is_opener
        if not current_segments:
            return

        block_text = " ".join(s.text.strip() for s in current_segments if s.text.strip()).strip()
        b_start, b_end = align_block_bounds_with_words(current_segments, words)
        block_id = f"b{len(blocks) + 1}"

        # Dominant or first speaker in the block
        speakers = [s.speaker for s in current_segments if s.speaker]
        speaker = speakers[0] if speakers else None

        blocks.append(
            SemanticBlock(
                block_id=block_id,
                start=b_start,
                end=b_end,
                text=block_text,
                segment_ids=[s.segment_id for s in current_segments],
                speaker=speaker,
                is_topic_opener=bool(current_is_opener),
            )
        )
        current_segments = []
        current_is_opener = False

    for seg in segments:
        if not current_segments:
            current_segments.append(seg)
            current_is_opener = (
                len(blocks) == 0
                or is_topic_opener_text(seg.text)
                or not starts_with_blocking_connective(seg.text)
            )
            continue

        prev = current_segments[-1]
        pause = max(0.0, float(seg.start) - float(prev.end))
        block_start = float(current_segments[0].start)
        block_end = float(prev.end)
        current_duration = block_end - block_start
        projected_duration = float(seg.end) - block_start

        prev_ended_sentence = ends_sentence(prev.text)
        prev_is_question = prev.text.strip().endswith("?")
        speaker_changed = bool(
            seg.speaker and prev.speaker and seg.speaker.strip() != prev.speaker.strip()
        )
        has_news_transition = prev_ended_sentence and is_news_or_list_transition_text(seg.text)
        has_topic_marker = is_topic_opener_text(seg.text) or has_news_transition
        blocked_opening = False if has_news_transition else starts_with_blocking_connective(seg.text)

        should_close = False
        next_is_opener = False

        if blocked_opening:
            # Never start a new block on a dependent connective unless emergency cap is exceeded
            if projected_duration >= EMERGENCY_MAX_SECONDS:
                should_close = True
                next_is_opener = False
        else:
            if speaker_changed and current_duration >= 1.5:
                should_close = True
                next_is_opener = True
            elif has_news_transition and current_duration >= 1.5:
                should_close = True
                next_is_opener = True
            elif has_topic_marker and current_duration >= 2.0:
                should_close = True
                next_is_opener = True
            elif prev_is_question and current_duration >= 2.5:
                should_close = True
                next_is_opener = True
            elif pause >= STRONG_PAUSE_SPLIT_SECONDS and current_duration >= 0.4:
                # A strong >=1.5s silence gap unambiguously ends the previous utterance (e.g. ad signoff)
                should_close = True
                next_is_opener = True
            elif pause >= LONG_PAUSE_THRESHOLD_SECONDS and prev_ended_sentence and current_duration >= 1.5:
                should_close = True
                next_is_opener = True
            elif pause >= LONG_PAUSE_THRESHOLD_SECONDS and current_duration >= TARGET_MIN_SECONDS:
                should_close = True
                next_is_opener = True
            elif current_duration >= TARGET_MIN_SECONDS and prev_ended_sentence and pause >= PAUSE_THRESHOLD_SECONDS:
                should_close = True
                next_is_opener = pause >= LONG_PAUSE_THRESHOLD_SECONDS
            elif projected_duration >= TARGET_MAX_SECONDS and (
                prev_ended_sentence or pause >= PAUSE_THRESHOLD_SECONDS or projected_duration >= HARD_MAX_SECONDS
            ):
                should_close = True
                next_is_opener = has_topic_marker or pause >= LONG_PAUSE_THRESHOLD_SECONDS

        if should_close:
            _finalize_current()
            current_segments.append(seg)
            current_is_opener = next_is_opener or has_topic_marker or speaker_changed
        else:
            current_segments.append(seg)

    _finalize_current()
    return enrich_blocks_with_signals(blocks, words=words)


def build_semantic_blocks(
    job_id: str,
    *,
    container: ServiceContainer | None = None,
) -> list[SemanticBlock]:
    """Load transcription artifacts for `job_id`, build discourse-aware semantic blocks, and persist `semantic.blocks.json`."""
    c = container or get_container()
    c.jobs.load_job(job_id)
    c.jobs.update_job_status(job_id, JobStatus.BUILDING_BLOCKS)
    c.runtime.log_stage_start(
        job_id,
        "blocks",
        message="[segmentation] Construindo blocos semânticos conscientes de discurso...",
    )
    c.runtime.publish_state_change(
        job_id,
        status=JobStatus.BUILDING_BLOCKS.value,
        message="[segmentation] Construindo blocos semânticos conscientes de discurso...",
    )

    try:
        segments = c.jobs.load_transcription_segments(job_id)
        if not segments:
            raise ValueError(f"No transcription segments available for job {job_id}")

        words = c.jobs.load_transcription_words(job_id)
        blocks = group_segments_into_semantic_blocks(segments, words=words)

        try:
            audio_wav_path = c.jobs.audio_16k_path(job_id)
            if audio_wav_path.exists() and audio_wav_path.stat().st_size > 44:
                acoustic_signals = compute_block_acoustic_signals(
                    blocks, audio_wav_path=audio_wav_path
                )
                if acoustic_signals:
                    blocks = enrich_blocks_with_signals(
                        blocks, words=words, acoustic_signals=acoustic_signals
                    )
        except Exception:
            pass

        c.jobs.save_semantic_blocks(job_id, blocks)
        c.jobs.update_job_status(job_id, JobStatus.BUILDING_TOPICS)
        c.runtime.log_stage_end(
            job_id,
            "blocks",
            message=f"[segmentation] {len(blocks)} blocos semânticos gerados",
        )
        return blocks
    except Exception as exc:
        c.runtime.log_exception(
            job_id,
            "blocks",
            exc,
            message="[segmentation] Erro ao construir blocos semânticos",
        )
        c.jobs.update_job_status(job_id, JobStatus.ERROR)
        c.runtime.publish_state_change(
            job_id, JobStatus.ERROR.value, f"[segmentation] {exc}"
        )
        raise

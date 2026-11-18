"""Every numeric constant of the v2 pipeline.

Origins: "S<n>" refers to docs/analysis-v2/stage-contracts.md, "pipeline-v2" to
docs/analysis-v2/pipeline-v2.md, "D<n>" to docs/analysis-v2/decisions.md.
Values marked "initial value, tune with the harness" are guesses until the
evaluation harness measures them.
"""

from __future__ import annotations

# --- S0: sentences ---------------------------------------------------------
# Terminal punctuation characters (S0 rule 2). A character set, not a lexicon.
TERMINAL_PUNCTUATION_CHARS = ".!?…"
# Closing quotes/brackets ignored when looking for the terminal character.
TRAILING_CLOSER_CHARS = "\"')]}»”’"
# S0 rule 1: percentile of inter-word pauses used as the threshold.
PAUSE_PERCENTILE = 95.0
# S0 rule 3: percentile used in low-punctuation mode.
PAUSE_PERCENTILE_LOW_PUNCTUATION = 90.0
# S0 rule 1: clamp of the pause threshold, seconds.
PAUSE_THRESHOLD_MIN_SECONDS = 0.4
PAUSE_THRESHOLD_MAX_SECONDS = 1.5
# S0 rule 3: fewer terminal signs than this per 100 words -> low-punctuation mode.
LOW_PUNCTUATION_TERMINALS_PER_100_WORDS = 2.0
# S0 rule 4: a sentence shorter than this (seconds) or with fewer words is merged.
MIN_SENTENCE_SECONDS = 1.0
MIN_SENTENCE_WORDS = 3
# S0 rule 5: a sentence longer than this (seconds) is split at its largest internal pause.
MAX_SENTENCE_SECONDS = 20.0
# Minimum duration given to a zero-length sentence so that start < end always holds
# (S0 invariant "start < end"); implementation detail, not from the spec.
MIN_SENTENCE_DURATION_EPSILON = 0.01

# --- S1: brief (limits applied in code to the LLM output) ------------------
# S1 post-processing: min clamped to [10, 60], max to [45, 180]; default 20/60/120.
UNIT_MIN_SECONDS_CLAMP = (10.0, 60.0)
UNIT_MAX_SECONDS_CLAMP = (45.0, 180.0)
DEFAULT_UNIT_SECONDS_MIN = 20.0
DEFAULT_UNIT_SECONDS_TYPICAL = 60.0
DEFAULT_UNIT_SECONDS_MAX = 120.0
# S1: videos shorter than this skip the map step.
SHORT_VIDEO_SECONDS = 180.0
# S1 map: contiguous chunk size in characters.
BRIEF_MAP_CHUNK_CHARS = 6000

# --- S2: units -------------------------------------------------------------
# S2: window of 80 sentences, overlap of 15.
UNITS_WINDOW_SENTENCES = 80
UNITS_WINDOW_OVERLAP_SENTENCES = 15
# S2 window shrinking when the prompt does not fit the context: each step keeps this
# fraction of the window, never below the minimum (origin: implementer choice, phase 3; not measured).
UNITS_WINDOW_SHRINK_FACTOR = 0.75
UNITS_MIN_WINDOW_SENTENCES = 10
# Safety margin (tokens) kept between the estimated prompt plus max_tokens and the context: the adapter
# estimates after appending its own suffix and may resolve a different loaded model
# (origin: implementer choice, phase 3; not measured).
PROMPT_CONTEXT_MARGIN_TOKENS = 256

# --- S3: candidates --------------------------------------------------------
# S3 sub-span schema: maxItems 2.
MAX_SUBSPANS_PER_UNIT = 2

# --- S4: scoring -----------------------------------------------------------
# S4: up to 3 sentences of previous context, 2 of following context.
SCORING_CONTEXT_SENTENCES_BEFORE = 3
SCORING_CONTEXT_SENTENCES_AFTER = 2
# S4 score formula.
SCORE_INTEREST_WEIGHT = 20
SCORE_PENALTY_NO_PAYOFF = 10
SCORE_PENALTY_DEPENDS_ON_VISUALS = 5
# S4 defect-guided merge: only for candidates with interest >= this.
MERGE_MIN_INTEREST = 3
# S4: at most one merge per side per original candidate.
MAX_MERGES_PER_SIDE = 1

# --- S5: boundary refinement (phase 3; listed so later phases import them) --
S5_START_OPTIONS_BEFORE = 4
S5_START_OPTIONS_INSIDE = 2
S5_START_CONTEXT_AFTER = 3
S5_END_CONTEXT_BEFORE = 3
S5_END_OPTIONS_INSIDE = 2
S5_END_OPTIONS_AFTER = 3
# S5 / pipeline-v2: pre-selected candidates are at most 1.5x max_suggested_cuts.
S5_PRESELECT_FACTOR = 1.5
# S5: re-score when start+end moved this many sentences or more.
S5_RESCORE_MIN_SHIFT_SENTENCES = 2

# --- S6: selection ---------------------------------------------------------
# pipeline-v2 configuration table: analysis_min_interest default.
DEFAULT_MIN_INTEREST = 4
# S6 step 3: temporal IoU above this against an accepted cut discards the lower score.
IOU_THRESHOLD = 0.35
# D14: when nothing reaches the minimum interest, return up to this many candidates ...
FALLBACK_CANDIDATE_COUNT = 3
# ... that have this interest and passed the gates.
FALLBACK_INTEREST = 3
# Score range of a cut (S6 mapping: 0 to 100).
SCORE_MIN = 0
SCORE_MAX = 100

# --- Audience signal (phase 5 part A; opt-in via analysis_v2.audience_signal, default "off") ---
# "bonus" mode: at most this many points are added to the score, proportional to the mean heatmap intensity
# (0..1) of the cut. It is further capped per candidate so it never lifts a candidate over one with a higher
# interest (see selection.apply_audience_bonus). Initial value, tune with the harness.
AUDIENCE_BONUS_MAX_POINTS = 5.0
# Decimals kept when recording / comparing the intensity (implementation detail, not from the spec).
AUDIENCE_INTENSITY_DECIMALS = 6

# --- History, calibration, auto-approve and scoring examples (phase 7; all opt-in, default off) ---
# Version of data/analysis_history.json.
HISTORY_VERSION = 1
# "Enough data" condition for the min-interest suggestion: phase-7.md suggests on the order of 100 judged cuts across
# at least 10 videos before the table means anything. Initial values, to be agreed with the owner.
HISTORY_MIN_JUDGED_CUTS = 100
HISTORY_MIN_JOBS = 10
# suggest_min_interest: a level (pooled with every higher level) needs at least this many decisions ...
SUGGEST_MIN_SAMPLES = 20
# ... and an approval rate of at least this. Initial values, tune with the harness / the owner.
SUGGEST_TARGET_RATE = 0.8
# Decimals of an approval rate (implementation detail).
HISTORY_RATE_DECIMALS = 4
# auto_approve: a selected cut needs at least this interest (conservative: the top of the 1..5 scale).
# Initial value; the owner confirms the calibrated value from suggest_min_interest.
AUTO_APPROVE_DEFAULT_MIN_INTEREST = 5
# analysis_v2.scoring_examples: default count (0 = off) and the largest count accepted (protects the context window).
SCORING_EXAMPLES_DEFAULT = 0
SCORING_EXAMPLES_MAX = 12
# One example's text is cut to whole lines within this many characters (at least its first line is kept).
# Initial value, tune with the harness.
SCORING_EXAMPLE_MAX_CHARS = 700

# --- Conditional vision (phase 6; opt-in via analysis_v2.vision, default false, and llm.vision_model) ---
# Candidates sent to the vision model: depends_on_visuals true and interest at least this (phase-6.md: "interest >= 3";
# same value as MERGE_MIN_INTEREST on purpose, kept separate so the two can be tuned apart).
VISION_MIN_INTEREST = 3
# A video whose speech covers less than this fraction of its duration counts as low-speech: every scored candidate
# with a real interest is then eligible. Initial value, tune with the harness.
VISION_LOW_SPEECH_FRACTION = 0.3
# Upper bound of candidates described per video (best score first), so the vision stage time stays bounded.
# Initial value, tune with the harness.
VISION_MAX_CANDIDATES = 8
# Frames per cut: phase-6.md says 4 to 8. The count used is VISION_FRAME_COUNT (initial value, tune with the harness).
VISION_FRAME_COUNT_MIN = 4
VISION_FRAME_COUNT_MAX = 8
VISION_FRAME_COUNT = 6
# Longer side of an extracted frame, pixels (ffmpeg on CPU, JPEG). Initial value, tune with the harness.
VISION_FRAME_MAX_SIDE_PX = 768
# Seconds one ffmpeg still-frame extraction may take before it is killed and the frame skipped.
# Initial value, tune with the harness.
VISION_FRAME_TIMEOUT_SECONDS = 60.0
# D8: free VRAM (GB) that must be reported after a model was unloaded, before the next one is loaded. The text model
# takes about 9.5 GB of the 12 GB card; the vision model needs room next to nothing else. Initial value; the owner
# confirms it on the real machine (it has never been measured).
VISION_MIN_FREE_VRAM_GB = 8.0
# Free-VRAM checks per unload and the wait between them (the driver may release memory a moment after the unload).
VISION_VRAM_CHECKS = 3
VISION_VRAM_CHECK_DELAY_SECONDS = 1.0
# Output budget of one vision call (a four-field JSON with short text). Initial value, tune with the harness.
MAX_TOKENS_VISION = 500

# --- LLM call budgets (pipeline-v2 "Chamadas ao LLM": max_tokens per stage) -
# All initial values, tune with the harness. Chosen small: outputs are tiny JSON.
MAX_TOKENS_BRIEF_MAP = 200
MAX_TOKENS_BRIEF_REDUCE = 700
MAX_TOKENS_UNITS = 900
MAX_TOKENS_SUBSPAN = 200
MAX_TOKENS_SCORING = 450
# Raised from 150 (phase 3 review): the "reason" field holds a short walk over up to 6 options.
MAX_TOKENS_REFINE = 300

# D16 variant: max_tokens of a call that runs with reasoning on is multiplied by this, so the
# thinking does not consume the whole budget before the JSON (initial value, tune with the harness).
REASONING_MAX_TOKENS_MULTIPLIER = 4

# --- Derived legacy artifacts (phase 4: semantic.blocks.json from sentences) -
# Block duration: a block closes at the target, or before a sentence that would pass the maximum; a single
# sentence longer than the maximum is its own block. Origin: the range the v1 block builder aims for
# (5-20 s target, 30 s max). Initial values, tune with the harness.
BLOCK_TARGET_SECONDS = 12.0
BLOCK_MAX_SECONDS = 30.0

# --- S4 schema: interest scale ----------------------------------------------
# S4 schema: "interest" is an integer enum 1..5.
INTEREST_MIN = 1
INTEREST_MAX = 5

# --- Output rounding (implementation detail, not from the spec) --------------
# Cut times are rounded to milliseconds; duration to 10 ms.
CUT_TIME_DECIMALS = 3
CUT_DURATION_DECIMALS = 2

# --- Pipeline progress inside ANALYZING --------------------------------------
# Cosmetic progress percentages, not from the spec (the SSE contract only needs a monotonic number).
PROGRESS_PCT_S0 = 5.0
PROGRESS_PCT_S1_START = 6.0
PROGRESS_PCT_S1_END = 14.0
PROGRESS_PCT_S2_START = 15.0
PROGRESS_PCT_S2_END = 24.0
PROGRESS_PCT_S3 = 25.0
PROGRESS_PCT_S4_START = 28.0
PROGRESS_PCT_S4_END = 70.0
PROGRESS_PCT_S5_START = 72.0
PROGRESS_PCT_S5_END = 92.0
PROGRESS_PCT_S6 = 95.0

# --- Seed ---------------------------------------------------------------------
# Used only when config.ANALYSIS_SEED is unavailable; mirrors the pipeline-v2 configuration-table default.
DEFAULT_ANALYSIS_SEED = 42

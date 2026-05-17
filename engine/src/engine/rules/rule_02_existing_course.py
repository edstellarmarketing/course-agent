"""Rule 2: don't propose a topic Edstellar already offers.

Two-stage check (architectural plan §3.6):

  (a) Vector similarity: embed the candidate's title+rationale with
      Voyage and compute cosine against every course in the
      inventory matrix. If max similarity >= 0.85 → fail.
  (b) Fuzzy title: RapidFuzz ``token_set_ratio`` between candidate
      title and any course name. If >= 90 → fail.

Both must pass — either alone catches a duplicate. The vector check
catches topical overlap with different wording; the fuzzy check
catches identical phrasings the embedding might think are
distinct (e.g. caps, punctuation).
"""

from __future__ import annotations

import logging

from rapidfuzz import fuzz

from engine.agent.candidate import RawCandidate
from engine.llm.voyage import cosine_similarity_against_matrix, embed_one

log = logging.getLogger(__name__)

COSINE_THRESHOLD = 0.85
FUZZY_THRESHOLD = 90
# Course names shorter than this are too noisy for token-based fuzzy —
# e.g. "Data Privacy" would catch every privacy candidate at 100.
MIN_NAME_FOR_FUZZY = 18


def _candidate_text(c: RawCandidate) -> str:
    return f"{c.title}. {c.rationale}"


def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    matrix = ctx.courses_matrix
    if matrix is None or matrix.shape[0] == 0:
        # No inventory loaded — defensive bail.
        return RuleResult.passed()

    # (a) Vector probe. Cache the embedding so Rule 9 + cross-batch
    # dedupe reuse it later in the run.
    cache = ctx.embeddings_cache
    vec = cache.get(candidate.title)
    if vec is None:
        vec = embed_one(
            _candidate_text(candidate),
            ledger=ctx.ledger,
            input_type="document",
        )
        cache[candidate.title] = vec
    sims = cosine_similarity_against_matrix(vec, matrix)
    max_sim_idx = int(sims.argmax())
    max_sim = float(sims[max_sim_idx])
    if max_sim >= COSINE_THRESHOLD:
        course_id = ctx.course_ids[max_sim_idx]
        return RuleResult.failed(
            f"cosine {max_sim:.2f} >= {COSINE_THRESHOLD} vs courses[{course_id}]"
        )

    # (b) Fuzzy title against every course name. We use the MIN of
    # token_set_ratio (order/duplication insensitive) and ratio
    # (length-aware Levenshtein) so a long candidate that merely
    # contains every word of a short course name doesn't score 100.
    # Course names shorter than MIN_NAME_FOR_FUZZY get skipped —
    # 2-word existing-course names like "Data Privacy" would match
    # too aggressively against any candidate in the same domain.
    for name in ctx.course_names:
        if len(name) < MIN_NAME_FOR_FUZZY:
            continue
        ts = fuzz.token_set_ratio(candidate.title, name)
        rr = fuzz.ratio(candidate.title, name)
        score = min(ts, rr)
        if score >= FUZZY_THRESHOLD:
            return RuleResult.failed(
                f"fuzzy title {score} >= {FUZZY_THRESHOLD} vs course {name!r}"
            )

    return RuleResult.passed()

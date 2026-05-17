"""Rule 9: don't re-propose something a reviewer rejected recently.

Phase 6: cosine vs ``ctx.recent_rejection_matrix`` < 0.82 — same
embedding model as Rule 2. The matrix is populated by the
feedback_ingest node (Step 6 partial) from suggestions with
decision='rejected' AND created_at >= now() - 90 days, with their
already-populated embeddings.

Suggestions seeded by migration 0006 have NULL embeddings, so the
matrix can legitimately be empty on the first run — Rule 9 always
passes in that case. Once Step 8 starts persisting candidates with
their embeddings, future runs will populate the matrix and the rule
becomes load-bearing.

Threshold is slightly lower than Rule 2 (0.82 vs 0.85): a rejection
encodes more signal than the bare inventory, so we want a tighter
guard against re-suggesting it.
"""

from __future__ import annotations

import logging

from engine.agent.candidate import RawCandidate
from engine.llm.voyage import cosine_similarity_against_matrix, embed_one

log = logging.getLogger(__name__)

COSINE_THRESHOLD = 0.82


def _candidate_text(c: RawCandidate) -> str:
    return f"{c.title}. {c.rationale}"


def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    matrix = ctx.recent_rejection_matrix
    if matrix is None or matrix.shape[0] == 0:
        return RuleResult.passed()

    # Reuse the embedding Rule 2 already computed if it's in the cache;
    # only embed fresh if Rule 2 happened to be skipped.
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
    max_sim = float(sims.max())
    if max_sim >= COSINE_THRESHOLD:
        return RuleResult.failed(
            f"cosine {max_sim:.2f} >= {COSINE_THRESHOLD} vs recent rejection"
        )
    return RuleResult.passed()

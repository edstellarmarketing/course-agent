"""Apply Rule 1 across the run's surviving candidates.

Pairwise cosine < 0.85 between every pair of survivors. When two
candidates cross the threshold we drop the lower-priced one — a
rough proxy for "less premium / less defensible" that the reviewer
can override on /suggestions/today.

Embeddings come from the run's ``embeddings_cache`` (populated by
Rule 2 in the dispatcher), so no fresh Voyage calls happen here.
If a survivor somehow lacks an embedding (Rule 2 skipped for some
reason), we embed it once now and update the cache.
"""

from __future__ import annotations

import logging

import numpy as np

from engine.agent.state import AgentState
from engine.llm.voyage import embed_one

log = logging.getLogger(__name__)

PAIRWISE_THRESHOLD = 0.85


def run(state: AgentState) -> AgentState:
    survivors = state.get("surviving_candidates") or []
    if len(survivors) < 2:
        log.info("node=cross_batch_dedupe survivors=%d nothing to compare", len(survivors))
        return {"final_candidates": survivors}

    cache: dict[str, np.ndarray] = state.get("_embeddings_cache") or {}  # type: ignore[assignment]
    ledger = state.get("_ledger")  # type: ignore[typeddict-item]

    titles = [c["title"] for c in survivors]
    vectors: list[np.ndarray] = []
    for c in survivors:
        v = cache.get(c["title"])
        if v is None and ledger is not None:
            v = embed_one(
                f"{c['title']}. {c.get('rationale', '')}",
                ledger=ledger,
                input_type="document",
            )
            cache[c["title"]] = v
        vectors.append(v)

    matrix = np.stack(vectors, axis=0).astype(np.float32)
    norms = np.linalg.norm(matrix, axis=1)
    norms = np.where(norms == 0, 1.0, norms)
    normalized = matrix / norms[:, None]
    sims = normalized @ normalized.T

    keep = [True] * len(survivors)
    n = len(survivors)
    for i in range(n):
        if not keep[i]:
            continue
        for j in range(i + 1, n):
            if not keep[j]:
                continue
            if sims[i, j] >= PAIRWISE_THRESHOLD:
                # Drop the lower-priced of the pair.
                if survivors[i]["suggested_price_usd"] >= survivors[j]["suggested_price_usd"]:
                    keep[j] = False
                    log.info(
                        "rule_01 dedupe drop=%r kept=%r sim=%.2f",
                        titles[j],
                        titles[i],
                        sims[i, j],
                    )
                else:
                    keep[i] = False
                    log.info(
                        "rule_01 dedupe drop=%r kept=%r sim=%.2f",
                        titles[i],
                        titles[j],
                        sims[i, j],
                    )
                    break

    final = [c for c, k in zip(survivors, keep, strict=False) if k]
    log.info(
        "node=cross_batch_dedupe in=%d out=%d dropped=%d",
        len(survivors),
        len(final),
        len(survivors) - len(final),
    )
    return {"final_candidates": final}

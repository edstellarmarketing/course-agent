"""Apply Rule 1 across the run's survivors (intra-batch dedupe).

Phase 6 Step 1: stub.
Phase 6 Step 8: pairwise cosine < 0.85 within surviving candidates;
iteratively drop the lower-priced of any pair that crosses the
threshold.
"""

from __future__ import annotations

import logging

from engine.agent.state import AgentState

log = logging.getLogger(__name__)


def run(state: AgentState) -> AgentState:
    survivors = state.get("surviving_candidates", [])
    log.info("node=cross_batch_dedupe input=%d (stub)", len(survivors))
    return {"final_candidates": survivors}

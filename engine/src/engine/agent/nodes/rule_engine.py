"""Run every raw candidate through the rule dispatcher.

Phase 6 Step 1: stub.
Phase 6 Step 6: dispatcher runs all 10 rules in cost order, logging
``rule=… reason=…`` for each rejection so post-run audits can show
rejection-by-rule. Each survivor moves to cross_batch_dedupe.
"""

from __future__ import annotations

import logging

from engine.agent.state import AgentState

log = logging.getLogger(__name__)


def run(state: AgentState) -> AgentState:
    raw = state.get("raw_candidates", [])
    log.info("node=rule_engine input_candidates=%d (stub)", len(raw))
    return {"surviving_candidates": [], "rejections_by_rule": {}}

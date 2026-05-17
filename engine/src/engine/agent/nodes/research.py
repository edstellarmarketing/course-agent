"""Run ScrapeGraphAI's SearchGraph per targeted category.

Phase 6 Step 1: stub.
Phase 6 Step 5: ScrapeGraphAI configured with OpenRouter for LLM +
Serper for search. Returns ~20 raw RawCandidate objects per category.
"""

from __future__ import annotations

import logging

from engine.agent.state import AgentState

log = logging.getLogger(__name__)


def run(state: AgentState) -> AgentState:
    targets = state.get("targeted_categories", [])
    log.info("node=research targets=%d (stub)", len(targets))
    return {"raw_candidates": []}

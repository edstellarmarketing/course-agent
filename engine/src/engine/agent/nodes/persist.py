"""Insert agent_runs + surviving suggestions into Supabase.

Phase 6 Step 1: stub. Honours ``dry_run`` for future steps even now.
Phase 6 Step 8: real writes — agent_runs row first (with all cost
columns from the RunCostLedger), then surviving suggestions with
status='pending_review' and Voyage embeddings populated.
"""

from __future__ import annotations

import logging

from engine.agent.state import AgentState

log = logging.getLogger(__name__)


def run(state: AgentState) -> AgentState:
    finals = state.get("final_candidates", [])
    dry_run = state.get("dry_run", False)
    log.info(
        "node=persist final=%d dry_run=%s (stub)",
        len(finals),
        dry_run,
    )
    return {"run_id": None, "prompt_version_id": None}

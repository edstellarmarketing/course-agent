"""Pull yesterday's rejections so Rule 9 has a vector blocklist.

Phase 6 Step 1: stub. Step 6 fills this in by reading from
`feedback` joined to `suggestions` where decision='rejected'
AND created_at >= now() - interval '90 days'.
"""

from __future__ import annotations

import logging

from engine.agent.state import AgentState

log = logging.getLogger(__name__)


def run(state: AgentState) -> AgentState:
    log.info(
        "node=feedback_ingest dry_run=%s forced_category=%r",
        state.get("dry_run", False),
        state.get("forced_category"),
    )
    return {"recent_rejections": []}

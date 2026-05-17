"""Run every raw candidate through the 10 rules in cost order.

The dispatcher (``engine.rules.dispatcher``) owns the rule order and
fail-on-first semantics. This node's job is to build the
``RuleContext`` from the state once and pass each candidate through.

The Rule 2 / Rule 9 ``embeddings_cache`` is mirrored back into the
state as ``_embeddings_cache`` so ``cross_batch_dedupe`` can reuse
the vectors without paying Voyage again.
"""

from __future__ import annotations

import logging
from typing import Any

from engine.agent.candidate import RawCandidate
from engine.agent.nodes.inventory_read import load_inventory
from engine.agent.state import AgentState
from engine.rules.dispatcher import RuleContext, run_rules

log = logging.getLogger(__name__)


def run(state: AgentState) -> AgentState:
    raw_dicts: list[dict[str, Any]] = state.get("raw_candidates") or []
    retry_dicts: list[dict[str, Any]] = state.get("retry_candidates") or []
    or_client = state.get("_or_client")  # type: ignore[typeddict-item]
    ledger = state.get("_ledger")  # type: ignore[typeddict-item]

    # Retry candidates flow through the same 10 rules as fresh
    # research output — Phase 8 Step 5 explicitly wants them on the
    # same path so a revised candidate doesn't sneak past Rule 9 or 10.
    combined = retry_dicts + raw_dicts
    if not combined:
        log.info("node=rule_engine no candidates")
        return {
            "surviving_candidates": [],
            "rejections_by_rule": {},
        }

    # Re-instantiate pydantic models; AgentState carries plain dicts so
    # LangGraph's JSON serialization stays clean.
    candidates = [RawCandidate.model_validate(d) for d in combined]

    inv = load_inventory()
    course_names = [c.get("name", "") for c in inv.courses]
    category_names = {c["name"] for c in inv.categories}

    # Phase 6 Step 6: no recent-rejection matrix yet. Step 6's
    # feedback_ingest stub populates the slot with None — Rule 9
    # then passes through. Future runs (Phase 8) will fill this.
    recent_rejection_matrix = state.get("_recent_rejection_matrix")  # type: ignore[typeddict-item]

    ctx = RuleContext(
        category_names=category_names,
        courses_matrix=inv.courses_matrix,
        course_ids=inv.course_ids,
        course_names=course_names,
        recent_rejection_matrix=recent_rejection_matrix,
        or_client=or_client,
        ledger=ledger,
    )

    survivors, rejection_counts = run_rules(candidates, ctx)

    return {
        "surviving_candidates": [s.model_dump() for s in survivors],
        "rejections_by_rule": rejection_counts,
        "_embeddings_cache": ctx.embeddings_cache,  # type: ignore[typeddict-item]
    }

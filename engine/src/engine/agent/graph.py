"""LangGraph wiring for the agent pipeline.

Phase 9 Step 4 introduced parallel per-category research via
``Send``. The topology now branches at ``needs_revision_retry``:

  needs_revision_retry
      └─ (conditional, one Send per category) ─► research_one  ◄── (parallel)
                                                       │
                                                       └─► rule_engine
                                                                │
                                                                ▼
                                                       cross_batch_dedupe
                                                                │
                                                                ▼
                                                            persist

LangGraph runs each ``Send("research_one", …)`` in parallel and
concatenates the per-branch ``raw_candidates`` via the
``Annotated[list, operator.add]`` reducer on ``AgentState``. The
shared ``RunCostLedger`` is lock-protected so concurrent appends
from branches don't race.
"""

from __future__ import annotations

import logging

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from engine.agent.nodes import (
    cross_batch_dedupe,
    feedback_ingest,
    gap_analyze,
    inventory_read,
    needs_revision_retry,
    persist,
    research,
    rule_engine,
)
from engine.agent.state import AgentState

log = logging.getLogger(__name__)


def _research_router(state: AgentState) -> list[Send] | str:
    """Conditional edge from ``needs_revision_retry``.

    Emits one ``Send("research_one", …)`` per targeted category so
    every category researches in parallel. The Send dict carries
    only what ``research_one_node`` reads — the OpenRouter client,
    cost ledger, resolved prompt text, per-category ceiling, and
    the branch's category.

    When no categories are targeted (gap_analyze degenerate case),
    skip research entirely and route straight to rule_engine.
    """
    targets = state.get("targeted_categories") or []
    if not targets:
        log.info("research_router: no targeted_categories — skipping research")
        return "rule_engine"

    or_client = state.get("_or_client")  # type: ignore[typeddict-item]
    ledger = state.get("_ledger")  # type: ignore[typeddict-item]
    prompt_text = state.get("_prompt_system_text")  # type: ignore[typeddict-item]
    max_candidates = state.get("max_candidates_per_category", 20)

    # Existing category names so each research_one branch can decide
    # when a candidate would represent a brand-new category vs a
    # duplicate of something already in the inventory.
    existing_category_names = [
        c["name"] for c in (state.get("categories") or []) if c.get("name")
    ]

    log.info("research_router: fanning out %d categories in parallel", len(targets))
    return [
        Send(
            "research_one",
            {
                "_branch_category": c,
                "_or_client": or_client,
                "_ledger": ledger,
                "_prompt_system_text": prompt_text,
                "max_candidates_per_category": max_candidates,
                "_existing_categories": existing_category_names,
            },
        )
        for c in targets
    ]


def build_graph():
    """Compile and return the runnable LangGraph for one agent run."""
    g = StateGraph(AgentState)

    g.add_node("feedback_ingest", feedback_ingest.run)
    g.add_node("inventory_read", inventory_read.run)
    g.add_node("gap_analyze", gap_analyze.run)
    g.add_node("needs_revision_retry", needs_revision_retry.run)
    g.add_node("research_one", research.research_one_node)
    g.add_node("rule_engine", rule_engine.run)
    g.add_node("cross_batch_dedupe", cross_batch_dedupe.run)
    g.add_node("persist", persist.run)

    g.add_edge(START, "feedback_ingest")
    g.add_edge("feedback_ingest", "inventory_read")
    g.add_edge("inventory_read", "gap_analyze")
    g.add_edge("gap_analyze", "needs_revision_retry")

    # Phase 9 Step 4: fan-out instead of a single research node.
    # The router emits Sends (or "rule_engine" when no targets).
    g.add_conditional_edges(
        "needs_revision_retry",
        _research_router,
        {"research_one": "research_one", "rule_engine": "rule_engine"},
    )
    g.add_edge("research_one", "rule_engine")
    g.add_edge("rule_engine", "cross_batch_dedupe")
    g.add_edge("cross_batch_dedupe", "persist")
    g.add_edge("persist", END)

    return g.compile()

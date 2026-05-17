"""Shared TypedDict state passed between every node in the agent graph.

LangGraph's StateGraph dispatches each node a snapshot of this dict
and merges any returned partial-dict back into the running state. We
use ``total=False`` so nodes can return only the keys they touched.

Field-set sources:

  CLI / pre-run
    dry_run, forced_category, top_k, max_candidates_per_category

  feedback_ingest
    recent_rejections (last 90d, vector-ready)

  inventory_read
    courses, categories, courses_matrix
    (courses_matrix is held as a numpy ndarray in the inventory cache,
    not in state — the state field is a handle to the cache, populated
    once in Step 2)

  gap_analyze
    targeted_categories

  research (per category, aggregated)
    raw_candidates

  rule_engine
    surviving_candidates
    rejections_by_rule  (for run summaries / Langfuse spans)

  cross_batch_dedupe
    final_candidates

  persist
    run_id, prompt_version_id

Phase 6 Step 1 only reads `dry_run`, `forced_category`, `top_k`, and
`max_candidates_per_category` — the rest are stubs until later steps.
"""

from __future__ import annotations

from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    # ── CLI / pre-run inputs ─────────────────────────────────────
    dry_run: bool
    forced_category: str | None
    top_k: int
    max_candidates_per_category: int

    # ── Populated by feedback_ingest ────────────────────────────
    recent_rejections: list[dict[str, Any]]

    # ── Populated by inventory_read ─────────────────────────────
    courses: list[dict[str, Any]]
    categories: list[dict[str, Any]]

    # ── Populated by gap_analyze ────────────────────────────────
    targeted_categories: list[str]

    # ── Populated by research (per-category, merged) ────────────
    raw_candidates: list[dict[str, Any]]

    # ── Populated by rule_engine ────────────────────────────────
    surviving_candidates: list[dict[str, Any]]
    rejections_by_rule: dict[str, int]

    # ── Populated by cross_batch_dedupe ─────────────────────────
    final_candidates: list[dict[str, Any]]

    # ── Populated by persist ────────────────────────────────────
    run_id: str | None
    prompt_version_id: str | None

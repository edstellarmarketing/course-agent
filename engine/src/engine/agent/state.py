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

import operator
from typing import Annotated, Any, TypedDict


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

    # ── Populated by needs_revision_retry (Phase 8 Step 5) ──────
    # Each item carries a parent_id pointing back at the original
    # suggestion the reviewer marked needs_revision. Flows into the
    # rule_engine alongside raw_candidates.
    retry_candidates: list[dict[str, Any]]

    # ── Populated by research (per-category, merged) ────────────
    # Phase 9 Step 4: parallel research via LangGraph `Send` fans out
    # one branch per targeted category. Each branch returns its
    # category's candidates and the reducer concatenates them into a
    # single list before the rule engine runs. Without operator.add
    # the default reducer REPLACES the list and we'd silently keep
    # only the last branch's output.
    raw_candidates: Annotated[list[dict[str, Any]], operator.add]

    # ── Populated by rule_engine ────────────────────────────────
    surviving_candidates: list[dict[str, Any]]
    rejections_by_rule: dict[str, int]

    # ── Populated by cross_batch_dedupe ─────────────────────────
    final_candidates: list[dict[str, Any]]

    # ── Populated by persist ────────────────────────────────────
    run_id: str | None
    prompt_version_id: str | None

    # ── Runtime-only handles threaded by cli.py ──────────────────
    # These are non-JSON-serializable objects (OpenRouter client,
    # cost ledger, the embeddings cache from Rule 2, the recent-
    # rejection matrix). LangGraph 1.x's StateGraph strips keys
    # not declared on the schema, so we have to list them here
    # even though they're conceptually "context" rather than state.
    # Phase 8 may move them into a LangGraph context_schema.
    _or_client: Any
    _ledger: Any
    _embeddings_cache: dict[str, Any]
    _recent_rejection_matrix: Any

    # ── Phase 8 Step 6 — DB-driven prompt versioning ─────────────
    # feedback_ingest resolves the active (or A/B-chosen candidate)
    # prompt_versions row at run start; research reads the text,
    # persist writes the id onto agent_runs.prompt_version_id.
    _prompt_version_id: str | None
    _prompt_version_status: str  # 'active', 'candidate', or 'fallback'
    _prompt_system_text: str

    # ── Phase 9 Step 4 — branch-local category for Send fan-out ──
    # Set by the research router (`research_router` in graph.py) when
    # it emits one Send per targeted category. The `research_one_node`
    # reads this and processes exactly that category.
    _branch_category: str

    # ── Existing-category list for new-category proposals ───────
    # research_one passes this to the LLM so it can identify whether
    # a proposed `category` value would be brand new (signalling a
    # legitimate gap) vs duplicating something Edstellar already
    # tracks. The router populates it from `state["categories"]`.
    _existing_categories: list[str]

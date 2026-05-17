"""Pull recent reviewer rejections to feed Rule 9's negative memory.

The architectural plan §3.8(b)(1) — every run starts by walking the
last 90 days of `decision='rejected'` feedback rows, joining to
their parent suggestions to grab the Voyage embeddings, and stacking
those into a numpy matrix the dispatcher passes through ``RuleContext``.

A candidate whose ``embed_one(title + rationale)`` is within
``COSINE_THRESHOLD = 0.82`` of any past rejection is dropped by
Rule 9 — closes the loop that lets the agent re-propose ideas
reviewers already said no to.

Phase 6 left this node as a stub returning an empty matrix. Phase 8
Step 2 wires it for real. Suggestions backfilled in Step 1 mean the
matrix is never empty after the first reviewer action.

Performance: a 90-day window of rejections is small (currently a
handful, scales to maybe hundreds in steady state). Single round
trip; no pagination yet. Phase 9 may add an embed-row cache if
the window ever covers thousands of rows.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np

from engine.agent.state import AgentState
from engine.supabase import supabase

log = logging.getLogger(__name__)

REJECTION_WINDOW_DAYS = 90


def _parse_embedding(emb: Any) -> list[float] | None:
    """PostgREST returns ``vector(1024)`` as a JSON-encoded string."""
    if emb is None:
        return None
    if isinstance(emb, str):
        try:
            return json.loads(emb)
        except json.JSONDecodeError:
            return None
    if isinstance(emb, list):
        return [float(x) for x in emb]
    return None


def run(state: AgentState) -> AgentState:
    cutoff_iso = (
        datetime.now(UTC) - timedelta(days=REJECTION_WINDOW_DAYS)
    ).isoformat()

    sb = supabase()
    resp = (
        sb.table("feedback")
        .select(
            "suggestion_id,reason_tags,reason_text,created_at,"
            "suggestions(title,category,embedding)"
        )
        .eq("decision", "rejected")
        .gte("created_at", cutoff_iso)
        .order("created_at", desc=True)
        .execute()
    )
    rows: list[dict[str, Any]] = resp.data or []

    # PostgREST 1:1 embedding returns the related row as a single
    # object at runtime (despite supabase-js typing it as an array).
    # Filter out any rejection whose suggestion was deleted or has
    # no embedding yet — defensive guard, Step 1's backfill should
    # mean this never fires today.
    vectors: list[list[float]] = []
    kept: list[dict[str, Any]] = []
    for r in rows:
        sug = r.get("suggestions")
        if not sug:
            continue
        vec = _parse_embedding(sug.get("embedding"))
        if vec is None or len(vec) != 1024:
            continue
        vectors.append(vec)
        kept.append(
            {
                "suggestion_id": r["suggestion_id"],
                "title": sug.get("title"),
                "category": sug.get("category"),
                "reason_tags": r.get("reason_tags") or [],
                "reason_text": r.get("reason_text"),
                "created_at": r["created_at"],
            }
        )

    matrix = (
        np.asarray(vectors, dtype=np.float32) if vectors else None
    )

    log.info(
        "node=feedback_ingest window_days=%d rejections=%d matrix=%s "
        "forced_category=%r",
        REJECTION_WINDOW_DAYS,
        len(kept),
        tuple(matrix.shape) if matrix is not None else "()",
        state.get("forced_category"),
    )
    return {
        "recent_rejections": kept,
        "_recent_rejection_matrix": matrix,
    }

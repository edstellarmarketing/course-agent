"""Rank categories by under-supply × demand × pinned override, with
recency-based rotation so the agent picks DIFFERENT categories on
different days when possible.

Phase 9 update (drop ``target_count``):
The admin-set ``target_count`` is no longer consulted. Instead, the
agent derives an *implicit* target from the inventory's own
distribution — the 75th-percentile course count across all
categories. Anything below that target is treated as under-supplied
in proportion to the gap. The intuition: a category is "well stocked"
once its count is at-or-above the top quartile of all categories;
everything else is a candidate for fresh research.

Phase 9 update (rotation):
Without rotation, the same handful of perpetually under-supplied
categories get picked every day — reviewers end up triaging more
ICS-Security or Quantum-Cryptography suggestions instead of seeing
breadth across the catalogue. New behaviour:

  - Look at ``agent_runs.categories_targeted`` for the last 7 days.
  - For each category researched in that window, multiply its score
    by RECENCY_PENALTY (0.3 — a 70% deprioritization).
  - Pinned categories bypass the penalty entirely (admin pinning
    means "always research"; the rotation logic mustn't override
    a deliberate admin signal).

The penalty rotates the picks naturally: yesterday's targets sink
to the bottom of their bracket and next-best under-supplied
categories rise. Over a week, the agent typically covers 20-35
distinct categories instead of repeating the same 5.

Score formula (replaces architectural plan §4 step 4):

    target       = max(p75(course_count across categories), MIN_TARGET)
    under_supply = max(0, target - this_course_count)
    score        = under_supply * (demand_score or 1.0)
    if recently_targeted and not pinned:
        score *= RECENCY_PENALTY
    if is_pinned:
        score += PIN_BONUS         # pinned always wins

``MIN_TARGET`` (10) is a floor so a freshly-seeded DB where every
category has near-zero courses still has the agent producing real
gradient between them rather than scoring everything zero.

The CLI's ``--category X`` flag short-circuits scoring entirely and
returns ``[X]`` after validating the name exists. ``--top-k N``
controls fan-out otherwise.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from engine.agent.state import AgentState
from engine.supabase import supabase

log = logging.getLogger(__name__)

# Floor on the implicit target. Keeps the score gradient meaningful
# when the whole catalogue is small (e.g. fresh deploy with <10
# courses per category — without a floor, p75 would be tiny and
# every category would score near zero).
MIN_TARGET = 10
PIN_BONUS = 1000.0

# Phase 9 reviewer feedback: recency-based rotation.
# A category researched in the last RECENCY_WINDOW_DAYS gets its
# score multiplied by RECENCY_PENALTY, so different categories
# bubble to the top on different days.
RECENCY_WINDOW_DAYS = 7
RECENCY_PENALTY = 0.3  # 70% deprioritization


def _implicit_target(categories: list[dict[str, Any]]) -> int:
    """Derive the "well-stocked" line from the inventory itself.

    Returns the 75th-percentile course count across all categories,
    floored at MIN_TARGET. Categories with course_count at-or-above
    this number are considered well-supplied and score zero for
    under-supply.
    """
    counts = sorted((c.get("course_count") or 0) for c in categories)
    if not counts:
        return MIN_TARGET
    idx = min(len(counts) - 1, int(len(counts) * 0.75))
    return max(counts[idx], MIN_TARGET)


def _recently_targeted(window_days: int = RECENCY_WINDOW_DAYS) -> set[str]:
    """Set of category names researched in any agent_run in the last
    ``window_days`` days. Used by the rotation logic to deprioritize
    repeats.

    Failures (DB down, etc.) return an empty set — the rotation
    silently degrades to non-rotation rather than failing the run.
    """
    cutoff = (datetime.now(UTC) - timedelta(days=window_days)).isoformat()
    try:
        rows = (
            supabase()
            .table("agent_runs")
            .select("categories_targeted")
            .gte("started_at", cutoff)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001 — rotation is best-effort
        log.warning(
            "gap_analyze recency lookup failed: %s — proceeding without rotation",
            exc,
        )
        return set()
    targeted: set[str] = set()
    for r in rows:
        for cat in r.get("categories_targeted") or []:
            if cat:
                targeted.add(cat)
    return targeted


def _score(
    cat: dict[str, Any],
    *,
    implicit_target: int,
    recently_targeted: set[str],
) -> float:
    course_count = cat.get("course_count") or 0
    under_supply = max(0, implicit_target - course_count)
    demand = cat.get("demand_score") or 1.0
    score = under_supply * demand
    # Phase 9: rotation. Pinned categories bypass the penalty.
    if not cat.get("is_pinned") and cat.get("name") in recently_targeted:
        score *= RECENCY_PENALTY
    if cat.get("is_pinned"):
        score += PIN_BONUS
    return float(score)


def rank_categories(
    categories: list[dict[str, Any]],
    top_k: int,
    *,
    recently_targeted: set[str] | None = None,
) -> list[tuple[str, float]]:
    """Return ``(name, score)`` for the top-K categories, highest first.

    ``recently_targeted`` is injectable so tests can pass an empty set
    (skip rotation) without hitting Supabase.
    """
    target = _implicit_target(categories)
    recent = recently_targeted if recently_targeted is not None else set()
    scored = [
        (c["name"], _score(c, implicit_target=target, recently_targeted=recent))
        for c in categories
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def run(state: AgentState) -> AgentState:
    categories = state.get("categories") or []
    top_k = state.get("top_k", 5)
    forced = state.get("forced_category")

    if forced:
        # Validate the override matches a real category; otherwise
        # the FK on suggestions.category will reject every candidate
        # later and the run becomes a no-op.
        names = {c["name"] for c in categories}
        if forced not in names:
            raise ValueError(
                f"--category {forced!r} not found among {len(names)} categories. "
                f"Run `agent gap-analyze` to see the full list."
            )
        targeted = [forced]
        log.info(
            "node=gap_analyze forced=%r (override) targeted=%r",
            forced,
            targeted,
        )
        return {"targeted_categories": targeted}

    implicit_target = _implicit_target(categories)
    recently = _recently_targeted()
    ranked = rank_categories(categories, top_k, recently_targeted=recently)
    targeted = [name for name, _ in ranked]
    log.info(
        "node=gap_analyze implicit_target=%d recent_window=%dd recent_n=%d top_k=%d ranked=%s",
        implicit_target,
        RECENCY_WINDOW_DAYS,
        len(recently),
        top_k,
        ", ".join(f"{n}({s:.0f})" for n, s in ranked),
    )
    return {"targeted_categories": targeted}

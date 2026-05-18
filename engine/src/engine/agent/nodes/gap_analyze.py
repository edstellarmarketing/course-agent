"""Rank categories by under-supply × demand × pinned override.

Phase 9 update: the admin-set ``target_count`` is no longer consulted.
Instead, the agent derives an *implicit* target from the inventory's
own distribution — the 75th-percentile course count across all
categories. Anything below that target is treated as under-supplied
in proportion to the gap. The intuition: a category is "well stocked"
once its count is at-or-above the top quartile of all categories;
everything else is a candidate for fresh research.

Why drop the admin target:

  - target_count was rarely set; the default of 50 was doing the
    real work in production.
  - Hard-coded targets don't adapt as the catalogue grows. The
    same "50" that meant "well-stocked" at 200 courses means
    "barely started" at 2,000.
  - Admins still have explicit control via ``is_pinned`` and
    ``demand_score`` (both kept in the formula). The implicit
    target removes one source of manual config drift while
    keeping the levers that mattered.

Score formula (replaces architectural plan §4 step 4):

    target       = max(p75(course_count across categories), MIN_TARGET)
    under_supply = max(0, target - this_course_count)
    score        = under_supply * (demand_score or 1.0)
    if is_pinned: score += PIN_BONUS         # pinned always wins

``MIN_TARGET`` (10) is a floor so a freshly-seeded DB where every
category has near-zero courses still has the agent producing real
gradient between them rather than scoring everything zero.

The CLI's ``--category X`` flag short-circuits scoring entirely and
returns ``[X]`` after validating the name exists. ``--top-k N``
controls fan-out otherwise.
"""

from __future__ import annotations

import logging
from typing import Any

from engine.agent.state import AgentState

log = logging.getLogger(__name__)

# Floor on the implicit target. Keeps the score gradient meaningful
# when the whole catalogue is small (e.g. fresh deploy with <10
# courses per category — without a floor, p75 would be tiny and
# every category would score near zero).
MIN_TARGET = 10
PIN_BONUS = 1000.0


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
    # 75th-percentile index. nearest-rank method is fine at this
    # scale (43 categories today); a proper interpolation would be
    # overkill.
    idx = min(len(counts) - 1, int(len(counts) * 0.75))
    return max(counts[idx], MIN_TARGET)


def _score(cat: dict[str, Any], *, implicit_target: int) -> float:
    course_count = cat.get("course_count") or 0
    under_supply = max(0, implicit_target - course_count)
    demand = cat.get("demand_score") or 1.0
    score = under_supply * demand
    if cat.get("is_pinned"):
        score += PIN_BONUS
    return float(score)


def rank_categories(
    categories: list[dict[str, Any]], top_k: int
) -> list[tuple[str, float]]:
    """Return ``(name, score)`` for the top-K categories, highest first."""
    target = _implicit_target(categories)
    scored = [(c["name"], _score(c, implicit_target=target)) for c in categories]
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
    ranked = rank_categories(categories, top_k)
    targeted = [name for name, _ in ranked]
    log.info(
        "node=gap_analyze implicit_target=%d top_k=%d ranked=%s",
        implicit_target,
        top_k,
        ", ".join(f"{n}({s:.0f})" for n, s in ranked),
    )
    return {"targeted_categories": targeted}

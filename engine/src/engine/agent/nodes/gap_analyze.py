"""Rank categories by under-supply × demand × pinned override.

Score formula (architectural plan §4 step 4):

    under_supply = max(0, (target_count or default_target) - course_count)
    score        = under_supply * (demand_score or 1.0)
    if is_pinned: score += 1000   # pinned always wins

Default target is ``DEFAULT_TARGET_COUNT`` (50) for categories where
the admin hasn't set a target — covers the bulk of our 43 today.

The CLI's ``--category X`` flag short-circuits scoring entirely and
returns ``[X]`` after validating the name exists. ``--top-k N``
controls fan-out otherwise.
"""

from __future__ import annotations

import logging
from typing import Any

from engine.agent.state import AgentState

log = logging.getLogger(__name__)

DEFAULT_TARGET_COUNT = 50
PIN_BONUS = 1000.0


def _score(cat: dict[str, Any]) -> float:
    target = cat.get("target_count") or DEFAULT_TARGET_COUNT
    course_count = cat.get("course_count") or 0
    under_supply = max(0, target - course_count)
    demand = cat.get("demand_score") or 1.0
    score = under_supply * demand
    if cat.get("is_pinned"):
        score += PIN_BONUS
    return float(score)


def rank_categories(
    categories: list[dict[str, Any]], top_k: int
) -> list[tuple[str, float]]:
    """Return ``(name, score)`` for the top-K categories, highest first."""
    scored = [(c["name"], _score(c)) for c in categories]
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

    ranked = rank_categories(categories, top_k)
    targeted = [name for name, _ in ranked]
    log.info(
        "node=gap_analyze top_k=%d ranked=%s",
        top_k,
        ", ".join(f"{n}({s:.0f})" for n, s in ranked),
    )
    return {"targeted_categories": targeted}

"""Per-category prompt guardrails driven by recent rejection patterns.

Phase 8 Step 4. Reads ``prompts/category_guardrails.json`` at import
time. For each targeted category, counts the dominant rejection tag
over the last 30 days; if that tag matches the JSON's ``trigger_tag``
for the category, the ``addendum`` string is appended to the research
system prompt for that category only.

The architectural plan §3.8(b)(2) frames this as "if
``not_instructor_led_market`` dominates in a category, the prompt for
that category gains an extra constraint". Phase 8 keeps it data-driven:
no addendum fires until the reviewer signal is real.

A category with no JSON entry, no rejections, or a non-matching
dominant tag returns an empty string and the research prompt is
unchanged.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import UTC, datetime, timedelta
from importlib.resources import files
from typing import Any

from engine.supabase import supabase

log = logging.getLogger(__name__)

# Window over which we count rejection tags per category.
DOMINANCE_WINDOW_DAYS = 30

# Minimum count for a tag to be considered "dominant". A single
# rejection is noise; require at least 2 hits before changing the
# prompt. The architectural plan calls out "dominates", which
# implies multiple — this is the floor.
MIN_DOMINANT_COUNT = 2


def _load_guardrails() -> dict[str, dict[str, str]]:
    """Read the JSON file once at import time; cache for the process."""
    raw = (
        files("engine.prompts")
        .joinpath("category_guardrails.json")
        .read_text(encoding="utf-8")
    )
    payload: dict[str, Any] = json.loads(raw)
    # Strip the human-readable `_doc` field — it's not a category.
    return {
        k: v
        for k, v in payload.items()
        if not k.startswith("_") and isinstance(v, dict)
    }


_GUARDRAILS = _load_guardrails()


def _count_dominant_tag(
    rows: list[dict[str, Any]], category: str
) -> tuple[str, int] | None:
    """Pure function — counts the most common rejection tag in ``rows``
    where the joined suggestion's category matches.

    Split out from ``_dominant_rejection_tag`` so unit tests can
    exercise the dominance + threshold logic without a live Supabase.
    """
    counts: Counter[str] = Counter()
    for r in rows:
        sug = r.get("suggestions")
        if not sug or sug.get("category") != category:
            continue
        for tag in r.get("reason_tags") or []:
            counts[tag] += 1
    if not counts:
        return None
    tag, count = counts.most_common(1)[0]
    if count < MIN_DOMINANT_COUNT:
        return None
    return tag, count


def _dominant_rejection_tag(category: str) -> tuple[str, int] | None:
    """Return ``(tag, count)`` for the most common rejection tag in
    the category over the last 30 days, or ``None`` if no rejections
    cleared ``MIN_DOMINANT_COUNT``.

    Phase 9 may push this to a SQL view if the rejection volume
    grows past a few hundred rows per window.
    """
    cutoff_iso = (
        datetime.now(UTC) - timedelta(days=DOMINANCE_WINDOW_DAYS)
    ).isoformat()

    sb = supabase()
    resp = (
        sb.table("feedback")
        .select("reason_tags,suggestions(category)")
        .eq("decision", "rejected")
        .gte("created_at", cutoff_iso)
        .execute()
    )
    return _count_dominant_tag(resp.data or [], category)


def addendum_for_category(category: str) -> str | None:
    """Return the prompt addendum for a category, or ``None``.

    Returns a string only when (a) a JSON entry exists for the
    category and (b) the dominant rejection tag in the last 30 days
    matches the entry's ``trigger_tag`` with at least
    ``MIN_DOMINANT_COUNT`` hits.
    """
    entry = _GUARDRAILS.get(category)
    if entry is None:
        return None
    trigger_tag: str = entry["trigger_tag"]
    addendum: str = entry["addendum"]
    dominant = _dominant_rejection_tag(category)
    if dominant is None or dominant[0] != trigger_tag:
        return None
    log.info(
        "guardrail fired category=%r tag=%r count=%d",
        category,
        dominant[0],
        dominant[1],
    )
    return addendum

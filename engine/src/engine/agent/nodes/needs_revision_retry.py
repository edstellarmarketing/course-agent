"""Retry candidates a reviewer marked ``needs_revision``.

Architectural plan §3.8(c). When a reviewer clicks "Needs revision"
with a free-text note (e.g. "pitch at CFOs, not engineering
leaders"), the next agent run targeting that suggestion's category
runs a FOCUSED retry call: the original candidate JSON + the
reviewer's note as the explicit instruction. The model returns a
SINGLE replacement candidate which we persist as a new row whose
``parent_id`` points back at the original.

Scope rules:
  - Only candidates whose category appears in ``targeted_categories``
    are retried. Retrying an unrelated category just because someone
    flagged one needs-revision would be confusing — wait for the
    next run that targets that category instead.
  - 24-hour window (the doc's default). Older needs-revision items
    presumably aged out of relevance.
  - At most one retry per parent (we don't double-process even if a
    reviewer re-marks needs-revision after a retry).

The retry's output candidate flows into ``state.retry_candidates``,
which ``rule_engine`` reads alongside ``state.raw_candidates``. From
that point on, retry candidates are just candidates — they pass the
same 10 rules.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime, timedelta
from importlib.resources import files
from typing import Any

from pydantic import ValidationError

from engine.agent.candidate import RawCandidate
from engine.agent.state import AgentState
from engine.supabase import supabase

log = logging.getLogger(__name__)

REVISION_WINDOW_HOURS = 24

_RETRY_PROMPT_TEMPLATE = (
    files("engine.prompts")
    .joinpath("needs_revision_retry.txt")
    .read_text(encoding="utf-8")
)


def _strip_json_fences(text: str) -> str:
    """Tolerate ```json ... ``` wrappers; locate the first {...} block."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        return fenced.group(1)
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        return text[first : last + 1]
    return text


def _build_original_json(row: dict[str, Any]) -> str:
    """Render the parent suggestion as a compact JSON string for the prompt."""
    return json.dumps(
        {
            "title": row["title"],
            "rationale": row["rationale"],
            "category": row["category"],
            "proposed_subcategory": row.get("proposed_subcategory"),
            "target_audience": row.get("target_audience"),
            "duration_days": row.get("duration_days"),
            "delivery_format": row.get("delivery_format"),
            "suggested_price_usd": row.get("suggested_price_usd"),
            "price_basis": row.get("price_basis"),
            "references": row.get("references") or [],
        },
        ensure_ascii=False,
        indent=2,
    )


def _retry_one(
    parent: dict[str, Any],
    note: str,
    *,
    or_client,
    span: str,
) -> RawCandidate | None:
    """Single LLM round-trip; returns the revised RawCandidate or None."""
    user_prompt = _RETRY_PROMPT_TEMPLATE.format(
        original_json=_build_original_json(parent),
        reviewer_note=note,
    )
    completion = or_client.complete(
        [{"role": "user", "content": user_prompt}],
        max_tokens=1024,
        temperature=0.4,
        span=span,
    )
    cleaned = _strip_json_fences(completion.text)
    try:
        decoded = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        log.warning(
            "retry parent=%s JSON decode failed: %s (first 200 chars: %r)",
            parent["id"][:8],
            exc,
            cleaned[:200],
        )
        return None
    if not isinstance(decoded, dict):
        log.warning(
            "retry parent=%s expected JSON object, got %s",
            parent["id"][:8],
            type(decoded).__name__,
        )
        return None
    try:
        cand = RawCandidate.model_validate(decoded)
    except ValidationError as exc:
        log.warning(
            "retry parent=%s validation failed: %s",
            parent["id"][:8],
            exc.errors()[:2],
        )
        return None
    return cand.model_copy(
        update={"category": parent["category"], "parent_id": parent["id"]}
    )


def run(state: AgentState) -> AgentState:
    targets = set(state.get("targeted_categories") or [])
    or_client = state.get("_or_client")  # type: ignore[typeddict-item]
    if or_client is None:
        log.info("node=needs_revision_retry no client — skipping")
        return {"retry_candidates": []}
    if not targets:
        log.info("node=needs_revision_retry no targeted categories — skipping")
        return {"retry_candidates": []}

    cutoff_iso = (
        datetime.now(UTC) - timedelta(hours=REVISION_WINDOW_HOURS)
    ).isoformat()

    sb = supabase()
    # Pull suggestions still in needs_revision whose most-recent
    # feedback row is within the window AND the category is in the
    # current run's targeted set.
    resp = (
        sb.table("feedback")
        .select(
            "suggestion_id,reason_text,created_at,"
            "suggestions(id,title,rationale,category,proposed_subcategory,"
            "target_audience,duration_days,delivery_format,"
            "suggested_price_usd,price_basis,references,status,parent_id)"
        )
        .eq("decision", "needs_revision")
        .gte("created_at", cutoff_iso)
        .order("created_at", desc=True)
        .execute()
    )
    rows: list[dict[str, Any]] = resp.data or []

    # Dedup by suggestion_id (latest note wins). Also drop any whose
    # parent has already been retried (parent_id IS NOT NULL on the
    # original means it WAS a retry itself; skip rerun of retries).
    seen: set[str] = set()
    candidates_to_retry: list[tuple[dict[str, Any], str]] = []
    for r in rows:
        sug = r.get("suggestions") or {}
        sid = r.get("suggestion_id")
        if sid is None or sid in seen:
            continue
        if sug.get("category") not in targets:
            continue
        if sug.get("status") != "needs_revision":
            # Reviewer changed their mind / re-decided; ignore.
            continue
        note = (r.get("reason_text") or "").strip()
        if not note:
            # Phase 5 enforced non-empty notes, but defensive.
            continue
        seen.add(sid)
        candidates_to_retry.append((sug, note))

    if not candidates_to_retry:
        log.info(
            "node=needs_revision_retry targets=%d eligible=0 — nothing to retry",
            len(targets),
        )
        return {"retry_candidates": []}

    log.info(
        "node=needs_revision_retry eligible=%d targets=%d",
        len(candidates_to_retry),
        len(targets),
    )

    revised: list[dict[str, Any]] = []
    for parent, note in candidates_to_retry:
        result = _retry_one(parent, note, or_client=or_client, span="needs_revision.retry")
        if result is None:
            continue
        log.info(
            "retry parent=%s -> new title=%r",
            parent["id"][:8],
            result.title,
        )
        revised.append(result.model_dump())

    return {"retry_candidates": revised}

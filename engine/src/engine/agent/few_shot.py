"""Fetch + format few-shot examples for the research prompt.

Phase 8 Step 3. Calls the ``get_few_shot_examples`` SQL function
(migration 0007) per targeted category and renders the returned
rows into a single system-side text block the research node can
inline above the user turn.

Two example sets:

  - ``approval``: full {title, rationale, reason_text?} blocks for
    candidates the reviewer accepted. Used as positive guidance.
  - ``rejection``: one row per distinct tag in the category. Used
    as negative guidance with the rejection_text inline so the
    model knows *why*.

A category with no feedback history yet returns an empty block,
and the research node skips inlining anything — Phase 6 prompt
behaviour preserved.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from engine.supabase import supabase

log = logging.getLogger(__name__)

# Approval rows requested. The function returns at most this many;
# rejections are one-per-tag and not capped by k.
DEFAULT_APPROVAL_LIMIT = 5


@dataclass(frozen=True)
class FewShotBlock:
    """Renderable few-shot text for one category."""

    category: str
    approvals: list[dict[str, Any]]
    rejections: list[dict[str, Any]]

    @property
    def has_examples(self) -> bool:
        return bool(self.approvals or self.rejections)

    def as_prompt_text(self) -> str:
        """Format as a single string ready to drop into a message turn."""
        if not self.has_examples:
            return ""
        lines: list[str] = [
            f"Recent reviewer signals for category {self.category!r}:",
        ]
        if self.approvals:
            lines.append("")
            lines.append("APPROVED (positive examples — propose more like these):")
            for a in self.approvals:
                lines.append(f"  - {a['title']}")
                rationale = (a.get("rationale") or "").strip()
                if rationale:
                    lines.append(f"    rationale: {rationale}")
        if self.rejections:
            lines.append("")
            lines.append(
                "REJECTED (negative examples — avoid candidates similar to "
                "any of these; each is tagged with the reviewer's reason):"
            )
            for r in self.rejections:
                tag = r.get("tag") or "other"
                lines.append(f"  - [{tag}] {r['title']}")
                reason = (r.get("reason_text") or "").strip()
                if reason:
                    lines.append(f"    reviewer note: {reason}")
        return "\n".join(lines)


def load_few_shot_block(
    category: str, *, approval_limit: int = DEFAULT_APPROVAL_LIMIT
) -> FewShotBlock:
    """Pull few-shot rows for one category from Supabase.

    Never raises into the caller — DB / RPC failures degrade to an
    empty block and a warning log so a hiccup never kills a run.
    """
    sb = supabase()
    try:
        resp = sb.rpc(
            "get_few_shot_examples",
            {"category_name": category, "k": approval_limit},
        ).execute()
    except Exception as exc:  # noqa: BLE001 — telemetry, not failure
        log.warning("few_shot rpc failed for %r: %s — skipping", category, exc)
        return FewShotBlock(category=category, approvals=[], rejections=[])

    rows: list[dict[str, Any]] = resp.data or []
    approvals = [r for r in rows if r.get("kind") == "approval"]
    rejections = [r for r in rows if r.get("kind") == "rejection"]
    log.info(
        "few_shot category=%r approvals=%d rejections=%d",
        category,
        len(approvals),
        len(rejections),
    )
    return FewShotBlock(
        category=category, approvals=approvals, rejections=rejections
    )

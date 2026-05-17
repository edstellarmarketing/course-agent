"""Shared pydantic shape for raw and validated candidates.

``RawCandidate`` is what the research node produces and the rule
engine consumes. Once the engine signs off, the persistence node
turns it into a ``suggestions`` row.

We intentionally keep ``delivery_format`` as a literal string rather
than a strict Literal type so a research-node response that drifts
("instructor led" without the hyphen) is caught by the rule engine
rather than the pydantic parser — the rule engine knows how to log
the violation against a specific rule, the parser would just raise.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CandidateReference(BaseModel):
    name: str
    url: str


class RawCandidate(BaseModel):
    """One candidate as produced by the research node."""

    title: str
    rationale: str
    proposed_subcategory: str | None = None
    target_audience: str
    duration_days: int = Field(gt=0)
    delivery_format: str
    suggested_price_usd: int
    price_basis: str
    references: list[CandidateReference]
    # Stamped post-research by the dispatcher when we know the category;
    # research output itself doesn't need to repeat it.
    category: str | None = None
    # Phase 8 Step 5: populated only by the needs_revision_retry node.
    # When present, persist.py writes this onto the new suggestions row
    # so /suggestions/[id] can show the lineage.
    parent_id: str | None = None


class RawCandidateList(BaseModel):
    """Wrapper used when asking pydantic to validate the LLM's JSON array."""

    items: list[RawCandidate]

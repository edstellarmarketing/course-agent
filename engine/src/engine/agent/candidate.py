"""Shared pydantic shape for raw and validated candidates.

``RawCandidate`` is what the research node produces and the rule
engine consumes. Once the engine signs off, the persistence node
turns it into a ``suggestions`` row.

We intentionally keep ``delivery_format`` as a literal string rather
than a strict Literal type so a research-node response that drifts
("instructor led" without the hyphen) is caught by the rule engine
rather than the pydantic parser — the rule engine knows how to log
the violation against a specific rule, the parser would just raise.

Phase 9 reviewer-feedback round added six new optional fields:
``content_outline``, ``duration_hours_min``/``_max``, ``package_fit``,
``lab_requirements``, ``edstellar_pitch``. All optional so a v5-or-older
prompt (or a v6 response that drops a field) still validates — the
row lands with the field empty and the UI hides the empty section.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CandidateReference(BaseModel):
    name: str
    url: str
    # Phase 9 reviewer-feedback: optional verbatim sentence from the
    # source page that supports the candidate. The agent is instructed
    # to omit this field when not high-confidence — a missing quote is
    # better than a fabricated one. UI displays it under each reference.
    quote: str | None = None
    # Observability stamp written by rule_07_references for each
    # surviving ref. Never set by the LLM — set by the rule engine
    # so we can measure how often the agent's verbatim quotes verify
    # against the live page across runs. One of:
    #   verified       — page fetched + quote string-matched
    #   unverified     — page fetched + quote did NOT match (quote also nulled)
    #   absent         — page fetched + agent provided no quote (e.g. listing)
    #   page_unfetched — fetch failed/403/timeout, quote (if any) untouched
    # 404/410 refs are dropped upstream and never carry this field.
    quote_status: str | None = None


class OutlineModule(BaseModel):
    """One module in a candidate's content_outline."""

    module: str
    topics: list[str] = Field(default_factory=list)


class PackageFit(BaseModel):
    """Which Edstellar package the agent recommends for this course."""

    licenses_per_batch_of_10: int = Field(ge=0)
    license_math: str
    primary_package: str  # Starter | Growth | Enterprise | Custom
    package_rationale: str


class LabRequirements(BaseModel):
    """What tech the provider must stand up to deliver labs."""

    required: bool
    platforms: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    notes: str = ""


class RawCandidate(BaseModel):
    """One candidate as produced by the research node."""

    title: str
    rationale: str
    proposed_subcategory: str | None = None
    target_audience: str

    # Phase 9 reviewer feedback: hours range replaces duration_days
    # for new rows. duration_days kept optional so older prompts /
    # fixture data still validate; new rows write hour columns.
    duration_days: int | None = Field(default=None, gt=0)
    duration_hours_min: int | None = Field(default=None, ge=1)
    duration_hours_max: int | None = Field(default=None, ge=1)

    delivery_format: str
    suggested_price_usd: int
    price_basis: str

    # Phase 9 reviewer feedback: structured curriculum, package
    # recommendation, lab requirements, and an Edstellar-specific
    # business case. All optional — older prompts won't populate.
    content_outline: list[OutlineModule] | None = None
    package_fit: PackageFit | None = None
    lab_requirements: LabRequirements | None = None
    edstellar_pitch: str | None = None

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

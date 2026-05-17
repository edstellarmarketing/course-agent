"""Rule 4: delivery_format must equal 'instructor-led'.

Mirrors the DB CHECK constraint. Case-insensitive match with whitespace
normalization so a model that emits "instructor led" (no hyphen) is
caught here rather than crashing pydantic upstream.
"""

from __future__ import annotations

from engine.agent.candidate import RawCandidate


def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    normalized = candidate.delivery_format.strip().lower().replace(" ", "-")
    if normalized != "instructor-led":
        return RuleResult.failed(
            f"delivery_format={candidate.delivery_format!r} not 'instructor-led'"
        )
    return RuleResult.passed()

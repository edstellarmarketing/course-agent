"""Rule 3: suggested_price_usd must be strictly greater than $2,500.

Mirrors the DB CHECK constraint on ``suggestions.suggested_price_usd``.
We re-check at the agent layer so the dispatcher can log the kill
before persistence; otherwise the candidate would only fail at INSERT
time with a generic Postgres error.
"""

from __future__ import annotations

from engine.agent.candidate import RawCandidate

MIN_PRICE_USD = 2500


def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001 — circular
    from engine.rules.dispatcher import RuleResult

    if candidate.suggested_price_usd <= MIN_PRICE_USD:
        return RuleResult.failed(
            f"price ${candidate.suggested_price_usd} <= ${MIN_PRICE_USD}"
        )
    return RuleResult.passed()

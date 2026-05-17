"""Rule 6: candidate.category must map to a row in ``categories``.

The suggestions.category FK enforces this at INSERT time, but
checking earlier lets the dispatcher log the kill with the bad
value instead of waiting for a Postgres error. ``ctx.category_names``
is populated once per run by inventory_read.
"""

from __future__ import annotations

from engine.agent.candidate import RawCandidate


def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    if candidate.category is None:
        return RuleResult.failed("candidate.category is None")
    if candidate.category not in ctx.category_names:
        return RuleResult.failed(
            f"category {candidate.category!r} not in categories table"
        )
    return RuleResult.passed()

"""Rules 5 + 8 combined — both are structural / metadata constraints.

Rule 5: price_basis must reference at least two competitor data
points. We approximate "two data points" as "the price_basis text
contains at least two dollar amounts OR explicitly names at least
two providers". A perfect heuristic isn't possible without an LLM
judge; this catches the obvious violations cheaply.

Rule 8: search may be global — no region restriction. There's
nothing to enforce here at the candidate level (the constraint is on
the search step itself); we include the rule slot so a future
enrichment can attach to it without re-numbering.

References-count guard ("at least three URLs") lives here too because
it's structurally cheap and prevents Rule 7 from being asked to
verify a candidate that fundamentally can't pass.
"""

from __future__ import annotations

import re

from engine.agent.candidate import RawCandidate

MIN_REFERENCES = 3
# "$3,200" / "$3,200.50" / "$3.2k" — single dollar amount.
DOLLAR_PATTERN = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?[kKmM]?")
# A range like "$3,200-$3,800" or "$3,200 to $3,800" counts as TWO
# data points even when expressed with a single dollar sign.
RANGE_PATTERN = re.compile(
    r"\d[\d,]*\s*(?:[-–—]|to)\s*\$?\d", re.IGNORECASE
)
# Common signals of a second competitor data point: a recognised
# academy / institute / framework that the price_basis can cite by
# name. Cheap heuristic; LLM still does the heavy lifting.
PROVIDER_HINTS = re.compile(
    r"\b(?:academy|institute|university|foundation|alliance|"
    r"PwC|Deloitte|KPMG|EY|McKinsey|BCG|Bain|SANS|Coursera|"
    r"edX|Udemy|Pluralsight|LinkedIn Learning)\b",
    re.IGNORECASE,
)


def _count_data_points(price_basis: str) -> int:
    """Roughly count comparable data points in price_basis.

    A "data point" can be: a separate dollar amount, a range, or
    a named provider. This is a heuristic — the prompt already
    pushes the LLM hard to cite at least two competitors, and the
    rule is a backstop, not the source of truth.
    """
    return (
        len(DOLLAR_PATTERN.findall(price_basis))
        + len(RANGE_PATTERN.findall(price_basis))
        + len(PROVIDER_HINTS.findall(price_basis))
    )


def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    if len(candidate.references) < MIN_REFERENCES:
        return RuleResult.failed(
            f"references count {len(candidate.references)} < {MIN_REFERENCES}"
        )

    data_points = _count_data_points(candidate.price_basis)
    if data_points < 2:
        return RuleResult.failed(
            f"price_basis cites only {data_points} data point(s); need >= 2"
        )

    return RuleResult.passed()

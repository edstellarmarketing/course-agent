"""Run every raw candidate through the 10 rules in cost order.

Each rule exports a ``check(candidate, ctx) -> RuleResult`` function.
The dispatcher short-circuits on the first ``Fail``: candidates are
expensive to fully evaluate, so a free structural reject (price,
format) must never trigger the $0.003 reference-scrape check.

Order is load-bearing — see ``RULE_ORDER`` below. Re-ordering means
re-profiling the run cost.

Rule 1 (intra-batch dedupe) is NOT in this dispatcher; it runs in
the ``cross_batch_dedupe`` node after every other rule survives.
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from engine.agent.candidate import RawCandidate
from engine.config import settings
from engine.rules import (
    rule_02_existing_course,
    rule_03_price,
    rule_04_format,
    rule_05_08_structural,
    rule_06_category,
    rule_07_references,
    rule_09_recent_rejection,
    rule_10_cert_name,
)


class RunCostCeilingExceeded(RuntimeError):
    """Raised mid-dispatch when the run's projected cost crosses the ceiling.

    The CLI catches this, writes ``agent_runs.finished_at`` on whatever
    partial state exists, and exits non-zero. Candidates already
    persisted from earlier categories are kept; in-flight ones are
    discarded.
    """

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class RuleResult:
    ok: bool
    reason: str = ""

    @classmethod
    def passed(cls) -> "RuleResult":
        return cls(ok=True)

    @classmethod
    def failed(cls, reason: str) -> "RuleResult":
        return cls(ok=False, reason=reason)


@dataclass
class RuleContext:
    """Everything the rules need beyond the candidate itself.

    Held outside ``AgentState`` so the rule modules don't take a
    runtime dependency on LangGraph types.

    ``embeddings_cache`` keys candidate titles to Voyage vectors so
    Rule 9 and cross_batch_dedupe can reuse the embedding Rule 2
    just computed — Voyage spend stays at one call per candidate.
    """

    category_names: set[str]
    courses_matrix: Any  # numpy ndarray, kept typeless to avoid hard dep here
    course_ids: list[str]
    course_names: list[str]
    recent_rejection_matrix: Any  # ndarray or None
    or_client: Any  # OpenRouterClient — used by rule 10c, rule 7
    ledger: Any  # RunCostLedger — for cost-aware fan-out
    embeddings_cache: dict[str, Any] = None  # type: ignore[assignment]
    # Cheap-tier yes/no judge for rule 10c + the ref-verifier (rule 7).
    # Stays on the same OpenRouter slug as the primary research model
    # for now — keeps Phase 6 portable to whatever model the smoke
    # test verifies. Phase 8 will let admins swap this from /settings.
    cert_judge_model: str = "deepseek/deepseek-chat-v3.1"

    def __post_init__(self) -> None:
        if self.embeddings_cache is None:
            object.__setattr__(self, "embeddings_cache", {})


CheckFn = Callable[[RawCandidate, RuleContext], RuleResult]

# Cost-ordered. Comments in each row note the dollar cost so future
# tuners can see what re-ordering would change. Rule 1 is intentionally
# absent — it runs in cross_batch_dedupe.
RULE_ORDER: list[tuple[str, CheckFn]] = [
    ("rule_03_price", rule_03_price.check),               # free
    ("rule_04_format", rule_04_format.check),             # free
    ("rule_06_category", rule_06_category.check),         # free (in-memory)
    ("rule_05_08_structural", rule_05_08_structural.check),  # free
    ("rule_10_cert_name", rule_10_cert_name.check),       # 10a+b free; 10c ~$0.0001
    ("rule_07_references", rule_07_references.check),     # ~$0.003/ref
    ("rule_02_existing_course", rule_02_existing_course.check),  # ~$0.00006 (1 embed)
    ("rule_09_recent_rejection", rule_09_recent_rejection.check),  # ~$0.00006
]


def run_rules(
    candidates: list[RawCandidate],
    ctx: RuleContext,
) -> tuple[list[RawCandidate], dict[str, int]]:
    """Return ``(survivors, rejection_counts_by_rule)``.

    Each candidate is evaluated against every rule until one fails.
    The dispatcher logs ``run rule=… title=… reason=…`` on each
    rejection so audits can show why a candidate didn't make it.

    Before each expensive rule (currently rule_07_references) the
    dispatcher checks the run cost against the ENGINE_RUN_COST_CEILING_USD
    ceiling and raises ``RunCostCeilingExceeded`` if exceeded. That
    keeps a runaway research-prompt from racking up scrape charges.
    """
    cfg = settings()
    ceiling = float(cfg.engine_run_cost_ceiling_usd)
    survivors: list[RawCandidate] = []
    rejection_counts: Counter[str] = Counter()

    for cand in candidates:
        failed_rule: str | None = None
        for name, check in RULE_ORDER:
            # Cost gate: about to do something pricey; check the ledger first.
            if name in {"rule_07_references"} and ctx.ledger is not None:
                if ctx.ledger.total_usd >= ceiling:
                    raise RunCostCeilingExceeded(
                        f"ledger=${ctx.ledger.total_usd:.4f} >= ceiling=${ceiling:.2f} "
                        f"before {name} on title={cand.title!r}"
                    )
            result = check(cand, ctx)
            if not result.ok:
                failed_rule = name
                rejection_counts[name] += 1
                log.info(
                    "rule rejection rule=%s title=%r reason=%s",
                    name,
                    cand.title,
                    result.reason,
                )
                break
        if failed_rule is None:
            survivors.append(cand)

    log.info(
        "dispatcher in=%d survived=%d rejections=%s cost=$%0.4f",
        len(candidates),
        len(survivors),
        dict(rejection_counts),
        ctx.ledger.total_usd if ctx.ledger else 0.0,
    )
    return survivors, dict(rejection_counts)

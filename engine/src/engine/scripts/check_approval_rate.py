"""Phase 9 Step 6 alert #2 — did approval rate drop by ≥10pp week-over-week?

Scheduled Mon 08:00 UTC by .github/workflows/alert-approval-rate.yml.
Weekly cadence is intentional — daily would noise out. The week-over-
week comparison is the right granularity for catching prompt
regressions or category-distribution drift.

A "decision" is one of approve / reject / needs_revision. Approval
rate = approve / (approve + reject + needs_revision). When the
current 7d window's rate is ≥10 percentage points BELOW the prior
7d window's rate, we ping Slack.

Minimum-sample guard: if either window has fewer than 10 decisions,
we skip the comparison — early in the system's life or after a slow
week, the rate is too noisy to act on.
"""

from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime, timedelta

from engine.scripts._alerts import slack_alert
from engine.sentry import init_sentry
from engine.supabase import supabase as get_supabase

LOG_FORMAT = "%(asctime)sZ %(levelname)s %(message)s"
LOG_DATEFMT = "%Y-%m-%dT%H:%M:%S"

MIN_DECISIONS = 10
DROP_THRESHOLD_PP = 10.0


def _approval_rate(rows: list[dict[str, str]]) -> tuple[float, int]:
    if not rows:
        return 0.0, 0
    # Decision values are `approved` / `rejected` / `needs_revision`
    # per the CHECK constraint in supabase/migrations/0001_initial.sql
    # and the FeedbackDecision union in app/src/lib/types.ts.
    counts = {"approved": 0, "rejected": 0, "needs_revision": 0}
    for r in rows:
        d = r.get("decision")
        if d in counts:
            counts[d] += 1
    total = sum(counts.values())
    if total == 0:
        return 0.0, 0
    return counts["approved"] / total, total


def _decisions_between(start: datetime, end: datetime) -> list[dict[str, str]]:
    resp = (
        get_supabase()
        .table("feedback")
        .select("decision")
        .gte("created_at", start.isoformat())
        .lt("created_at", end.isoformat())
        .execute()
    )
    return resp.data or []


def main() -> int:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATEFMT)
    init_sentry()

    now = datetime.now(UTC)
    cur_start = now - timedelta(days=7)
    prev_start = now - timedelta(days=14)

    try:
        current = _decisions_between(cur_start, now)
        prior = _decisions_between(prev_start, cur_start)
    except Exception as exc:  # noqa: BLE001
        logging.error("check_approval_rate: read feedback failed: %s", exc)
        return 0

    cur_rate, cur_n = _approval_rate(current)
    prev_rate, prev_n = _approval_rate(prior)

    logging.info(
        "approval rate cur=%.1f%% (n=%d) prev=%.1f%% (n=%d)",
        cur_rate * 100,
        cur_n,
        prev_rate * 100,
        prev_n,
    )

    if cur_n < MIN_DECISIONS or prev_n < MIN_DECISIONS:
        logging.info(
            "skipping alert — insufficient sample (need ≥%d per window)",
            MIN_DECISIONS,
        )
        return 0

    drop_pp = (prev_rate - cur_rate) * 100
    if drop_pp < DROP_THRESHOLD_PP:
        logging.info("no drop alert — delta=%.1fpp under threshold", drop_pp)
        return 0

    text = (
        f":chart_with_downwards_trend: *Approval rate dropped {drop_pp:.1f}pp* "
        f"week-over-week — current 7d: {cur_rate * 100:.1f}% "
        f"(n={cur_n}), prior 7d: {prev_rate * 100:.1f}% (n={prev_n}). "
        "Check /learning for the active prompt and the latest regenerate_prompt candidate."
    )
    logging.warning(text)
    slack_alert(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

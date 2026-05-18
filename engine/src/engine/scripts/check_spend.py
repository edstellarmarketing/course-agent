"""Phase 9 Step 6 alert #3 — did today's 24h spend exceed the daily ceiling?

Scheduled daily 23:55 UTC by .github/workflows/alert-spend.yml. Sums
``agent_runs.cost_usd`` for rows whose ``started_at`` falls in the
current UTC day. When the total exceeds OPENROUTER_DAILY_CEILING_USD
(default $10), pings Slack.

This is a different signal from the per-run circuit breaker
(ENGINE_RUN_COST_CEILING_USD, default $5):
  - Per-run cap protects one runaway run.
  - Daily ceiling catches a cron-loop-gone-wrong — multiple runs in
    a day that individually stay under their per-run cap but
    together cost more than we budgeted.
"""

from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime, time, timedelta

from engine.config import settings
from engine.scripts._alerts import slack_alert
from engine.sentry import init_sentry
from engine.supabase import supabase as get_supabase

LOG_FORMAT = "%(asctime)sZ %(levelname)s %(message)s"
LOG_DATEFMT = "%Y-%m-%dT%H:%M:%S"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATEFMT)
    init_sentry()
    cfg = settings()

    today = datetime.now(UTC).date()
    day_start = datetime.combine(today, time(0, 0), UTC)
    day_end = day_start + timedelta(days=1)

    try:
        resp = (
            get_supabase()
            .table("agent_runs")
            .select("cost_usd")
            .gte("started_at", day_start.isoformat())
            .lt("started_at", day_end.isoformat())
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logging.error("check_spend: read agent_runs failed: %s", exc)
        return 0

    rows = resp.data or []
    total = sum(float(r.get("cost_usd") or 0.0) for r in rows)
    ceiling = cfg.openrouter_daily_ceiling_usd

    logging.info(
        "spend today=$%.4f ceiling=$%.2f runs=%d", total, ceiling, len(rows)
    )

    if total < ceiling:
        return 0

    text = (
        f":money_with_wings: *Daily spend $%.2f exceeded ceiling $%.2f* "
        "across %d runs. Check the cost ledger in Langfuse and consider "
        "lowering --top-k or --max-candidates."
    ) % (total, ceiling, len(rows))
    logging.warning(text)
    slack_alert(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Phase 9 Step 6 alert #1 — did today's 03:00 UTC agent run land?

Scheduled at 06:15 UTC (Mon-Sat) by .github/workflows/alert-daily-missing.yml.
Three hours after the scheduled fire is the doc-mandated buffer — GitHub
Actions Cron can drift up to 15 minutes, and a long run can take an hour;
06:15 strikes a balance between "noisy" and "useful."

Exits 0 always. Returns 0 even when the alert fires — the workflow
shouldn't fail just because a Slack ping says "yesterday's run is
missing." A failure to read agent_runs is logged but doesn't escalate
either; if the DB is down, the daily run itself would be in trouble
and would have paged via Sentry.
"""

from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime, time, timedelta

from engine.scripts._alerts import slack_alert
from engine.sentry import init_sentry
from engine.supabase import supabase as get_supabase

LOG_FORMAT = "%(asctime)sZ %(levelname)s %(message)s"
LOG_DATEFMT = "%Y-%m-%dT%H:%M:%S"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATEFMT)
    init_sentry()

    today_03_utc = datetime.combine(datetime.now(UTC).date(), time(3, 0), UTC)
    cutoff = today_03_utc - timedelta(minutes=15)  # cover the cron drift window

    try:
        resp = (
            get_supabase()
            .table("agent_runs")
            .select("id, started_at")
            .gte("started_at", cutoff.isoformat())
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logging.error("check_daily_run: read agent_runs failed: %s", exc)
        return 0

    rows = resp.data or []
    if rows:
        logging.info(
            "check_daily_run: ok — latest run %s at %s",
            rows[0].get("id"),
            rows[0].get("started_at"),
        )
        return 0

    text = (
        ":rotating_light: *Daily agent run missing* — "
        f"no agent_runs row started after {today_03_utc.isoformat()}. "
        "Check GitHub Actions agent-daily and the engine logs."
    )
    logging.warning(text)
    slack_alert(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

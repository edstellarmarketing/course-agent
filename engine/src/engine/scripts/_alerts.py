"""Shared Slack alert helper for Phase 9 Step 6 monitoring scripts.

Three sister scripts use this:
- check_daily_run.py        (06:15 UTC — was today's 03:00 run missed?)
- check_approval_rate.py    (Mon 08:00 UTC — did approvals drop >10pp?)
- check_spend.py            (23:55 UTC — did today's spend exceed ceiling?)

All three are best-effort. They never block, never raise, and exit 0
even when Slack delivery fails — the alerting infrastructure itself
shouldn't page someone if the page-er is broken.
"""

from __future__ import annotations

import logging

import httpx

from engine.config import settings

log = logging.getLogger(__name__)


def slack_alert(text: str) -> bool:
    """Post a message to the alerts Slack channel.

    Resolution order for the webhook URL:
        ALERTS_SLACK_WEBHOOK_URL (override)
        SLACK_WEBHOOK_URL        (fallback — same channel as run pings)

    Returns True on a 2xx Slack response, False otherwise (or when
    neither URL is configured). Never raises — callers can branch
    on the return value, but the script's exit code stays 0 either
    way so a Slack outage doesn't fail-loop a GitHub Actions cron.
    """
    cfg = settings()
    url = cfg.alerts_slack_webhook_url or cfg.slack_webhook_url
    if url is None:
        log.info("no slack webhook configured — skipping alert")
        return False
    try:
        resp = httpx.post(str(url), json={"text": text}, timeout=5.0)
    except httpx.RequestError as exc:
        log.warning("slack alert failed: %s", exc)
        return False
    if resp.status_code >= 300:
        log.warning(
            "slack alert non-2xx: %d body=%r", resp.status_code, resp.text[:200]
        )
        return False
    log.info("slack alert delivered")
    return True

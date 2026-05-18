"""Phase 9 — Sentry initialization for the course-agent engine.

Lazy and idempotent. ``init_sentry()`` is the only public symbol; call
it once at CLI boot. When ``SENTRY_DSN`` is unset, it no-ops so local
dev and CI smoke runs don't need a Sentry project to boot.

The ``httpx`` integration attaches breadcrumbs for every OpenRouter /
Voyage / Serper call, so when a node raises, Sentry already has the
upstream request trail attached.
"""

from __future__ import annotations

import logging

import sentry_sdk
from sentry_sdk.integrations.httpx import HttpxIntegration

from engine.config import settings

_log = logging.getLogger(__name__)
_initialized = False


def init_sentry() -> None:
    global _initialized
    if _initialized:
        return
    cfg = settings()
    if not cfg.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=cfg.sentry_dsn,
        traces_sample_rate=0.1,
        send_default_pii=False,
        integrations=[HttpxIntegration()],
    )
    _initialized = True
    _log.info("sentry initialized")

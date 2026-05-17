"""Serper.dev search client.

Thin wrapper around https://google.serper.dev/search. Returns the
organic results list (title, link, snippet) for one query.

Every call appends a fixed-cost record to the shared RunCostLedger
so Serper spend shows up in the same total as OpenRouter spend.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from engine.config import settings
from engine.llm.openrouter import RunCostLedger

log = logging.getLogger(__name__)

SERPER_URL = "https://google.serper.dev/search"
DEFAULT_TIMEOUT_S = 20.0

# Serper's standard plan is $50 / 50k credits — $0.001 per call.
# Used as the per-call ledger debit. If the contract changes, update
# here; Phase 9 can pull this from a config table.
SERPER_COST_PER_CALL_USD = 0.001


@dataclass(frozen=True)
class SerperResult:
    title: str
    link: str
    snippet: str


def search(
    query: str,
    *,
    ledger: RunCostLedger,
    num: int = 10,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> list[SerperResult]:
    """Run one search; return organic results."""
    cfg = settings()
    body: dict[str, Any] = {"q": query, "num": num}
    resp = httpx.post(
        SERPER_URL,
        headers={
            "X-API-KEY": cfg.serper_api_key,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=timeout_s,
    )
    resp.raise_for_status()
    payload = resp.json()
    ledger.record_external(
        span="serper.search",
        cost_usd=SERPER_COST_PER_CALL_USD,
        q=query,
        num=num,
    )
    organic = payload.get("organic") or []
    results = [
        SerperResult(
            title=r.get("title") or "",
            link=r.get("link") or "",
            snippet=r.get("snippet") or "",
        )
        for r in organic
    ]
    log.info("serper q=%r returned=%d", query, len(results))
    return results

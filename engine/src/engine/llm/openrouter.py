"""OpenRouter chat-completions wrapper.

Every LLM call in the agent goes through this wrapper. It exists to
give us three things the raw HTTP API doesn't:

1. **Retry-with-backoff** on transient failures (429 + 5xx) so a
   single rate-limit blip doesn't kill a run mid-pipeline.
2. **A shared cost ledger.** Every call appends its USD cost +
   token counts to the per-run ``RunCostLedger`` held in graph
   state. The cost-ceiling check in Step 9 reads from one place.
3. **Optional Langfuse spans.** Wrapped in ``maybe_langfuse_span``
   so production traces appear automatically when the env keys are
   set, but local dev runs have zero Langfuse overhead.

Pricing note: OpenRouter returns ``usage`` with raw token counts.
Whether the response includes pricing varies by model. The wrapper
always parses ``usage.cost`` if present and falls back to a tiktoken
estimate at $0/token (logged as such) so runs don't fail when a
model returns no pricing — Phase 9 will plug a real price catalogue.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from engine.config import settings
from engine.llm.langfuse_hook import maybe_langfuse_span

log = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_TIMEOUT_S = 60.0
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (1.0, 2.0, 4.0)  # one per attempt; last one is the cap.


@dataclass
class Completion:
    """Normalized result of one chat-completion call."""

    text: str
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    raw: dict[str, Any] = field(repr=False)


@dataclass
class RunCostLedger:
    """Per-run rolling tally of every LLM/embedding/search call.

    Phase 6's cost ceiling (Step 9) reads ``self.total_usd`` before
    each expensive node (Rule 7 reference verification, the
    cert-name LLM judge) and aborts when it would cross
    ``ENGINE_RUN_COST_CEILING_USD``.

    Embedding + Serper costs go through ``record_external`` so they
    flow into the same total even though they don't go through this
    wrapper.
    """

    calls: list[dict[str, Any]] = field(default_factory=list)

    @property
    def total_usd(self) -> float:
        return sum(c["cost_usd"] for c in self.calls)

    @property
    def total_tokens_in(self) -> int:
        return sum(c.get("tokens_in", 0) for c in self.calls)

    @property
    def total_tokens_out(self) -> int:
        return sum(c.get("tokens_out", 0) for c in self.calls)

    def record_completion(self, c: Completion, *, span: str) -> None:
        self.calls.append(
            {
                "span": span,
                "model": c.model,
                "tokens_in": c.tokens_in,
                "tokens_out": c.tokens_out,
                "cost_usd": c.cost_usd,
            }
        )

    def record_external(self, *, span: str, cost_usd: float, **extra: Any) -> None:
        self.calls.append({"span": span, "cost_usd": cost_usd, **extra})


class OpenRouterError(RuntimeError):
    """Raised when OpenRouter returns non-retryable failure."""


class OpenRouterClient:
    """Thin sync wrapper around OpenRouter's /chat/completions.

    One client per run is the intended usage; the constructor reads
    config once via the engine ``settings()`` cache. Pass a shared
    ``RunCostLedger`` so every call lands in the same tally.
    """

    def __init__(
        self,
        default_model: str,
        ledger: RunCostLedger,
        *,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        max_attempts: int = MAX_ATTEMPTS,
    ) -> None:
        self.default_model = default_model
        self.ledger = ledger
        self.timeout_s = timeout_s
        self.max_attempts = max_attempts
        self._cfg = settings()
        # One client instance shared across calls keeps the keep-alive
        # pool warm between research-node iterations.
        self._http = httpx.Client(
            timeout=timeout_s,
            headers={
                "Authorization": f"Bearer {self._cfg.openrouter_api_key}",
                "Content-Type": "application/json",
            },
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "OpenRouterClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.3,
        span: str = "openrouter.complete",
    ) -> Completion:
        used_model = model or self.default_model
        body: dict[str, Any] = {
            "model": used_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            # OpenRouter respects this; for some upstreams it's the
            # only way to get a usage.cost back.
            "usage": {"include": True},
        }

        with maybe_langfuse_span(span, model=used_model):
            data = self._post_with_retry(body, span=span)

        completion = _parse_completion(data, model=used_model)
        self.ledger.record_completion(completion, span=span)
        log.info(
            "openrouter call=%s model=%s in=%d out=%d cost=$%0.6f",
            span,
            used_model,
            completion.tokens_in,
            completion.tokens_out,
            completion.cost_usd,
        )
        return completion

    # ── Retry loop ─────────────────────────────────────────────
    def _post_with_retry(
        self, body: dict[str, Any], *, span: str
    ) -> dict[str, Any]:
        last_exc: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                resp = self._http.post(OPENROUTER_URL, json=body)
            except httpx.RequestError as exc:
                # Connection/DNS — retryable.
                last_exc = exc
                self._sleep(attempt)
                log.warning(
                    "openrouter %s attempt %d connection error: %s",
                    span,
                    attempt + 1,
                    exc,
                )
                continue

            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                last_exc = OpenRouterError(
                    f"{span} HTTP {resp.status_code}: {resp.text[:200]}"
                )
                self._sleep(attempt)
                log.warning(
                    "openrouter %s attempt %d retryable HTTP %d",
                    span,
                    attempt + 1,
                    resp.status_code,
                )
                continue
            # 4xx other than 429 — caller error, no point retrying.
            raise OpenRouterError(
                f"{span} HTTP {resp.status_code}: {resp.text[:500]}"
            )

        assert last_exc is not None
        raise OpenRouterError(
            f"{span} failed after {self.max_attempts} attempts"
        ) from last_exc

    def _sleep(self, attempt_idx: int) -> None:
        # attempt_idx is 0-based; last value of BACKOFF_SECONDS is the cap.
        delay = BACKOFF_SECONDS[min(attempt_idx, len(BACKOFF_SECONDS) - 1)]
        time.sleep(delay)


def _parse_completion(data: dict[str, Any], *, model: str) -> Completion:
    """Normalize OpenRouter's response into our Completion shape."""
    choices = data.get("choices") or []
    if not choices:
        raise OpenRouterError(f"No choices in response: {data!r}")
    message = choices[0].get("message") or {}
    text = message.get("content") or ""

    usage = data.get("usage") or {}
    tokens_in = int(usage.get("prompt_tokens", 0) or 0)
    tokens_out = int(usage.get("completion_tokens", 0) or 0)
    # OpenRouter reports cost under usage.cost or as a top-level
    # ``cost`` field depending on the upstream; check both.
    cost_usd = float(usage.get("cost", data.get("cost", 0.0)) or 0.0)

    return Completion(
        text=text,
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd,
        raw=data,
    )

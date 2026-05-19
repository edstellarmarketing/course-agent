"""Anthropic Messages API wrapper — drop-in alternative to OpenRouter.

Used by the research node when ``RESEARCH_LLM_PROVIDER=anthropic``.
The single, headline reason to use it: Anthropic's first-party
**web_search** server-side tool. The model can issue real searches
during its turn and ground the candidates' references against pages
it has actually read, instead of the LLM-recalled URLs that send
Rule 7 into a `HTTP 404 / 403` cascade.

What this module owns:
  * One ``AnthropicClient`` with the same ``complete(...)`` shape as
    ``OpenRouterClient`` so the research node treats either provider
    identically.
  * Cost ledger entries with token cost + search-tool cost folded
    into one ``Completion.cost_usd`` figure so the per-run ceiling
    sees the full price.
  * Retries on the same envelope as OpenRouter — 429 + 5xx — using
    httpx errors raised by the SDK.

What it does NOT do:
  * Replace OpenRouter for the cheaper LLM calls (rule_07 ref-verify,
    rule_10 cert-judge, gap_analyze certification check). Those stay
    on OpenRouter; the Anthropic call only fires on
    ``research.candidates``.
  * Configure search depth / domain filters. We pass the tool with
    defaults; the model decides how many searches to do (Anthropic
    bills per search invocation).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import anthropic
from anthropic import APIError, APITimeoutError, RateLimitError

from engine.config import settings
from engine.llm.langfuse_hook import maybe_langfuse_span
from engine.llm.openrouter import Completion, RunCostLedger

log = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 300.0  # web_search round-trips do real HTTP fetches +
                           # several model turns; 120s consistently timed
                           # out on Cybersecurity-class prompts.
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (1.0, 2.0, 4.0)

# Token + search pricing per https://docs.claude.com/en/docs/about-claude/pricing.
# Kept conservative; Anthropic does not return per-call cost in the
# response envelope (unlike OpenRouter), so the ledger is best-effort
# from this table. Update when Anthropic ships official cost fields.
_TOKEN_PRICING_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    # (input, output) per million tokens
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-sonnet-4-5-20250929": (3.00, 15.00),
    "claude-opus-4-7": (15.00, 75.00),
    "claude-haiku-4-5-20251001": (1.00, 5.00),
}
# Web-search tool charge per Anthropic's docs: $10 per 1,000 searches.
_WEB_SEARCH_USD_PER_CALL = 10.0 / 1_000.0


class AnthropicClient:
    """Thin sync wrapper around the Anthropic Messages API.

    Shape matches :class:`engine.llm.openrouter.OpenRouterClient` so
    the research node can swap providers without touching its body.
    The ``web_search`` tool is enabled by default — the only reason
    a caller would pick this client over OpenRouter is to get it.
    """

    def __init__(
        self,
        default_model: str,
        ledger: RunCostLedger,
        *,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        max_attempts: int = MAX_ATTEMPTS,
        enable_web_search: bool = True,
    ) -> None:
        self.default_model = default_model
        self.ledger = ledger
        self.timeout_s = timeout_s
        self.max_attempts = max_attempts
        self.enable_web_search = enable_web_search
        self._cfg = settings()
        if not self._cfg.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is required when RESEARCH_LLM_PROVIDER=anthropic",
            )
        self._client = anthropic.Anthropic(
            api_key=self._cfg.anthropic_api_key,
            timeout=timeout_s,
            # The SDK retries by default (max_retries=2) on connection
            # errors and 429/5xx. Combined with our own MAX_ATTEMPTS=3
            # loop that meant up to 9 attempts — and on slow
            # web_search calls the SDK was racing us, eating two full
            # timeout windows before our wrapper got control. Disable
            # SDK-level retries so the wrapper is the single source of
            # backoff truth.
            max_retries=0,
        )

    def close(self) -> None:
        # The SDK manages its own HTTP client; nothing to release.
        return None

    def __enter__(self) -> "AnthropicClient":
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
        span: str = "anthropic.complete",
    ) -> Completion:
        used_model = model or self.default_model

        # Anthropic Messages API splits `system` out from the `messages`
        # array, where OpenAI-style stacks it inline. Concatenate any
        # system turns the caller passed and hand them over via the
        # `system` arg.
        system_parts: list[str] = []
        user_messages: list[dict[str, str]] = []
        for m in messages:
            role = m.get("role")
            content = m.get("content", "")
            if role == "system":
                if content:
                    system_parts.append(content)
            elif role in ("user", "assistant"):
                user_messages.append({"role": role, "content": content})
            else:
                # Unknown roles: fold into user for safety. Shouldn't
                # happen with the current research prompt.
                user_messages.append({"role": "user", "content": content})

        if not user_messages:
            user_messages.append({"role": "user", "content": ""})

        kwargs: dict[str, Any] = {
            "model": used_model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": user_messages,
        }
        if system_parts:
            kwargs["system"] = "\n\n".join(system_parts)
        if self.enable_web_search:
            # Server-side tool — Anthropic runs the searches itself and
            # folds results into the model's context before the final
            # text turn. We don't have to handle a tool_use → tool_result
            # loop; just enable the tool and read the final text.
            #
            # `max_uses=3` caps the searches per call. Without it the
            # model issues 5-10 searches, each fetched page adds 20-30k
            # tokens to the next-turn input, and a typical research call
            # blows through 200k+ input tokens. That kills Tier 1 / 2
            # accounts on TPM limits, and overflows our max_tokens cap
            # on the output side because the model writes longer
            # explanations after seeing more sources. 3 is enough to
            # ground each candidate against 1 source if the model is
            # focused.
            kwargs["tools"] = [
                {
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 3,
                }
            ]

        with maybe_langfuse_span(span, model=used_model):
            response = self._call_with_retry(kwargs, span=span)

        # Aggregate every `text` block in the response. With web_search
        # enabled there may be interleaved `server_tool_use` /
        # `web_search_tool_result` blocks; we ignore those and keep
        # the model's actual textual output.
        text_chunks: list[str] = []
        web_search_calls = 0
        for block in response.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                text_chunks.append(getattr(block, "text", ""))
            elif btype == "server_tool_use":
                # Each server-side search counts toward the search bill.
                if getattr(block, "name", "") == "web_search":
                    web_search_calls += 1

        text = "".join(text_chunks).strip()
        usage = response.usage
        tokens_in = int(getattr(usage, "input_tokens", 0) or 0)
        tokens_out = int(getattr(usage, "output_tokens", 0) or 0)
        cost = _estimate_cost(
            model=used_model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            web_search_calls=web_search_calls,
        )

        completion = Completion(
            text=text,
            model=used_model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            raw={"id": response.id, "stop_reason": response.stop_reason},
        )
        self.ledger.record_completion(completion, span=span)
        if web_search_calls > 0:
            # Surface the search usage so an admin reading the log
            # can correlate spikes in ledger spend with research runs.
            self.ledger.record_external(
                span=f"{span}.web_search",
                cost_usd=web_search_calls * _WEB_SEARCH_USD_PER_CALL,
                searches=web_search_calls,
            )
        log.info(
            "anthropic call=%s model=%s in=%d out=%d searches=%d cost=$%0.6f",
            span,
            used_model,
            tokens_in,
            tokens_out,
            web_search_calls,
            cost,
        )
        return completion

    # ── Retry loop ─────────────────────────────────────────────
    def _call_with_retry(
        self, kwargs: dict[str, Any], *, span: str
    ) -> Any:
        last_exc: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                return self._client.messages.create(**kwargs)
            except (RateLimitError, APITimeoutError) as exc:
                last_exc = exc
                log.warning(
                    "anthropic %s attempt %d/%d retryable (%s): %s",
                    span,
                    attempt + 1,
                    self.max_attempts,
                    type(exc).__name__,
                    exc,
                )
                self._sleep(attempt)
            except APIError as exc:
                # APIError covers 5xx in the SDK; retry on those, raise
                # on 4xx (the SDK already split most cases by exception
                # class but leaves room for the umbrella type).
                status = getattr(exc, "status_code", None)
                if status is not None and 500 <= status < 600:
                    last_exc = exc
                    log.warning(
                        "anthropic %s attempt %d/%d HTTP %d retryable: %s",
                        span,
                        attempt + 1,
                        self.max_attempts,
                        status,
                        exc,
                    )
                    self._sleep(attempt)
                    continue
                # Non-retryable (4xx other than 429). Log the body the
                # API returned so the caller can see what went wrong
                # (auth, schema, model unavailable, etc.) instead of
                # just a class name.
                log.error(
                    "anthropic %s non-retryable (%s, status=%s): %s",
                    span,
                    type(exc).__name__,
                    status,
                    exc,
                )
                raise
        # Exhausted attempts. Surface the last exception verbatim so
        # the caller's traceback includes Anthropic's error envelope.
        assert last_exc is not None
        log.error(
            "anthropic %s exhausted %d attempts: %s",
            span,
            self.max_attempts,
            last_exc,
        )
        raise last_exc

    def _sleep(self, attempt: int) -> None:
        time.sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])


def _estimate_cost(
    *,
    model: str,
    tokens_in: int,
    tokens_out: int,
    web_search_calls: int,
) -> float:
    """Token + search cost. Returns 0.0 for unknown models so a
    surprise model name doesn't crash the ledger — but logs once."""
    pricing = _TOKEN_PRICING_USD_PER_MTOK.get(model)
    if pricing is None:
        log.warning("anthropic: unknown model %r — cost_usd reported as $0", model)
        token_cost = 0.0
    else:
        in_rate, out_rate = pricing
        token_cost = (tokens_in * in_rate + tokens_out * out_rate) / 1_000_000.0
    search_cost = web_search_calls * _WEB_SEARCH_USD_PER_CALL
    return token_cost + search_cost

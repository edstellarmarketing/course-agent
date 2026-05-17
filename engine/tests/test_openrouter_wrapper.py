"""Unit tests for the OpenRouter wrapper.

All tests use ``httpx.MockTransport`` so no real HTTP traffic
leaves the box and no OpenRouter credits are spent. The fixture
shapes the response after a real ``deepseek-chat-v3.1`` reply with
the ``usage.cost`` field populated.
"""

from __future__ import annotations

import json

import httpx
import pytest

from engine.llm.openrouter import (
    Completion,
    OpenRouterClient,
    OpenRouterError,
    RunCostLedger,
)


def _ok_response(*, text: str = "pong", tokens_in: int = 12, tokens_out: int = 3,
                 cost: float = 0.000045) -> httpx.Response:
    body = {
        "id": "test-1",
        "choices": [{"message": {"role": "assistant", "content": text}}],
        "usage": {
            "prompt_tokens": tokens_in,
            "completion_tokens": tokens_out,
            "cost": cost,
        },
    }
    return httpx.Response(200, json=body)


def _client_with_handler(handler) -> OpenRouterClient:
    """Build a client whose httpx layer is fully mocked."""
    ledger = RunCostLedger()
    client = OpenRouterClient("deepseek/deepseek-chat-v3.1", ledger)
    client._http.close()  # close the auto-created client first
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    return client


def test_complete_happy_path_records_cost() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["model"] == "deepseek/deepseek-chat-v3.1"
        assert body["messages"] == [{"role": "user", "content": "ping"}]
        return _ok_response()

    client = _client_with_handler(handler)
    c = client.complete([{"role": "user", "content": "ping"}], span="t.happy")

    assert isinstance(c, Completion)
    assert c.text == "pong"
    assert c.tokens_in == 12
    assert c.tokens_out == 3
    assert c.cost_usd == pytest.approx(0.000045)

    # Ledger now has one entry tagged with our span name.
    assert len(client.ledger.calls) == 1
    assert client.ledger.calls[0]["span"] == "t.happy"
    assert client.ledger.total_usd == pytest.approx(0.000045)
    assert client.ledger.total_tokens_in == 12
    assert client.ledger.total_tokens_out == 3


def test_complete_retries_on_429_then_succeeds(monkeypatch) -> None:
    monkeypatch.setattr("engine.llm.openrouter.time.sleep", lambda _: None)

    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, text="rate limited")
        return _ok_response(text="finally")

    client = _client_with_handler(handler)
    c = client.complete([{"role": "user", "content": "ping"}], span="t.retry")
    assert c.text == "finally"
    assert calls["n"] == 3
    # Only the successful call costs go into the ledger.
    assert client.ledger.total_usd == pytest.approx(0.000045)


def test_complete_raises_on_429_after_max_attempts(monkeypatch) -> None:
    monkeypatch.setattr("engine.llm.openrouter.time.sleep", lambda _: None)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="rate limited forever")

    client = _client_with_handler(handler)
    with pytest.raises(OpenRouterError):
        client.complete([{"role": "user", "content": "ping"}], span="t.dead")
    # Nothing in the ledger when every attempt failed.
    assert client.ledger.total_usd == 0.0


def test_complete_raises_immediately_on_4xx_other_than_429() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text="bad request body")

    client = _client_with_handler(handler)
    with pytest.raises(OpenRouterError, match="HTTP 400"):
        client.complete([{"role": "user", "content": "ping"}], span="t.4xx")


def test_complete_handles_missing_usage_gracefully() -> None:
    """Some OpenRouter upstreams omit ``usage`` — must not crash."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}]},
        )

    client = _client_with_handler(handler)
    c = client.complete([{"role": "user", "content": "x"}], span="t.nousage")
    assert c.text == "ok"
    assert c.cost_usd == 0.0
    assert c.tokens_in == 0
    assert c.tokens_out == 0


def test_record_external_lands_in_same_ledger() -> None:
    """Voyage embed + Serper search costs share the ledger."""
    ledger = RunCostLedger()
    ledger.record_external(span="voyage.embed", cost_usd=0.00002, dim=1024)
    ledger.record_external(span="serper.search", cost_usd=0.001, q="cybersecurity")
    assert ledger.total_usd == pytest.approx(0.00102)
    assert ledger.total_tokens_in == 0   # external calls report no tokens
    assert ledger.calls[0]["dim"] == 1024

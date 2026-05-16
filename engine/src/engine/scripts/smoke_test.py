"""Phase 2 smoke test for the course-agent engine.

Run with ``uv run smoke``. Hits every external service the engine
depends on, prints a ✓ or ✗ per service, and exits non-zero on any
failure. The goal is "the wires are plugged in", not "the business
logic works" — that's Phase 6.

Checks:
  - Supabase reachable (REST root answers)
  - OpenRouter completion via DeepSeek (matches the default in
    docs/phase2.md; admins can swap to another model from /settings
    in Phase 6+)
  - Voyage AI embeddings (voyage-3-large, 1024-dim sanity check)
  - Serper search (organic results returned)
  - Langfuse + Sentry are only configured-or-not booleans for now;
    real ping logic lands in Phase 9.

Pydantic-Settings will raise ``ValidationError`` at startup if any
required variable is missing — that error is the loud-fail behaviour
Phase 2's acceptance criteria asks for.
"""

from __future__ import annotations

import sys
from typing import Callable

import httpx
from pydantic import ValidationError

from engine.config import settings


# DeepSeek slug used by the smoke test — matches the
# DEFAULT_MODEL_ASSIGNMENTS in app/src/lib/mock/llm-models.ts.
# Phase 6 will read the active assignment from a settings table.
SMOKE_OPENROUTER_MODEL = "deepseek/deepseek-chat-v3.1"


def _check(name: str, fn: Callable[[], None]) -> bool:
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 — we want every failure logged
        print(f"✗ {name}: {exc}", file=sys.stderr)
        return False
    print(f"✓ {name}")
    return True


def main() -> None:
    try:
        cfg = settings()
    except ValidationError as exc:
        print("✗ env validation failed:", file=sys.stderr)
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"])
            print(f"  - {loc}: {err['msg']}", file=sys.stderr)
        sys.exit(1)

    print("smoke-test (engine)\n")

    def supabase() -> None:
        # The PostgREST root returns 200 with the OpenAPI schema or 401
        # when no apikey is sent. Either means the instance answered;
        # any other status code is a real connection problem.
        r = httpx.get(
            f"{cfg.supabase_url}rest/v1/",
            headers={"apikey": cfg.supabase_service_role_key},
            timeout=15.0,
        )
        if r.status_code not in (200, 401, 404):
            raise RuntimeError(f"HTTP {r.status_code}")

    def openrouter() -> None:
        r = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {cfg.openrouter_api_key}"},
            json={
                "model": SMOKE_OPENROUTER_MODEL,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 5,
            },
            timeout=30.0,
        )
        r.raise_for_status()
        body = r.json()
        if not body.get("choices") or not body["choices"][0]["message"].get("content"):
            raise RuntimeError("empty completion")

    def voyage() -> None:
        r = httpx.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {cfg.voyage_api_key}"},
            json={
                "input": "ping",
                "model": "voyage-3-large",
                "input_type": "document",
            },
            timeout=30.0,
        )
        r.raise_for_status()
        dim = len(r.json()["data"][0]["embedding"])
        if dim != 1024:
            raise RuntimeError(f"expected 1024 dims, got {dim} — wrong model?")

    def serper() -> None:
        r = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": cfg.serper_api_key},
            json={"q": "corporate training"},
            timeout=30.0,
        )
        r.raise_for_status()
        organic = r.json().get("organic", [])
        if not organic:
            raise RuntimeError("no organic results returned")

    ok = True
    ok &= _check("Supabase reachable", supabase)
    ok &= _check(f"OpenRouter completion ({SMOKE_OPENROUTER_MODEL})", openrouter)
    ok &= _check("Voyage AI embedding (voyage-3-large, 1024-dim)", voyage)
    ok &= _check("Serper search", serper)

    print()
    print(
        f"Langfuse:  {'configured' if cfg.langfuse_public_key else 'not configured (optional)'}"
    )
    print(
        f"Sentry:    {'configured' if cfg.sentry_dsn else 'not configured (optional)'}"
    )

    print()
    if not ok:
        print("One or more checks failed — Phase 2 is not done yet.", file=sys.stderr)
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()

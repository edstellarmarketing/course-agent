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
from engine.supabase import supabase as get_supabase

# Windows' default console code page (cp1252) can't render the ✓/✗ glyphs we
# use in pass/fail lines. Forcing UTF-8 keeps the output identical across
# Windows, macOS, and Linux without falling back to ASCII-only.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]


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

    def schema() -> None:
        # Phase 3 verification: course-agent schema is exposed via
        # PGRST_DB_SCHEMAS and the rejection_taxonomy table has the 11
        # seeded rows. Accept-Profile tells PostgREST to read from
        # course-agent instead of public.
        r = httpx.get(
            f"{cfg.supabase_url}rest/v1/rejection_taxonomy",
            params={"select": "key"},
            headers={
                "apikey": cfg.supabase_service_role_key,
                "Authorization": f"Bearer {cfg.supabase_service_role_key}",
                "Accept-Profile": "course-agent",
            },
            timeout=15.0,
        )
        if r.status_code == 406:
            # Cross-check: is *any* custom schema reachable, or is PostgREST
            # only honouring the default `public,storage,graphql_public`?
            # We probe an obviously-non-existent table inside a known
            # custom schema; a 404 means the schema is exposed (just no
            # such table), a 406 means PGRST_DB_SCHEMAS isn't taking effect.
            probe = httpx.get(
                f"{cfg.supabase_url}rest/v1/__probe_does_not_exist__",
                headers={
                    "apikey": cfg.supabase_service_role_key,
                    "Authorization": f"Bearer {cfg.supabase_service_role_key}",
                    "Accept-Profile": "course-agent",
                },
                timeout=15.0,
            )
            if probe.status_code == 406:
                raise RuntimeError(
                    "PostgREST 406 for schema 'course-agent'. The env var "
                    "PGRST_DB_SCHEMAS is set in Coolify but isn't reaching "
                    "the supabase-rest container — check env inside that "
                    "container with `env | grep PGRST_DB_SCHEMAS`."
                )
            raise RuntimeError(
                "PostgREST 406 — schema 'course-agent' is not in the "
                "db-schemas list, but other schemas seem fine."
            )
        if r.status_code == 404:
            raise RuntimeError(
                "rejection_taxonomy table not found — apply "
                "supabase/migrations/0001_initial.sql first."
            )
        r.raise_for_status()
        rows = r.json()
        if len(rows) != 11:
            raise RuntimeError(
                f"expected 11 rejection_taxonomy rows, got {len(rows)} — "
                "apply supabase/migrations/0002_seed_rejection_taxonomy.sql."
            )

    def supabase_client() -> None:
        # Phase 3 Step 9: prove the engine's supabase-py wrapper can
        # talk to PostgREST and see the rejection_taxonomy rows. The
        # earlier `schema()` check via raw httpx is the canonical 406
        # distinguisher; this one verifies the typed client wraps it.
        rows = (
            get_supabase()
            .table("rejection_taxonomy")
            .select("key")
            .execute()
            .data
        )
        if len(rows) != 11:
            raise RuntimeError(
                f"expected 11 rejection-tag rows via supabase-py, got {len(rows)}"
            )

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
    ok &= _check("course-agent schema applied (11 rejection tags)", schema)
    ok &= _check("supabase-py client reaches rejection_taxonomy", supabase_client)
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

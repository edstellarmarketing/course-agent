"""Environment-variable validator for the course-agent engine.

Mirrors ``app/src/lib/env.ts`` on the Next.js side.

- Validation runs **lazily** the first time :func:`settings` is called.
  The package can be imported without an ``.env`` (handy in unit tests
  that monkeypatch the config); anything that calls ``settings()`` —
  the smoke test, the LangGraph pipeline — fails loud if a required
  variable is missing or malformed.
- One call site, one cached instance. ``settings.cache_clear()`` in
  tests if you need to re-read the environment.

Phase 6 adds the agent nodes that exercise this on every run.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class EngineSettings(BaseSettings):
    """Validated env for the Python agent pipeline."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Allow env names to be either upper-case (canonical) or lower-case
        # (some shells lowercase exports). Pydantic-settings does this by
        # default; we restate it for explicitness.
        case_sensitive=False,
    )

    # ── Required ───────────────────────────────────────────────────────
    supabase_url: HttpUrl = Field(
        ...,
        alias="SUPABASE_URL",
        description="Self-hosted Supabase REST endpoint.",
    )
    supabase_service_role_key: str = Field(
        ...,
        alias="SUPABASE_SERVICE_ROLE_KEY",
        min_length=40,
        description="Server-only key; bypasses RLS. Never expose to clients.",
    )
    openrouter_api_key: str = Field(
        ...,
        alias="OPENROUTER_API_KEY",
        min_length=20,
        description="Gateway key for routing to DeepSeek / Claude / GPT / Gemini.",
    )
    voyage_api_key: str = Field(
        ...,
        alias="VOYAGE_API_KEY",
        min_length=20,
        description="Embeddings — voyage-3-large, 1024-dim output.",
    )
    serper_api_key: str = Field(
        ...,
        alias="SERPER_API_KEY",
        min_length=20,
        description="Web-search backend for ScrapeGraphAI's SearchGraph.",
    )

    # ── Optional (Phase 9 / 8) ─────────────────────────────────────────
    langfuse_public_key: str | None = Field(default=None, alias="LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key: str | None = Field(default=None, alias="LANGFUSE_SECRET_KEY")
    langfuse_host: HttpUrl | None = Field(default=None, alias="LANGFUSE_HOST")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")


@lru_cache(maxsize=1)
def settings() -> EngineSettings:
    """Return the validated settings singleton.

    Raises:
        pydantic.ValidationError: with a single, clear, multi-line message
        listing every missing or malformed variable. Catch only if you
        intend to *report* the failure — never to swallow it.
    """
    return EngineSettings()

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

from pydantic import Field, HttpUrl, field_validator
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

    # ── Phase 6 — agent cost ceiling ──────────────────────────────────
    # Per-run circuit breaker. If the RunCostLedger total crosses this
    # before persistence, the run aborts with a RunCostCeilingExceeded
    # and writes finished_at on whatever partial agent_runs row exists.
    engine_run_cost_ceiling_usd: float = Field(
        default=5.0,
        alias="ENGINE_RUN_COST_CEILING_USD",
        description="Hard per-run spend cap, in USD.",
    )

    # ── Phase 7 — run-complete webhooks ──────────────────────────────
    # Optional. If either internal_webhook_* is missing, the engine
    # logs a single "notify skipped" line and continues — the run
    # itself never fails because a notification couldn't fire.
    internal_webhook_url: HttpUrl | None = Field(
        default=None,
        alias="INTERNAL_WEBHOOK_URL",
        description="Next.js /api/internal/run-complete URL.",
    )
    internal_webhook_secret: str | None = Field(
        default=None,
        alias="INTERNAL_WEBHOOK_SECRET",
        min_length=16,
        description="Shared secret for the engine→app webhook header.",
    )
    slack_webhook_url: HttpUrl | None = Field(
        default=None,
        alias="SLACK_WEBHOOK_URL",
        description="Slack incoming-webhook URL for run-complete pings.",
    )

    # Treat empty / whitespace-only env values as None for optional
    # fields. Without this, a stray `SLACK_WEBHOOK_URL=` in .env trips
    # pydantic's URL validator, and a passed-through empty
    # `INTERNAL_WEBHOOK_SECRET=` (the shape GitHub Actions produces
    # when a secret isn't defined in the environment) trips the
    # min_length check before the engine can tell us it's optional.
    @field_validator(
        "internal_webhook_url",
        "internal_webhook_secret",
        "slack_webhook_url",
        "langfuse_host",
        mode="before",
    )
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


@lru_cache(maxsize=1)
def settings() -> EngineSettings:
    """Return the validated settings singleton.

    Raises:
        pydantic.ValidationError: with a single, clear, multi-line message
        listing every missing or malformed variable. Catch only if you
        intend to *report* the failure — never to swallow it.
    """
    return EngineSettings()

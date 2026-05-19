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
    # Optional — only required when RESEARCH_LLM_PROVIDER=anthropic.
    # When set, the research.candidates call goes directly to
    # Anthropic Messages API with the `web_search_20250305` tool
    # enabled so the model produces grounded, cited URLs instead of
    # the LLM-hallucinated ones Rule 7 has to throw away.
    anthropic_api_key: str | None = Field(
        default=None,
        alias="ANTHROPIC_API_KEY",
        description="Direct Anthropic API key (not via OpenRouter).",
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

    # ── Research provider toggle ─────────────────────────────────────
    # "openrouter" (default) routes the research.candidates call
    # through OpenRouter — cheapest, no web search. "anthropic"
    # routes it directly to Anthropic with the web_search tool
    # enabled — grounded references at a noticeable cost premium
    # (~$10 / 1k searches on top of token cost). All OTHER LLM calls
    # (rule_07 ref-verify, rule_10 cert-judge, etc.) stay on
    # OpenRouter regardless — only research benefits enough from
    # web search to justify the upgrade.
    research_llm_provider: str = Field(
        default="openrouter",
        alias="RESEARCH_LLM_PROVIDER",
        description="Which provider serves the research.candidates call.",
    )
    # Model used by the Anthropic provider. Sonnet 4.6 is the cost-
    # quality sweet spot for structured research output + web_search.
    # Override to claude-opus-4-7 if you want best-in-class reasoning
    # at ~5x cost.
    anthropic_research_model: str = Field(
        default="claude-sonnet-4-6",
        alias="ANTHROPIC_RESEARCH_MODEL",
        description="Model ID for the Anthropic research call.",
    )

    @field_validator("research_llm_provider", mode="after")
    @classmethod
    def _normalize_provider(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in {"openrouter", "anthropic"}:
            raise ValueError(
                f"RESEARCH_LLM_PROVIDER must be 'openrouter' or 'anthropic', got {v!r}",
            )
        return v

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

    # ── Phase 9 Step 6 — monitoring alerts ──────────────────────
    # If set, overrides slack_webhook_url for the three alert
    # scripts (daily-run-missing, approval-rate-drop, spend-ceiling).
    # Lets the team route alerts to #alerts while run-complete pings
    # continue to land in #course-agent (or wherever the Phase 7 hook
    # points). When unset, alerts fall back to slack_webhook_url.
    alerts_slack_webhook_url: HttpUrl | None = Field(
        default=None,
        alias="ALERTS_SLACK_WEBHOOK_URL",
        description="Override Slack channel for monitoring alerts.",
    )
    # Per-day rolling cost ceiling. Different signal from
    # engine_run_cost_ceiling_usd (which is per-run): the per-run
    # cap protects one runaway run; this one catches a cron loop
    # that fires N runs in a day. The 24-hour spend check script
    # pings Slack when today's sum(agent_runs.cost_usd) crosses
    # this threshold.
    openrouter_daily_ceiling_usd: float = Field(
        default=10.0,
        alias="OPENROUTER_DAILY_CEILING_USD",
        description="Hard daily spend cap across all runs, in USD.",
    )

    # ── Phase 9 Step 8 — auto-promote prompt versions ────────────
    # Default OFF. The script ships behind a flag so the team has a
    # month of dry-run observability before any candidate prompt is
    # promoted without a human in the loop. Flip on a staging DB
    # first; only after the dry-run log has matched the team's
    # manual /learning math for ~4 weeks should this go live in prod.
    prompt_auto_promote_enabled: bool = Field(
        default=False,
        alias="PROMPT_AUTO_PROMOTE_ENABLED",
        description="If true, auto_promote.py will actually promote.",
    )
    # Minimum number of reviewer decisions (approve/reject/needs_revision)
    # on suggestions that came from the candidate prompt's runs.
    # 20 is the doc-recommended floor — under that the win-rate
    # comparison is noise. Decisions, not runs: one run with 5
    # suggestions all reviewed = 5 decisions toward the count.
    min_promote_decisions: int = Field(
        default=20,
        alias="MIN_PROMOTE_DECISIONS",
        ge=1,
        description="Decisions threshold before a candidate can be auto-promoted.",
    )
    # Minimum absolute win-rate advantage candidate must show over
    # active before promotion. 0.05 = 5 percentage points (e.g.
    # candidate 70% vs active 65% qualifies; 67% vs 65% doesn't).
    min_promote_delta: float = Field(
        default=0.05,
        alias="MIN_PROMOTE_DELTA",
        ge=0.0,
        le=1.0,
        description="Required candidate-over-active win-rate delta (0.0–1.0).",
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
        "alerts_slack_webhook_url",
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

"""Insert agent_runs + surviving suggestions into Supabase.

Three writes per run:

  1. ``prompt_versions`` — ensure an ``active`` row exists. Phase 6
     hard-codes v1 with the contents of ``prompts/research_system.txt``.
     Idempotent: if an active row already exists we re-use its id.
  2. ``agent_runs`` — one row with the cost ledger totals, the
     categories targeted, candidate counts, and a link to the prompt
     version.
  3. ``suggestions`` — one row per surviving candidate with status
     ``pending_review``, the run id, and a Voyage embedding so
     future runs' Rule 9 can compare against this one.

The service-role supabase client (``engine.supabase.supabase()``)
bypasses RLS — exactly what we want here. Phase 5's reviewer-facing
Server Actions are the only path that should run as a user session.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from importlib.resources import files
from typing import Any

import httpx
import numpy as np

from engine.agent.state import AgentState
from engine.config import settings
from engine.llm.voyage import embed_one
from engine.supabase import supabase

log = logging.getLogger(__name__)

PROMPT_VERSION_NUMBER = 1
PROMPT_VERSION_NOTES = "Phase 6 — initial hard-coded research prompt."


def _ensure_prompt_version(*, model_used: str) -> str:
    """Return the id of an ``active`` prompt_versions row, creating it
    on the first run."""
    sb = supabase()
    existing = (
        sb.table("prompt_versions")
        .select("id,version,status")
        .eq("status", "active")
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]["id"]

    prompt_text = (
        files("engine.prompts")
        .joinpath("research_system.txt")
        .read_text(encoding="utf-8")
    )
    row = {
        "id": str(uuid.uuid4()),
        "version": PROMPT_VERSION_NUMBER,
        "model_slug": model_used,
        "system_prompt": prompt_text,
        "status": "active",
        "notes": PROMPT_VERSION_NOTES,
    }
    sb.table("prompt_versions").insert(row).execute()
    return row["id"]


def _insert_agent_run(
    *,
    model_used: str,
    prompt_version_id: str,
    categories_targeted: list[str],
    candidates_produced: int,
    candidates_persisted: int,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
) -> str:
    """Insert the agent_runs row; return its id."""
    sb = supabase()
    now = datetime.now(UTC).isoformat()
    run_id = str(uuid.uuid4())
    sb.table("agent_runs").insert(
        {
            "id": run_id,
            "started_at": now,
            "finished_at": now,
            "model_used": model_used,
            "prompt_version_id": prompt_version_id,
            "categories_targeted": categories_targeted,
            "candidates_produced": candidates_produced,
            "candidates_persisted": candidates_persisted,
            "total_tokens_in": tokens_in,
            "total_tokens_out": tokens_out,
            "cost_usd": round(cost_usd, 6),
        }
    ).execute()
    return run_id


def _vector_to_pg_string(vec: np.ndarray) -> str:
    """pgvector accepts a literal string like '[0.1,0.2,...]' over PostgREST."""
    return "[" + ",".join(f"{x:.6f}" for x in vec.tolist()) + "]"


def _ensure_categories_exist(survivors: list[dict[str, Any]]) -> set[str]:
    """Auto-create category rows for any agent-proposed category that
    doesn't already exist in the categories table.

    Returns the set of newly-created category names so the caller can
    log them. Categories already present are no-ops.

    The service-role client bypasses RLS, so this insert works even
    though the categories_admin_write policy gates session writes.

    Phase 9 — research_one is allowed to propose brand-new categories
    (rule 6 carve-out in the system prompt). Without this step those
    categories would be orphaned: visible on suggestions but missing
    from categories_with_counts, which means future gap_analyze runs
    wouldn't know to target them again.
    """
    if not survivors:
        return set()
    proposed = {c["category"] for c in survivors if c.get("category")}
    if not proposed:
        return set()

    sb = supabase()
    existing_rows = (
        sb.table("categories")
        .select("name")
        .in_("name", list(proposed))
        .execute()
        .data
        or []
    )
    existing = {r["name"] for r in existing_rows}
    new_names = proposed - existing
    if not new_names:
        return set()

    new_rows = [
        {
            "name": name,
            "is_pinned": False,
            "notes": "Auto-created by agent — proposed during research as a new category.",
        }
        for name in new_names
    ]
    sb.table("categories").insert(new_rows).execute()
    log.info("persist: auto-created %d new categories: %s", len(new_names), sorted(new_names))
    return new_names


def _insert_suggestions(
    survivors: list[dict[str, Any]],
    *,
    run_id: str,
    embeddings_cache: dict[str, np.ndarray],
    ledger,  # RunCostLedger; threaded through state
) -> int:
    """Insert one suggestions row per survivor; return inserted count."""
    sb = supabase()
    rows: list[dict[str, Any]] = []
    for c in survivors:
        title = c["title"]
        vec = embeddings_cache.get(title)
        if vec is None and ledger is not None:
            # Defensive: Rule 2 should have cached it already, but if a
            # candidate skipped Rule 2 for some reason we embed here.
            vec = embed_one(
                f"{title}. {c.get('rationale', '')}",
                ledger=ledger,
                input_type="document",
            )
        emb_str = _vector_to_pg_string(vec) if vec is not None else None

        row = {
            "id": str(uuid.uuid4()),
            "run_id": run_id,
            "title": title,
            "rationale": c.get("rationale"),
            "category": c["category"],
            "proposed_subcategory": c.get("proposed_subcategory"),
            "target_audience": c.get("target_audience"),
            "duration_days": c.get("duration_days"),
            "delivery_format": "instructor-led",
            "suggested_price_usd": c["suggested_price_usd"],
            "price_basis": c.get("price_basis"),
            "references": c.get("references", []),
            "embedding": emb_str,
            "status": "pending_review",
        }
        # Phase 8 Step 5 — needs_revision_retry stamps parent_id on the
        # revised candidate so the new row links back to the original.
        if c.get("parent_id"):
            row["parent_id"] = c["parent_id"]
        rows.append(row)
    if not rows:
        return 0
    sb.table("suggestions").insert(rows).execute()
    return len(rows)


def run(state: AgentState) -> AgentState:
    finals = state.get("final_candidates") or []
    dry_run = state.get("dry_run", False)
    or_client = state.get("_or_client")  # type: ignore[typeddict-item]
    ledger = state.get("_ledger")  # type: ignore[typeddict-item]
    embeddings_cache = state.get("_embeddings_cache") or {}  # type: ignore[typeddict-item]
    targeted = state.get("targeted_categories") or []
    candidates_produced = len(state.get("raw_candidates") or [])

    model_used = "deepseek/deepseek-chat-v3.1" if or_client is None else or_client.default_model

    log.info(
        "node=persist final=%d dry_run=%s targeted=%s",
        len(finals),
        dry_run,
        targeted,
    )

    if dry_run:
        log.info("node=persist DRY-RUN — no DB writes")
        return {"run_id": None, "prompt_version_id": None}

    # Phase 8 Step 6 — feedback_ingest already resolved the prompt
    # version for this run. Use that id when present; otherwise fall
    # back to ensuring a v1 row exists (Phase 6 behaviour).
    prompt_version_id = state.get("_prompt_version_id")  # type: ignore[typeddict-item]
    if not prompt_version_id:
        prompt_version_id = _ensure_prompt_version(model_used=model_used)
    run_id = _insert_agent_run(
        model_used=model_used,
        prompt_version_id=prompt_version_id,
        categories_targeted=targeted,
        candidates_produced=candidates_produced,
        candidates_persisted=len(finals),
        tokens_in=ledger.total_tokens_in if ledger else 0,
        tokens_out=ledger.total_tokens_out if ledger else 0,
        cost_usd=ledger.total_usd if ledger else 0.0,
    )

    # Pre-flight: any new categories the agent proposed get a row in
    # the categories table so future gap_analyze runs see them.
    _ensure_categories_exist(finals)

    inserted = _insert_suggestions(
        finals,
        run_id=run_id,
        embeddings_cache=embeddings_cache,
        ledger=ledger,
    )
    log.info(
        "node=persist inserted run_id=%s suggestions=%d cost=$%0.4f",
        run_id,
        inserted,
        ledger.total_usd if ledger else 0.0,
    )

    # Phase 7 — fire-and-forget notifications. Failures here are
    # warnings, never fatal — a successful run with a flaky
    # notification is still a successful run.
    _notify_app(run_id)
    _notify_slack(run_id, persisted=inserted, targeted=targeted)

    return {"run_id": run_id, "prompt_version_id": prompt_version_id}


def _notify_app(run_id: str) -> None:
    """POST to the Next.js /api/internal/run-complete webhook.

    No-op when either INTERNAL_WEBHOOK_URL or INTERNAL_WEBHOOK_SECRET
    is unset — keeps local dev frictionless. Failures are logged as
    warnings; the run continues regardless.
    """
    cfg = settings()
    if not cfg.internal_webhook_url or not cfg.internal_webhook_secret:
        log.info("notify skipped: INTERNAL_WEBHOOK_URL/SECRET unset")
        return
    try:
        resp = httpx.post(
            str(cfg.internal_webhook_url),
            headers={
                "content-type": "application/json",
                "x-internal-webhook-secret": cfg.internal_webhook_secret,
            },
            json={"run_id": run_id},
            timeout=10.0,
        )
        # The app's route handler always returns 200 with {ok: bool}
        # for non-auth failures, so a 200 might still mean "the GAS
        # relay rejected our email". Log the body in both cases so
        # post-run audits can see what happened.
        body_excerpt = resp.text[:240].replace("\n", " ")
        log.info(
            "notify webhook=%d body=%s",
            resp.status_code,
            body_excerpt,
        )
    except httpx.RequestError as exc:
        log.warning("notify failed: %s — continuing", exc)


def _notify_slack(
    run_id: str, *, persisted: int, targeted: list[str]
) -> None:
    """POST to Slack incoming webhook. Silent skip when unset."""
    cfg = settings()
    if not cfg.slack_webhook_url:
        log.info("slack skipped: SLACK_WEBHOOK_URL unset")
        return
    short = run_id[:8]
    targeted_str = ", ".join(targeted) if targeted else "no categories"
    # App URL for the deep link — prefer APP_URL env, fall back to
    # localhost. Production deploys should set APP_URL.
    import os

    app_url = (os.environ.get("APP_URL") or "http://localhost:3000").rstrip("/")
    text = (
        f":sparkles: *Course Agent run complete* — `{short}`\n"
        f"{persisted} new suggestion{'' if persisted == 1 else 's'} "
        f"pending review in {targeted_str}.\n"
        f"<{app_url}/suggestions/today|Review now →>"
    )
    try:
        resp = httpx.post(
            str(cfg.slack_webhook_url),
            json={"text": text},
            timeout=5.0,
        )
        log.info("slack webhook=%d", resp.status_code)
    except httpx.RequestError as exc:
        log.warning("slack failed: %s — continuing", exc)

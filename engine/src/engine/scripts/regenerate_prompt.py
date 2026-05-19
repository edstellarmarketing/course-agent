"""Phase 8 Step 7 — generate a candidate research prompt from feedback.

Architectural plan §3.8(b)(4). Manually triggered (no auto-promote
in Phase 8). Reads:

  - The current ``status='active'`` row from ``prompt_versions``.
  - All ``decision='rejected'`` feedback rows from the last 7 days,
    joined to suggestions so we know what got rejected and why.

Asks a top-tier model to propose a revised system prompt that would
have avoided most of these rejections without throttling valid
candidate volume. The result is inserted as a new ``prompt_versions``
row with ``status='candidate'`` and ``version = active.version + 1``.

Admin promotion is manual — via the ``/learning`` page's Promote
button (Step 8) — never automatic. Phase 9 may auto-promote once a
month of manual promote-vs-data validates the win-rate metric.

Usage:

  uv --directory engine run regenerate_prompt

Cost: one LLM call with a few-thousand-token context — typically
$0.01-0.03 with DeepSeek; more with GPT-4o or Sonnet. Tracked in
the same RunCostLedger as live runs.
"""

from __future__ import annotations

import logging
import sys
import uuid
from datetime import UTC, datetime, timedelta
from importlib.resources import files

from engine.llm.openrouter import OpenRouterClient, RunCostLedger
from engine.supabase import supabase

# UTF-8 console.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

log = logging.getLogger("regenerate_prompt")

# Window over which we summarize reviewer signal for the rewrite.
REJECTION_WINDOW_DAYS = 7

# §3.8d Prompt regenerator — runs weekly to read rejection patterns
# and propose an improved system prompt. Outputs land in
# prompt_versions as candidates. Claude Opus is the frontier-tier
# choice mirroring the /settings page; the rewrite happens once a
# week at most, so the ~5× cost premium over Sonnet is acceptable
# for the best-quality structural rewrites.
REWRITE_MODEL = "anthropic/claude-opus-4-7"


def _fetch_active_prompt() -> tuple[str, int, str]:
    """Return ``(id, version, system_prompt)`` of the highest-version
    active row. Raises if none exists — admin shouldn't regenerate
    against an empty prompt store; the file fallback is intentional
    only for first-boot runtime, not for this script."""
    sb = supabase()
    resp = (
        sb.table("prompt_versions")
        .select("id,version,system_prompt")
        .eq("status", "active")
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError(
            "no active prompt_versions row — seed v1 first by running a "
            "live agent run (which inserts the file-loaded prompt) or "
            "insert the active row manually in Supabase Studio."
        )
    r = rows[0]
    return r["id"], int(r["version"]), r["system_prompt"]


def _fetch_recent_rejections() -> list[dict]:
    """Pull the last 7 days of rejection feedback joined to the parent
    suggestion's title + rationale. Capped at 200 rows so the meta-
    prompt stays under a few thousand tokens."""
    sb = supabase()
    cutoff_iso = (
        datetime.now(UTC) - timedelta(days=REJECTION_WINDOW_DAYS)
    ).isoformat()
    resp = (
        sb.table("feedback")
        .select(
            "reason_tags,reason_text,created_at,"
            "suggestions(title,category,rationale)"
        )
        .eq("decision", "rejected")
        .gte("created_at", cutoff_iso)
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )
    return resp.data or []


def _render_rejection_block(rows: list[dict]) -> str:
    if not rows:
        return "(no rejections in the last 7 days)"
    lines: list[str] = []
    for r in rows:
        sug = r.get("suggestions") or {}
        tags = ", ".join(r.get("reason_tags") or []) or "(none)"
        reason = (r.get("reason_text") or "").strip() or "(no note)"
        lines.append(
            f"- category={sug.get('category')!r} "
            f"title={sug.get('title')!r}\n"
            f"  tags=[{tags}] note={reason[:200]}"
        )
    return "\n".join(lines)


_META_PROMPT_TEMPLATE = (
    "You are tuning a system prompt for an LLM agent that proposes "
    "corporate-training course candidates for human reviewers. Your "
    "job is to read the CURRENT system prompt and a list of "
    "RECENT REJECTIONS the reviewers made, then propose an IMPROVED "
    "system prompt that would have avoided most of these rejections "
    "without throttling the volume of valid candidates.\n\n"
    "Guidelines for the new prompt:\n"
    "- Preserve the 10 rules exactly — they're enforced downstream "
    "and the agent already respects them.\n"
    "- Preserve the JSON output schema exactly.\n"
    "- Add specific guidance ONLY where the rejections show a "
    "consistent pattern (e.g. several rejections tagged "
    "'not_corporate_relevant' → add language nudging toward enterprise "
    "buyers).\n"
    "- Avoid bloating: a tighter, more pointed prompt beats a longer "
    "one. Aim within 1.2× the length of the current prompt.\n"
    "- Do NOT add example titles — they bias the model.\n"
    "- Do NOT include any commentary, preamble, or markdown fences "
    "in your output. Return ONLY the new system prompt text, ready "
    "to drop into ``prompt_versions.system_prompt``.\n\n"
    "==========================================================\n"
    "CURRENT ACTIVE PROMPT (version {active_version}):\n"
    "==========================================================\n"
    "{active_prompt}\n\n"
    "==========================================================\n"
    "REJECTIONS FROM THE LAST {window_days} DAYS:\n"
    "==========================================================\n"
    "{rejection_block}\n\n"
    "==========================================================\n"
    "Now output the new system prompt:\n"
)


def _build_meta_prompt(
    active_prompt: str, active_version: int, rejection_block: str
) -> str:
    return _META_PROMPT_TEMPLATE.format(
        active_version=active_version,
        active_prompt=active_prompt,
        rejection_block=rejection_block,
        window_days=REJECTION_WINDOW_DAYS,
    )


def _insert_candidate(
    new_text: str, *, prior_version: int, prior_id: str
) -> str:
    """Insert a new prompt_versions row with status='candidate'. Returns its id."""
    sb = supabase()
    new_id = str(uuid.uuid4())
    sb.table("prompt_versions").insert(
        {
            "id": new_id,
            "version": prior_version + 1,
            "model_slug": REWRITE_MODEL,
            "system_prompt": new_text,
            "status": "candidate",
            "notes": (
                f"Generated by regenerate_prompt.py from active "
                f"v{prior_version} (id={prior_id}) on "
                f"{datetime.now(UTC).date().isoformat()}."
            ),
        }
    ).execute()
    return new_id


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)sZ %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=sys.stdout,
    )

    try:
        active_id, active_version, active_prompt = _fetch_active_prompt()
    except RuntimeError as exc:
        log.error("%s", exc)
        return 1

    rejections = _fetch_recent_rejections()
    log.info(
        "regenerating from active v%d (id=%s); rejections in window=%d",
        active_version,
        active_id[:8],
        len(rejections),
    )

    if not rejections:
        log.warning(
            "no rejections in the last %d days — the model will have "
            "nothing to learn from. Proceeding anyway so the wiring "
            "stays exercisable; expect the candidate to be near-identical.",
            REJECTION_WINDOW_DAYS,
        )

    meta_prompt = _build_meta_prompt(
        active_prompt, active_version, _render_rejection_block(rejections)
    )

    ledger = RunCostLedger()
    with OpenRouterClient(REWRITE_MODEL, ledger) as client:
        completion = client.complete(
            [{"role": "user", "content": meta_prompt}],
            model=REWRITE_MODEL,
            max_tokens=6144,
            temperature=0.3,
            span="regenerate_prompt.rewrite",
        )

    new_text = completion.text.strip()
    if len(new_text) < 200:
        log.error(
            "rewrite returned too-short output (%d chars) — refusing "
            "to insert. raw=%r",
            len(new_text),
            completion.text[:240],
        )
        return 2

    new_id = _insert_candidate(
        new_text, prior_version=active_version, prior_id=active_id
    )
    log.info(
        "inserted candidate v%d id=%s chars=%d tokens_in=%d tokens_out=%d "
        "cost=$%0.4f",
        active_version + 1,
        new_id,
        len(new_text),
        ledger.total_tokens_in,
        ledger.total_tokens_out,
        ledger.total_usd,
    )
    log.info(
        "promote it from the /learning admin page to A/B test on "
        "the next agent run."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

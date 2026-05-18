"""Phase 9 Step 8 — auto-promote a candidate prompt version when its
win rate beats the active one by ≥ MIN_PROMOTE_DELTA over at least
MIN_PROMOTE_DECISIONS reviewer decisions.

Default DISABLED. With PROMPT_AUTO_PROMOTE_ENABLED=false the script
runs in dry-run mode and only logs what it WOULD have done. The
team is meant to compare these logs to the manual /learning math
for at least a month before flipping the flag in production.

Decision math (mirrors app/src/app/(app)/learning/page.tsx so the
admin UI and this script agree to within rounding):

  1. Pull the single active prompt_version + every candidate.
  2. For each prompt, find the set of agent_runs that used it
     (excluding seed-data fixtures).
  3. Walk feedback → suggestions → those runs and tally
     approved / rejected / needs_revision rows.
  4. win_rate = approved / (approved + rejected + needs_revision)
     decision_count = approved + rejected + needs_revision
  5. Eligibility:
        decision_count >= cfg.min_promote_decisions
        win_rate       >= active_win_rate + cfg.min_promote_delta

When more than one candidate qualifies, the highest-win-rate one
wins; ties are broken by the most decisions (more evidence).

On promote:
  - Update prompt_versions: active -> retired; candidate -> active.
  - Write one audit_log row (action=prompt.auto_promote, actor_id
    NULL — see migration 0012). The payload records the deltas so
    a future query can show "why did this auto-promote happen?"

Exit code is always 0. A failing promote logs to stderr and lets
Sentry catch it; we never fail-loop the GitHub Actions cron.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from engine.config import settings
from engine.sentry import init_sentry
from engine.supabase import supabase as get_supabase

LOG_FORMAT = "%(asctime)sZ %(levelname)s %(message)s"
LOG_DATEFMT = "%Y-%m-%dT%H:%M:%S"


def _decision_stats_for_prompt(prompt_id: str) -> tuple[int, int, int]:
    """Return (approved, rejected, needs_revision) for one prompt version.

    Walks prompt -> agent_runs -> suggestions -> feedback via three
    PostgREST round-trips. Cheap because there are usually <10
    prompt versions and a few hundred suggestions/feedback rows
    even after a year of runs.
    """
    sb = get_supabase()
    runs = (
        sb.table("agent_runs")
        .select("id")
        .eq("prompt_version_id", prompt_id)
        .neq("model_used", "seed-data")
        .execute()
        .data
        or []
    )
    if not runs:
        return 0, 0, 0
    run_ids = [r["id"] for r in runs]

    sugg = (
        sb.table("suggestions")
        .select("id")
        .in_("run_id", run_ids)
        .execute()
        .data
        or []
    )
    if not sugg:
        return 0, 0, 0
    sugg_ids = [s["id"] for s in sugg]

    feedback = (
        sb.table("feedback")
        .select("decision")
        .in_("suggestion_id", sugg_ids)
        .execute()
        .data
        or []
    )

    approved = sum(1 for f in feedback if f.get("decision") == "approved")
    rejected = sum(1 for f in feedback if f.get("decision") == "rejected")
    needs_revision = sum(
        1 for f in feedback if f.get("decision") == "needs_revision"
    )
    return approved, rejected, needs_revision


def _win_rate(approved: int, rejected: int, needs_revision: int) -> tuple[float, int]:
    total = approved + rejected + needs_revision
    if total == 0:
        return 0.0, 0
    return approved / total, total


def _do_promote(candidate_id: str, active_id: str | None, payload: dict[str, Any]) -> bool:
    """Promote candidate to active, retire current active (if any),
    write the audit_log row. Returns True on full success.
    """
    sb = get_supabase()
    log = logging.getLogger(__name__)

    if active_id is not None:
        retire = (
            sb.table("prompt_versions")
            .update({"status": "retired"})
            .eq("id", active_id)
            .eq("status", "active")
            .execute()
        )
        if not retire.data:
            log.error("retire of active prompt %s returned no rows", active_id)
            return False

    promote = (
        sb.table("prompt_versions")
        .update({"status": "active"})
        .eq("id", candidate_id)
        .eq("status", "candidate")
        .execute()
    )
    if not promote.data:
        log.error("promote of candidate %s returned no rows", candidate_id)
        return False

    audit = (
        sb.table("audit_log")
        .insert(
            {
                "actor_id": None,
                "action": "prompt.auto_promote",
                "target_type": "prompt_versions",
                "target_id": candidate_id,
                "payload": payload,
            }
        )
        .execute()
    )
    if not audit.data:
        # The promote already happened; just warn.
        log.warning("audit_log insert returned no rows for promote=%s", candidate_id)
    return True


def main() -> int:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATEFMT)
    init_sentry()
    cfg = settings()
    log = logging.getLogger("auto_promote")

    sb = get_supabase()
    prompts = (
        sb.table("prompt_versions")
        .select("id, version, status")
        .in_("status", ["active", "candidate"])
        .execute()
        .data
        or []
    )

    active = next((p for p in prompts if p["status"] == "active"), None)
    candidates = [p for p in prompts if p["status"] == "candidate"]
    if not candidates:
        log.info("no candidate prompts — nothing to consider")
        return 0

    active_id = active["id"] if active else None
    active_rate = 0.0
    active_decisions = 0
    if active:
        a, r, nr = _decision_stats_for_prompt(active["id"])
        active_rate, active_decisions = _win_rate(a, r, nr)
        log.info(
            "active v%d win=%.3f decisions=%d",
            active["version"],
            active_rate,
            active_decisions,
        )

    qualified: list[dict[str, Any]] = []
    for c in candidates:
        a, r, nr = _decision_stats_for_prompt(c["id"])
        rate, decisions = _win_rate(a, r, nr)
        delta = rate - active_rate
        eligible = (
            decisions >= cfg.min_promote_decisions
            and delta >= cfg.min_promote_delta
        )
        log.info(
            "candidate v%d win=%.3f decisions=%d delta=%+.3f eligible=%s",
            c["version"],
            rate,
            decisions,
            delta,
            eligible,
        )
        if eligible:
            qualified.append(
                {
                    "candidate": c,
                    "approved": a,
                    "rejected": r,
                    "needs_revision": nr,
                    "win_rate": rate,
                    "decisions": decisions,
                    "delta_over_active": delta,
                }
            )

    if not qualified:
        log.info("no candidate qualifies — done")
        return 0

    # Tiebreaker: higher win rate, then more decisions.
    qualified.sort(
        key=lambda q: (q["win_rate"], q["decisions"]), reverse=True
    )
    winner = qualified[0]
    cand = winner["candidate"]

    payload = {
        "candidate_version": cand["version"],
        "candidate_win_rate": round(winner["win_rate"], 4),
        "candidate_decisions": winner["decisions"],
        "active_win_rate": round(active_rate, 4),
        "active_decisions": active_decisions,
        "delta": round(winner["delta_over_active"], 4),
        "min_decisions_threshold": cfg.min_promote_decisions,
        "min_delta_threshold": cfg.min_promote_delta,
    }

    if not cfg.prompt_auto_promote_enabled:
        log.info(
            "DRY-RUN — would promote candidate v%d (flag PROMPT_AUTO_PROMOTE_ENABLED is off)",
            cand["version"],
        )
        log.info("would-promote payload: %s", payload)
        return 0

    log.warning(
        "PROMOTING candidate v%d -> active (replaces v%d)",
        cand["version"],
        active["version"] if active else 0,
    )
    ok = _do_promote(cand["id"], active_id, payload)
    if not ok:
        log.error("promote failed; manual intervention required")
        return 0
    log.info("promote complete — audit_log row written")
    return 0


if __name__ == "__main__":
    sys.exit(main())

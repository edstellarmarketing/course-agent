"""DB-driven prompt selection with A/B alternation.

Phase 8 Step 6. The engine's research system prompt is now read from
``prompt_versions`` at run start, not from a static file. ``persist.py``
writes the chosen row's id into ``agent_runs.prompt_version_id`` so
the audit trail records exactly which prompt produced each run.

Selection logic:

  1. If only a ``status='active'`` row exists, use it.
  2. If both an ``active`` and a ``candidate`` row exist (Phase 8
     Step 7's ``regenerate_prompt.py`` inserts candidates), alternate
     by parity of the current agent_runs count: even runs use
     active, odd runs use candidate.
  3. If no active row exists, fall back to the contents of
     ``prompts/research_system.txt`` so a fresh DB doesn't crash a
     run — Phase 6's hard-coded behaviour preserved.

A/B counting deliberately excludes ``model_used='seed-data'`` rows
(the Phase 5 seed migration's synthetic run) so parity reflects real
agent runs only.

Idempotency: the function is pure-from-the-engine's-perspective at
run start — it's called once and the result is stashed in state.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from importlib.resources import files

from engine.supabase import supabase

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SelectedPrompt:
    """The resolved prompt for one run."""

    version_id: str | None  # None when falling back to the file
    version: int | None
    status: str  # 'active', 'candidate', or 'fallback'
    system_prompt: str


def _fallback_prompt() -> SelectedPrompt:
    """Read research_system.txt from disk. Returns version_id=None."""
    text = (
        files("engine.prompts")
        .joinpath("research_system.txt")
        .read_text(encoding="utf-8")
    )
    log.warning(
        "no active prompt_versions row — falling back to research_system.txt"
    )
    return SelectedPrompt(
        version_id=None, version=None, status="fallback", system_prompt=text
    )


def _real_agent_runs_count() -> int:
    """Number of non-seed agent_runs rows recorded so far.

    Drives the A/B parity check. Counting via PostgREST's
    ``count='exact'`` is one round trip with ``head=True``.
    """
    sb = supabase()
    resp = (
        sb.table("agent_runs")
        .select("id", count="exact", head=True)
        .neq("model_used", "seed-data")
        .execute()
    )
    return int(resp.count or 0)


def pick_active_prompt() -> SelectedPrompt:
    """Resolve the system prompt for this run.

    Pulls the highest-version ``active`` row and (if present) the
    highest-version ``candidate`` row. Picks one per the selection
    rules above. Logs the choice so post-run audits can correlate
    behaviour to prompt.
    """
    sb = supabase()
    rows = (
        sb.table("prompt_versions")
        .select("id,version,status,system_prompt")
        .in_("status", ["active", "candidate"])
        .order("version", desc=True)
        .execute()
    )
    data = rows.data or []

    active = next((r for r in data if r["status"] == "active"), None)
    candidate = next((r for r in data if r["status"] == "candidate"), None)

    if active is None:
        return _fallback_prompt()

    if candidate is None:
        log.info(
            "prompt selected version=%s status=active (no candidate)",
            active["version"],
        )
        return SelectedPrompt(
            version_id=active["id"],
            version=active["version"],
            status="active",
            system_prompt=active["system_prompt"],
        )

    # A/B: alternate by parity of the prior run count. Even count →
    # active, odd count → candidate. Deterministic; a reviewer can
    # replay a run by looking at the count at the time.
    count = _real_agent_runs_count()
    pick_candidate = count % 2 == 1
    chosen = candidate if pick_candidate else active
    log.info(
        "prompt selected version=%s status=%s (a/b run_count=%d)",
        chosen["version"],
        chosen["status"],
        count,
    )
    return SelectedPrompt(
        version_id=chosen["id"],
        version=chosen["version"],
        status=chosen["status"],
        system_prompt=chosen["system_prompt"],
    )

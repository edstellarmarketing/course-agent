"""One-shot: seed the current research_system.txt as a candidate
in prompt_versions for /learning to A/B against the active row.

Usage:
    uv --directory engine run seed_research_prompt
    uv --directory engine run seed_research_prompt --promote   # skips A/B
    uv --directory engine run seed_research_prompt --notes "added analyst-report methodology"

Reads engine/src/engine/prompts/research_system.txt verbatim and
inserts a new row with status='candidate' (default) or 'active'
(with --promote, which also retires the previous active row).

The candidate route is the safer default: it shows up at /learning
where you can promote it after the next handful of runs confirm
the agent generates better candidates with it. Promote bypasses
that observation window — only use it when you're certain.
"""

from __future__ import annotations

import argparse
import logging
import sys
from importlib.resources import files

from engine.sentry import init_sentry
from engine.supabase import supabase as get_supabase

LOG_FORMAT = "%(asctime)sZ %(levelname)s %(message)s"
LOG_DATEFMT = "%Y-%m-%dT%H:%M:%S"
# Tracks DEFAULT_RESEARCH_MODEL in cli.py so newly-seeded prompt
# rows attribute themselves to the model actually running them.
DEFAULT_MODEL_SLUG = "deepseek/deepseek-v3.2-exp"


def _load_prompt_text() -> str:
    return files("engine.prompts").joinpath("research_system.txt").read_text(
        encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--promote",
        action="store_true",
        help="Insert as active and retire the previous active. Default is candidate.",
    )
    parser.add_argument(
        "--model-slug",
        type=str,
        default=DEFAULT_MODEL_SLUG,
        help=f"Model slug to record. Default: {DEFAULT_MODEL_SLUG}",
    )
    parser.add_argument(
        "--notes",
        type=str,
        default="Seeded from engine/src/engine/prompts/research_system.txt",
        help="prompt_versions.notes column.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATEFMT)
    init_sentry()
    log = logging.getLogger("seed_research_prompt")

    text = _load_prompt_text()
    log.info("loaded prompt: %d chars", len(text))

    sb = get_supabase()

    existing = (
        sb.table("prompt_versions")
        .select("version")
        .order("version", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    next_version = (existing[0]["version"] + 1) if existing else 1
    log.info("next version: %d", next_version)

    # Avoid duplicates: if the latest row already has identical text,
    # do nothing rather than spawning a string of identical candidates.
    if existing:
        latest = (
            sb.table("prompt_versions")
            .select("id, version, system_prompt, status")
            .order("version", desc=True)
            .limit(1)
            .execute()
            .data[0]
        )
        if latest["system_prompt"] == text:
            log.info(
                "prompt text matches v%d (status=%s) — nothing to insert",
                latest["version"],
                latest["status"],
            )
            return 0

    if args.promote:
        log.info("--promote: retiring current active rows")
        sb.table("prompt_versions").update({"status": "retired"}).eq(
            "status", "active"
        ).execute()
        target_status = "active"
    else:
        target_status = "candidate"

    inserted = (
        sb.table("prompt_versions")
        .insert(
            {
                "version": next_version,
                "model_slug": args.model_slug,
                "system_prompt": text,
                "status": target_status,
                "notes": args.notes,
            }
        )
        .execute()
        .data
    )

    if not inserted:
        log.error("insert returned no rows — check RLS / service-role key")
        return 1

    row = inserted[0]
    log.info(
        "inserted v%d (id=%s, status=%s) — view at /learning",
        row["version"],
        row["id"],
        row["status"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

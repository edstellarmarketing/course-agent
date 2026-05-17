"""``agent`` CLI — single entry point for every Phase 6 invocation.

Usage:
    uv --directory engine run agent run [--dry-run] [--category CAT] [--top-k N]
    uv --directory engine run agent show <run_id>          # Step 9
    uv --directory engine run agent gap-analyze [--top-k N] # Step 3
    uv --directory engine run agent research --category CAT --raw-only  # Step 5

Phase 6 Step 1 ships only ``run`` with ``--dry-run``; subsequent steps
add the other subcommands as their nodes become real.
"""

from __future__ import annotations

import argparse
import logging
import sys

# Windows' default console codepage (cp1252) can't render most non-ASCII
# glyphs. Forcing UTF-8 keeps log output identical across Windows /
# macOS / Linux without falling back to ASCII-only.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

from engine.agent.graph import build_graph
from engine.agent.nodes.gap_analyze import rank_categories
from engine.agent.nodes.inventory_read import load_inventory
from engine.agent.nodes.research import research_one_category
from engine.agent.state import AgentState
from engine.config import settings
from engine.llm.openrouter import OpenRouterClient, RunCostLedger
from engine.rules.dispatcher import RunCostCeilingExceeded

# ── Logging setup ────────────────────────────────────────────────
# UTC ISO timestamps + structured key=value lines, grep-able and
# Sentry-/Langfuse-friendly when those wires get attached in Phase 9.
LOG_FORMAT = "%(asctime)sZ %(levelname)s %(message)s"
LOG_DATEFMT = "%Y-%m-%dT%H:%M:%S"


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format=LOG_FORMAT,
        datefmt=LOG_DATEFMT,
        stream=sys.stdout,
    )
    # The basicConfig formatter already uses gmtime when we override
    # converter at the root.
    for h in logging.getLogger().handlers:
        h.formatter.converter = _utc_converter  # type: ignore[union-attr]


def _utc_converter(*args, **kwargs):
    import time

    return time.gmtime(*args, **kwargs)


# ── Subcommand: run ──────────────────────────────────────────────
def _cmd_run(args: argparse.Namespace) -> int:
    cfg = settings()
    log = logging.getLogger("agent.run")
    ledger = RunCostLedger()
    with OpenRouterClient(DEFAULT_RESEARCH_MODEL, ledger) as or_client:
        initial: AgentState = {
            "dry_run": bool(args.dry_run),
            "forced_category": args.category,
            "top_k": int(args.top_k),
            "max_candidates_per_category": int(args.max_candidates),
            # Non-TypedDict keys; LangGraph passes through untouched.
            "_or_client": or_client,  # type: ignore[typeddict-unknown-key]
            "_ledger": ledger,  # type: ignore[typeddict-unknown-key]
        }
        log.info(
            "run start dry_run=%s category=%r top_k=%d max_candidates=%d ceiling=$%.2f",
            initial["dry_run"],
            initial["forced_category"],
            initial["top_k"],
            initial["max_candidates_per_category"],
            cfg.engine_run_cost_ceiling_usd,
        )
        graph = build_graph()
        try:
            final_state = graph.invoke(initial)
        except RunCostCeilingExceeded as exc:
            log.error("run aborted by cost ceiling: %s", exc)
            log.error(
                "ledger total=$%.4f tokens_in=%d tokens_out=%d",
                ledger.total_usd,
                ledger.total_tokens_in,
                ledger.total_tokens_out,
            )
            return 2
        log.info(
            "run end final_candidates=%d run_id=%s cost=$%.4f tokens_in=%d tokens_out=%d",
            len(final_state.get("final_candidates", []) or []),
            final_state.get("run_id"),
            ledger.total_usd,
            ledger.total_tokens_in,
            ledger.total_tokens_out,
        )
    return 0


# ── Subcommand: research ─────────────────────────────────────────
DEFAULT_RESEARCH_MODEL = "deepseek/deepseek-chat-v3.1"


def _cmd_research(args: argparse.Namespace) -> int:
    """Run one category's research round-trip and print results."""
    import json

    ledger = RunCostLedger()
    with OpenRouterClient(DEFAULT_RESEARCH_MODEL, ledger) as or_client:
        candidates = research_one_category(
            args.category,
            max_candidates=int(args.max_candidates),
            or_client=or_client,
            ledger=ledger,
        )

    if args.raw_only:
        print(
            json.dumps(
                [c.model_dump() for c in candidates],
                indent=2,
                default=str,
            )
        )
    else:
        for i, c in enumerate(candidates, 1):
            print(f"\n--- candidate {i} ---")
            print(f"  title:    {c.title}")
            print(f"  price:    ${c.suggested_price_usd}")
            print(f"  duration: {c.duration_days}d ({c.delivery_format})")
            print(f"  refs:     {len(c.references)}")

    log = logging.getLogger("agent.research")
    log.info(
        "research summary candidates=%d total_cost=$%0.4f tokens_in=%d tokens_out=%d",
        len(candidates),
        ledger.total_usd,
        ledger.total_tokens_in,
        ledger.total_tokens_out,
    )
    return 0


# ── Subcommand: gap-analyze ──────────────────────────────────────
def _cmd_gap_analyze(args: argparse.Namespace) -> int:
    """Print the ranked category list without running the full pipeline."""
    inv = load_inventory()
    ranked = rank_categories(inv.categories, top_k=int(args.top_k))
    print(f"{'#':>3}  {'category':40s}  {'score':>10s}  pinned")
    print("-" * 70)
    name_to_cat = {c["name"]: c for c in inv.categories}
    for i, (name, score) in enumerate(ranked, 1):
        cat = name_to_cat[name]
        pinned = "*" if cat.get("is_pinned") else ""
        print(f"{i:>3}  {name:40s}  {score:>10.1f}  {pinned}")
    return 0


# ── Top-level parser ─────────────────────────────────────────────
def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="agent",
        description="Edstellar course-discovery agent pipeline.",
    )
    p.add_argument("-v", "--verbose", action="store_true", help="DEBUG level logs")
    sub = p.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="Run the agent pipeline end-to-end.")
    p_run.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip all DB writes; nodes still execute their logic.",
    )
    p_run.add_argument(
        "--category",
        type=str,
        default=None,
        help='Override gap analyzer; target exactly one category (e.g. "Cybersecurity").',
    )
    p_run.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="When --category is not given, target this many categories.",
    )
    p_run.add_argument(
        "--max-candidates",
        type=int,
        default=20,
        help="Per-category raw-candidate ceiling for the research node.",
    )
    p_run.set_defaults(func=_cmd_run)

    p_gap = sub.add_parser(
        "gap-analyze",
        help="Print the ranked category list without persisting anything.",
    )
    p_gap.add_argument("--top-k", type=int, default=10)
    p_gap.set_defaults(func=_cmd_gap_analyze)

    p_research = sub.add_parser(
        "research",
        help="Run a single category's Serper + LLM research round-trip.",
    )
    p_research.add_argument("--category", required=True)
    p_research.add_argument("--max-candidates", type=int, default=12)
    p_research.add_argument(
        "--raw-only",
        action="store_true",
        help="Dump validated candidates as a JSON array instead of a summary.",
    )
    p_research.set_defaults(func=_cmd_research)

    return p


def main() -> int:
    args = _build_parser().parse_args()
    _setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

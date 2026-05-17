"""Discover raw candidates per targeted category.

Pipeline per category:

  1. Serper search with a category-specific query → ~10 organic results.
  2. Build a user prompt that includes the system instructions
     (``prompts/research_system.txt``) + the search results as
     contextual evidence the LLM can cite.
  3. Single DeepSeek call via the OpenRouter wrapper, asking for up
     to ``max_candidates_per_category`` candidates as a JSON array.
  4. Validate the JSON against ``RawCandidate`` — drop malformed
     entries with a warning; never let a bad row crash the run.

ScrapeGraphAI's SearchGraph was the original plan, but its known-
providers list doesn't include OpenRouter and its internal LLM cost
wouldn't flow through ``RunCostLedger`` — breaking the Step 9
ceiling. The doc itself names plain-Serper + scrape as the
documented fallback. Phase 8 can graduate this if needed.

The OpenRouter client + ledger live in the agent's state so every
node shares them. We stash them under non-TypedDict keys
(``_or_client`` / ``_ledger``) which LangGraph passes through
untouched — TypedDict's structural typing is happy.
"""

from __future__ import annotations

import json
import logging
import re
from importlib.resources import files
from typing import Any

from pydantic import ValidationError

from engine.agent.candidate import RawCandidate, RawCandidateList
from engine.agent.state import AgentState
from engine.llm.openrouter import OpenRouterClient, RunCostLedger
from engine.llm.serper import search as serper_search

log = logging.getLogger(__name__)

# Loaded once at import time so the file IO doesn't repeat per category.
_RESEARCH_SYSTEM_PROMPT = (
    files("engine.prompts").joinpath("research_system.txt").read_text(encoding="utf-8")
)


def _build_search_query(category: str) -> str:
    """Bias the search toward instructor-led B2B providers / programs."""
    return (
        f'"{category}" instructor-led corporate training enterprise '
        "site:training OR site:academy OR site:school 2025"
    )


def _build_user_prompt(
    category: str,
    serper_hits: list[dict[str, str]],
    max_candidates: int,
) -> str:
    hits_block = "\n".join(
        f"- {h['title']} — {h['link']}\n  {h['snippet']}"
        for h in serper_hits
    ) or "(no search results returned)"
    return (
        f"Category to research: {category}\n\n"
        f"Recent search results to use as market evidence (cite plausibly in price_basis "
        f"and references when relevant; you may also propose ideas the search didn't surface):\n\n"
        f"{hits_block}\n\n"
        f"Return ONLY a JSON array of at most {max_candidates} candidate objects. "
        "Every candidate must satisfy all ten rules from the system prompt. "
        "No markdown fences, no commentary — just the JSON array."
    )


def _strip_json_fences(text: str) -> str:
    """Some models wrap JSON in ```json ... ``` fences despite instructions.

    Strip them defensively so the parser sees raw JSON.
    """
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if fenced:
        return fenced.group(1)
    # Sometimes the model emits a leading "Here are the candidates:" line.
    # Find the first '[' and the last ']' as a coarse rescue.
    first = text.find("[")
    last = text.rfind("]")
    if first >= 0 and last > first:
        return text[first : last + 1]
    return text


def _parse_candidates(raw_text: str, *, category: str) -> list[RawCandidate]:
    """Parse the LLM's JSON. Tolerant of fences and per-item errors."""
    cleaned = _strip_json_fences(raw_text)
    try:
        decoded = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        log.warning(
            "research category=%r JSON decode failed: %s (first 200 chars: %r)",
            category,
            exc,
            cleaned[:200],
        )
        return []

    if not isinstance(decoded, list):
        log.warning(
            "research category=%r expected JSON array, got %s",
            category,
            type(decoded).__name__,
        )
        return []

    out: list[RawCandidate] = []
    for i, item in enumerate(decoded):
        try:
            cand = RawCandidate.model_validate(item)
        except ValidationError as exc:
            log.warning(
                "research category=%r item[%d] validation failed: %s",
                category,
                i,
                exc.errors()[:2],
            )
            continue
        cand = cand.model_copy(update={"category": category})
        out.append(cand)
    return out


def research_one_category(
    category: str,
    *,
    max_candidates: int,
    or_client: OpenRouterClient,
    ledger: RunCostLedger,
) -> list[RawCandidate]:
    """Run one Serper + LLM round-trip and return validated candidates."""
    hits_obj = serper_search(_build_search_query(category), ledger=ledger, num=10)
    hits = [{"title": h.title, "link": h.link, "snippet": h.snippet} for h in hits_obj]

    user_prompt = _build_user_prompt(category, hits, max_candidates)
    completion = or_client.complete(
        [
            {"role": "system", "content": _RESEARCH_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=4096,
        temperature=0.4,
        span="research.candidates",
    )
    candidates = _parse_candidates(completion.text, category=category)
    log.info(
        "research category=%r serper_hits=%d candidates_returned=%d",
        category,
        len(hits),
        len(candidates),
    )
    return candidates


def run(state: AgentState) -> AgentState:
    targets = state.get("targeted_categories") or []
    max_candidates = state.get("max_candidates_per_category", 20)
    or_client = state.get("_or_client")  # type: ignore[typeddict-item]
    ledger = state.get("_ledger")  # type: ignore[typeddict-item]
    if or_client is None or ledger is None:
        # Step 1 dry-run runs the stub; once cli.py wires the client
        # this branch only fires in misconfigured test fixtures.
        log.info("node=research no client/ledger in state — skipping")
        return {"raw_candidates": []}

    all_candidates: list[dict[str, Any]] = []
    for cat in targets:
        cands = research_one_category(
            cat,
            max_candidates=max_candidates,
            or_client=or_client,
            ledger=ledger,
        )
        all_candidates.extend(c.model_dump() for c in cands)

    log.info(
        "node=research targets=%d total_candidates=%d total_cost=$%0.4f",
        len(targets),
        len(all_candidates),
        ledger.total_usd,
    )
    return {"raw_candidates": all_candidates}

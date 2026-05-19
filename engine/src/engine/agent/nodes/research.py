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
from engine.agent.few_shot import load_few_shot_block
from engine.agent.guardrails import addendum_for_category
from engine.agent.state import AgentState
from engine.config import settings
from engine.llm.anthropic import AnthropicClient
from engine.llm.openrouter import OpenRouterClient, RunCostLedger
from engine.llm.serper import search as serper_search

log = logging.getLogger(__name__)

# Fallback prompt loaded at import time. Phase 8 Step 6 makes the
# real source of truth ``prompt_versions`` in the DB — resolved by
# ``feedback_ingest`` and threaded through state. This static read
# stays as a safety net so tests and offline tools can still import
# without a Supabase connection.
_RESEARCH_SYSTEM_PROMPT_FALLBACK = (
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
    existing_categories: list[str] | None = None,
    *,
    use_native_web_search: bool = False,
) -> str:
    if existing_categories:
        cats_block = "\n".join(f"  - {c}" for c in sorted(existing_categories))
        cats_section = (
            "Edstellar's existing categories (use one of these for the candidate's "
            "`category` field unless you're deliberately proposing a brand-new "
            "category — see rule 6 in the system prompt for when that's allowed):\n\n"
            f"{cats_block}\n\n"
        )
    else:
        cats_section = ""

    # When the caller has Claude's native web_search tool available
    # (RESEARCH_LLM_PROVIDER=anthropic), skip the Serper-hits block
    # entirely — the model should do its own targeted searches, not
    # anchor on a 10-row Google snapshot. Otherwise embed the Serper
    # hits as evidence (the original OpenRouter behaviour).
    if use_native_web_search:
        evidence_section = (
            "Use the `web_search` tool to find current evidence for your "
            "candidates before writing them up:\n"
            "  - At least 3 searches per candidate covering: existing "
            "provider catalogues (Coursera/Pluralsight/LinkedIn/SANS/etc), "
            "vendor / certification body sites, and pricing benchmarks.\n"
            "  - Only cite URLs that you actually opened during the call. "
            "Never include a URL you haven't read — Rule 7 throws unread "
            "URLs out anyway, and you'll waste tokens.\n"
            "  - Quote one sentence verbatim from each reference's page "
            "into the `quote` field; Rule 7 verifies that exact substring "
            "appears on the linked page.\n\n"
        )
    else:
        hits_block = "\n".join(
            f"- {h['title']} — {h['link']}\n  {h['snippet']}"
            for h in serper_hits
        ) or "(no search results returned)"
        evidence_section = (
            "Recent search results to use as market evidence (cite plausibly in "
            "price_basis and references when relevant; you may also propose ideas "
            f"the search didn't surface):\n\n{hits_block}\n\n"
        )

    return (
        f"Category to research: {category}\n\n"
        f"{cats_section}"
        f"{evidence_section}"
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
    system_prompt_base: str | None = None,
    existing_categories: list[str] | None = None,
) -> list[RawCandidate]:
    """Run one Serper + LLM round-trip and return validated candidates.

    ``system_prompt_base`` defaults to the file-loaded fallback so
    callers (CLI's `agent research` subcommand for example) don't
    need to thread the DB-resolved prompt through. The graph's
    research node always passes the resolved active/candidate text.

    When ``RESEARCH_LLM_PROVIDER=anthropic`` the function skips the
    Serper round-trip entirely and asks Claude to use its native
    ``web_search`` tool — no point paying for Serper and then
    feeding a stale snapshot into a prompt that's about to do
    fresh searches anyway.
    """
    cfg = settings()
    use_anthropic = cfg.research_llm_provider == "anthropic"

    if use_anthropic:
        hits: list[dict[str, str]] = []
        log.info(
            "research category=%r serper skipped (provider=anthropic; "
            "model will use native web_search)",
            category,
        )
    else:
        hits_obj = serper_search(
            _build_search_query(category), ledger=ledger, num=10
        )
        hits = [
            {"title": h.title, "link": h.link, "snippet": h.snippet}
            for h in hits_obj
        ]

    # Phase 8 Step 3: few-shot signals from the category's feedback
    # history. Empty block → first message stack stays Phase-6-shape.
    few_shot = load_few_shot_block(category)
    # Phase 8 Step 4: dominant-tag-driven guardrail addendum. None
    # when no JSON entry, no rejections in window, or non-matching
    # dominant tag.
    guardrail = addendum_for_category(category)

    system_prompt = system_prompt_base or _RESEARCH_SYSTEM_PROMPT_FALLBACK
    if guardrail:
        system_prompt = (
            f"{system_prompt}\n\n"
            f"CATEGORY-SPECIFIC GUARDRAIL (from recent reviewer rejections):\n"
            f"{guardrail}"
        )

    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
    ]
    if few_shot.has_examples:
        messages.append({"role": "system", "content": few_shot.as_prompt_text()})

    user_prompt = _build_user_prompt(
        category,
        hits,
        max_candidates,
        existing_categories=existing_categories,
        use_native_web_search=use_anthropic,
    )
    messages.append({"role": "user", "content": user_prompt})

    # Phase 9 reviewer-feedback round expanded each candidate's JSON
    # output (content_outline + package_fit + lab_requirements +
    # edstellar_pitch). A typical 5-candidate response now needs
    # ~6-8K output tokens; 4096 was truncating responses mid-array
    # and producing zero validatable candidates. 8192 is the upper
    # bound for the default research model (deepseek-chat-v3.1) and
    # most OpenRouter routed alternatives.
    #
    # Provider toggle (cfg already read above). When use_anthropic
    # is True the call goes direct to Anthropic with web_search
    # enabled — grounded references at a noticeable cost premium.
    # Every OTHER LLM call in this run (rule_07 ref-verify, rule_10
    # cert-judge, etc.) stays on OpenRouter regardless; only
    # research benefits enough from web search to justify it.
    research_client: AnthropicClient | OpenRouterClient
    if use_anthropic:
        research_client = AnthropicClient(
            default_model=cfg.anthropic_research_model,
            ledger=ledger,
        )
    else:
        research_client = or_client
    completion = research_client.complete(
        messages,
        max_tokens=8192,
        temperature=0.4,
        span="research.candidates",
    )
    candidates = _parse_candidates(completion.text, category=category)
    log.info(
        "research category=%r serper_hits=%d candidates_returned=%d "
        "few_shot=(approvals=%d, rejections=%d) guardrail=%s",
        category,
        len(hits),
        len(candidates),
        len(few_shot.approvals),
        len(few_shot.rejections),
        "fired" if guardrail else "none",
    )
    return candidates


def research_one_node(state: AgentState) -> AgentState:
    """One-category research branch — the target of Phase 9 Step 4's
    LangGraph ``Send`` fan-out.

    The router in ``graph.py`` emits one ``Send("research_one", …)``
    per targeted category, each carrying ``_branch_category`` plus
    the shared OpenRouter client and cost ledger. The list reducer
    on ``raw_candidates`` concatenates every branch's output before
    the rule engine runs.

    The shared ``RunCostLedger`` is locked on writes (see
    ``engine.llm.openrouter``), so concurrent appends from parallel
    branches don't race.
    """
    category = state.get("_branch_category")
    if not category:
        log.warning("research_one: no _branch_category in state — skipping")
        return {"raw_candidates": []}

    or_client = state.get("_or_client")  # type: ignore[typeddict-item]
    ledger = state.get("_ledger")  # type: ignore[typeddict-item]
    if or_client is None or ledger is None:
        log.info("research_one category=%r no client/ledger — skipping", category)
        return {"raw_candidates": []}

    max_candidates = state.get("max_candidates_per_category", 20)
    system_prompt_base = state.get("_prompt_system_text") or None  # type: ignore[typeddict-item]
    existing_categories = state.get("_existing_categories") or None  # type: ignore[typeddict-item]

    cands = research_one_category(
        category,
        max_candidates=max_candidates,
        or_client=or_client,
        ledger=ledger,
        system_prompt_base=system_prompt_base,
        existing_categories=existing_categories,
    )
    return {"raw_candidates": [c.model_dump() for c in cands]}


def run(state: AgentState) -> AgentState:
    """Sequential fallback retained for tests + the legacy CLI path.

    The compiled graph wires ``research_one_node`` behind a fan-out
    router; this function is no longer on the runtime path. Kept so
    fixtures and the ``agent research`` subcommand can drive a
    single-process loop without the LangGraph machinery.
    """
    targets = state.get("targeted_categories") or []
    max_candidates = state.get("max_candidates_per_category", 20)
    or_client = state.get("_or_client")  # type: ignore[typeddict-item]
    ledger = state.get("_ledger")  # type: ignore[typeddict-item]
    if or_client is None or ledger is None:
        log.info("node=research no client/ledger in state — skipping")
        return {"raw_candidates": []}

    system_prompt_base = state.get("_prompt_system_text") or None  # type: ignore[typeddict-item]

    all_candidates: list[dict[str, Any]] = []
    for cat in targets:
        cands = research_one_category(
            cat,
            max_candidates=max_candidates,
            or_client=or_client,
            ledger=ledger,
            system_prompt_base=system_prompt_base,
        )
        all_candidates.extend(c.model_dump() for c in cands)

    log.info(
        "node=research targets=%d total_candidates=%d total_cost=$%0.4f",
        len(targets),
        len(all_candidates),
        ledger.total_usd,
    )
    return {"raw_candidates": all_candidates}

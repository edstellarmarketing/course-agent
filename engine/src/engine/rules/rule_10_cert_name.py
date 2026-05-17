"""Rule 10: no certification names, credential acronyms, or
certifying-body names in the title.

Three-layer check (architectural plan §3.6):

  (a) static blocklist — substring/whole-word match against
      ``data/cert_blocklist.txt``. Case-insensitive.
  (b) regex patterns — common cert-flavoured phrasings.
  (c) LLM judge — a cheap Haiku-tier yes/no call via OpenRouter.
      Only runs if (a) and (b) both pass.

Step 7 adds the rename loop: when (c) flags, re-prompt the research
model once with the catch as context and ask for a neutral title;
re-run a-c on the new title. Step 6 just exposes the catch via the
dispatcher (the candidate is dropped); Step 7 will move the rename
attempt into this module.

Layer (c)'s result is cached per-title within the run so re-checks
after rename don't double-bill.
"""

from __future__ import annotations

import logging
import re
from importlib.resources import files

from engine.agent.candidate import RawCandidate

log = logging.getLogger(__name__)


# ── Layer (a) — static blocklist ────────────────────────────────
def _load_blocklist() -> list[str]:
    raw = files("engine.rules.data").joinpath("cert_blocklist.txt").read_text(
        encoding="utf-8"
    )
    return [line.strip() for line in raw.splitlines() if line.strip() and not line.startswith("#")]


_BLOCKLIST = _load_blocklist()


def _matches_blocklist(title: str) -> str | None:
    lowered = title.lower()
    for entry in _BLOCKLIST:
        # Whole-word match for short tokens (CISSP, PMP, etc.) to avoid
        # false positives on substrings inside longer words.
        if len(entry) <= 6:
            if re.search(rf"\b{re.escape(entry.lower())}\b", lowered):
                return entry
        else:
            if entry.lower() in lowered:
                return entry
    return None


# ── Layer (b) — regex patterns ──────────────────────────────────
_REGEX_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("certified prefix", re.compile(r"\bcertified\b", re.IGNORECASE)),
    ("certification suffix", re.compile(r"\bcertification\b", re.IGNORECASE)),
    ("certificate suffix", re.compile(r"\bcertificate\b", re.IGNORECASE)),
    ("exam prep", re.compile(r"\bexam\s*(?:prep|preparation)\b", re.IGNORECASE)),
    ("foundation cert", re.compile(r"\bfoundation\b.{0,15}\bcert\w*", re.IGNORECASE)),
    ("practitioner cert", re.compile(r"\bpractitioner\b.{0,15}\bcert\w*", re.IGNORECASE)),
]


def _matches_regex(title: str) -> str | None:
    for name, pattern in _REGEX_PATTERNS:
        if pattern.search(title):
            return name
    return None


# ── Layer (c) — LLM judge ───────────────────────────────────────
_JUDGE_PROMPT_TEMPLATE: str | None = None
_judge_cache: dict[str, bool] = {}


def _load_judge_prompt() -> str:
    global _JUDGE_PROMPT_TEMPLATE
    if _JUDGE_PROMPT_TEMPLATE is None:
        _JUDGE_PROMPT_TEMPLATE = (
            files("engine.prompts")
            .joinpath("cert_judge.txt")
            .read_text(encoding="utf-8")
        )
    return _JUDGE_PROMPT_TEMPLATE


def _ask_llm_judge(title: str, ctx) -> bool:  # noqa: ANN001
    """Return True if the model says the title references a credential."""
    cached = _judge_cache.get(title)
    if cached is not None:
        return cached
    prompt = _load_judge_prompt().format(title=title)
    completion = ctx.or_client.complete(
        [{"role": "user", "content": prompt}],
        model=ctx.cert_judge_model,
        max_tokens=8,
        temperature=0.0,
        span="rule_10.cert_judge",
    )
    answer = completion.text.strip().lower()
    flagged = answer.startswith("yes")
    _judge_cache[title] = flagged
    if flagged:
        log.info("rule_10.cert_judge flagged title=%r raw=%r", title, completion.text[:40])
    return flagged


def reset_cache() -> None:
    """Test hook — drops the judge cache between fixtures."""
    _judge_cache.clear()


# ── Dispatcher entry point ──────────────────────────────────────
def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    title = candidate.title
    if (hit := _matches_blocklist(title)) is not None:
        return RuleResult.failed(f"cert blocklist hit: {hit!r}")
    if (hit := _matches_regex(title)) is not None:
        return RuleResult.failed(f"cert regex hit: {hit}")
    # Layer (c) only runs if a/b passed AND we have a client.
    if ctx.or_client is None:
        return RuleResult.passed()
    if _ask_llm_judge(title, ctx):
        return RuleResult.failed("cert llm judge flagged")
    return RuleResult.passed()

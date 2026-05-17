"""Rule 10: no certification names, credential acronyms, or
certifying-body names in the title.

Three-layer check (architectural plan §3.6):

  (a) static blocklist — substring/whole-word match against
      ``data/cert_blocklist.txt``. Case-insensitive.
  (b) regex patterns — common cert-flavoured phrasings.
  (c) LLM judge — a cheap Haiku-tier yes/no call via OpenRouter.
      Only runs if (a) and (b) both pass.

Phase 8 Step 9b adds the rename loop. When layer (c) flags a title,
we ask the research model to propose a neutral rename — capturing
the same body of knowledge without naming the credential or
certifying body. The rename runs back through layers (a)-(c). If
the new title still fails, the candidate is dropped (the Phase 6
fallback). Cap: one rename retry per candidate; recursion is
explicitly bounded.

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


# ── Phase 8 Step 9b — rename loop ───────────────────────────────
_RENAME_PROMPT_TEMPLATE = (
    "The course title \"{title}\" was rejected for referencing a "
    "specific certification, credential acronym, or certifying-body "
    "name. Edstellar is not an authorised partner of these bodies.\n\n"
    "Propose ONE neutral, descriptive replacement title that "
    "captures the same body of knowledge without naming the "
    "credential or issuer. Output only the new title, nothing else "
    "— no quotes, no commentary, no preamble."
)


def _ask_rename(original_title: str, ctx) -> str | None:  # noqa: ANN001
    """Ask the research model for a neutral rename. Returns the new title
    or ``None`` on any failure. Never raises into the dispatcher."""
    try:
        completion = ctx.or_client.complete(
            [{"role": "user", "content": _RENAME_PROMPT_TEMPLATE.format(title=original_title)}],
            model=None,  # uses the client's default (the research model)
            max_tokens=64,
            temperature=0.3,
            span="rule_10.rename",
        )
    except Exception as exc:  # noqa: BLE001 — rename failure ≠ rule failure
        log.warning("rule_10.rename failed: %s", exc)
        return None
    new = completion.text.strip().strip('"').strip("'").strip()
    # Defensive — sometimes the model adds a leading "Title: " prefix.
    new = re.sub(r"^(?:title|new title|revised title)\s*:\s*", "", new, flags=re.IGNORECASE)
    if not new or new == original_title:
        return None
    return new


# ── Dispatcher entry point ──────────────────────────────────────
def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    title = candidate.title
    # Layers (a) + (b) are free; check them first.
    if (hit := _matches_blocklist(title)) is not None:
        return _try_rename_or_fail(
            candidate, ctx, reason=f"cert blocklist hit: {hit!r}"
        )
    if (hit := _matches_regex(title)) is not None:
        return _try_rename_or_fail(
            candidate, ctx, reason=f"cert regex hit: {hit}"
        )
    # Layer (c) only runs if a/b passed AND we have a client.
    if ctx.or_client is None:
        return RuleResult.passed()
    if _ask_llm_judge(title, ctx):
        return _try_rename_or_fail(
            candidate, ctx, reason="cert llm judge flagged"
        )
    return RuleResult.passed()


def _try_rename_or_fail(
    candidate: RawCandidate, ctx, *, reason: str  # noqa: ANN001
) -> "RuleResult":
    """Phase 8 Step 9b — single rename retry, then drop on failure.

    The candidate's title is mutated in place when the rename
    succeeds. The dispatcher already has the candidate by reference
    from RULE_ORDER, so the new title flows through subsequent rules
    + persistence.
    """
    from engine.rules.dispatcher import RuleResult

    # No client → can't rename, drop straight away.
    if ctx.or_client is None:
        return RuleResult.failed(reason)

    original = candidate.title
    new = _ask_rename(original, ctx)
    if new is None:
        return RuleResult.failed(f"{reason} (rename failed)")

    # Re-run layers (a)-(c) against the new title.
    if _matches_blocklist(new) is not None:
        return RuleResult.failed(
            f"{reason}; rename to {new!r} also blocklist-hit, dropped"
        )
    if _matches_regex(new) is not None:
        return RuleResult.failed(
            f"{reason}; rename to {new!r} also regex-hit, dropped"
        )
    if _ask_llm_judge(new, ctx):
        return RuleResult.failed(
            f"{reason}; rename to {new!r} also llm-judge-flagged, dropped"
        )

    # Rename survived all three layers — mutate the candidate so the
    # rest of the pipeline (Rule 2 fuzzy check, persistence) sees the
    # neutral title.
    log.info(
        "rule_10.rename salvaged title=%r -> %r (orig reason=%s)",
        original,
        new,
        reason,
    )
    object.__setattr__(candidate, "title", new)
    return RuleResult.passed()

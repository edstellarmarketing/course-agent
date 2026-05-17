"""Rule 7: each reference URL must genuinely support the claim.

Phase 6 implementation: fetch each URL with ``httpx``, strip HTML
to readable text, then ask the LLM judge "does this page support
the topic? yes / no / unsure". Phase 8 Step 9a relaxed the fail
condition to MAJORITY-VOTE — a candidate's refs survive unless
``no_count >= ceil(N / 2)``. The original single-no-fails rule
killed otherwise-credible candidates on a single LLM hiccup
against authoritative sources like NIST or finops.org.

Cost trade-off — Rule 7 is the most expensive rule on the path
(roughly $0.003 / candidate at 3 refs). The dispatcher places it
after the free structural rules (3/4/6/5+8) and Rule 10 layers a/b
so we never pay it for a candidate that's going to fail anyway.

Failure modes handled inline:
  - Non-200 fetch → ``unsure`` (don't kill on transient HTTP)
  - JS-rendered near-empty page → ``unsure``
  - Network timeout → ``unsure``

A blanket "unsure" run survives Rule 7. The reviewer eyeballs the
references on /suggestions/[id] — they're the human backstop.
"""

from __future__ import annotations

import logging
import re
from importlib.resources import files

import httpx

from engine.agent.candidate import RawCandidate

log = logging.getLogger(__name__)

FETCH_TIMEOUT_S = 15.0
PAGE_MAX_CHARS = 4000  # ~1k tokens — enough for the model to judge
USER_AGENT = "Mozilla/5.0 (course-agent verifier; +https://edstellar.com)"

_RX_TAGS = re.compile(r"<[^>]+>", re.DOTALL)
_RX_WS = re.compile(r"\s+")

_REF_PROMPT_TEMPLATE: str | None = None


def _load_prompt() -> str:
    global _REF_PROMPT_TEMPLATE
    if _REF_PROMPT_TEMPLATE is None:
        _REF_PROMPT_TEMPLATE = (
            files("engine.prompts")
            .joinpath("ref_verifier.txt")
            .read_text(encoding="utf-8")
        )
    return _REF_PROMPT_TEMPLATE


def _strip_html(html: str) -> str:
    """Cheap HTML → text. Good enough; we're feeding an LLM, not a parser."""
    no_tags = _RX_TAGS.sub(" ", html)
    return _RX_WS.sub(" ", no_tags).strip()


def _fetch(url: str) -> str | None:
    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT_S,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            resp = client.get(url)
        if resp.status_code != 200:
            log.info("rule_07 fetch %s -> HTTP %d", url, resp.status_code)
            return None
        body = resp.text
        if not body:
            return None
        return _strip_html(body)[:PAGE_MAX_CHARS]
    except httpx.RequestError as exc:
        log.info("rule_07 fetch %s -> error %s", url, type(exc).__name__)
        return None


def _judge_one(topic: str, ref_name: str, ref_url: str, ctx) -> str:  # noqa: ANN001
    """Return 'yes', 'no', or 'unsure'."""
    content = _fetch(ref_url)
    if content is None:
        return "unsure"
    if len(content) < 100:
        # Likely JS-rendered emptiness; can't judge.
        return "unsure"
    prompt = _load_prompt().format(
        topic=topic,
        ref_name=ref_name,
        ref_url=ref_url,
        page_content=content,
    )
    completion = ctx.or_client.complete(
        [{"role": "user", "content": prompt}],
        model=ctx.cert_judge_model,
        max_tokens=8,
        temperature=0.0,
        span="rule_07.ref_verify",
    )
    answer = completion.text.strip().lower().split()[0] if completion.text else "unsure"
    if answer not in {"yes", "no", "unsure"}:
        answer = "unsure"
    return answer


def majority_fail_threshold(total: int) -> int:
    """Number of 'no' verdicts required to fail majority-vote.

    Returns ceil(total / 2). Extracted so unit tests can verify the
    arithmetic without spinning up a real LLM judge.
    """
    if total <= 0:
        return 0
    return (total + 1) // 2


def check(candidate: RawCandidate, ctx) -> "RuleResult":  # noqa: ANN001
    from engine.rules.dispatcher import RuleResult

    if ctx.or_client is None:
        return RuleResult.passed()

    topic = f"{candidate.title} — {candidate.rationale[:160]}"
    yes = 0
    no = 0
    unsure = 0
    no_urls: list[str] = []
    for ref in candidate.references:
        verdict = _judge_one(topic, ref.name, ref.url, ctx)
        if verdict == "yes":
            yes += 1
        elif verdict == "no":
            no += 1
            no_urls.append(ref.url)
        else:
            unsure += 1

    # Phase 8 Step 9a — majority-vote: fail only when no_count >=
    # ceil(N / 2). Three refs need >= 2 nos to fail; two refs need
    # 1; four refs need 2. Keeps a single over-strict LLM verdict
    # from killing an otherwise-credible candidate against
    # authoritative sources (NIST, finops.org, Microsoft Zero Trust).
    total = yes + no + unsure
    threshold = majority_fail_threshold(total)
    if no >= threshold and total > 0:
        return RuleResult.failed(
            f"refs majority-fail: yes={yes} no={no} unsure={unsure} "
            f"(need {threshold} nos to fail); first off-topic={no_urls[0]}"
        )
    return RuleResult.passed()

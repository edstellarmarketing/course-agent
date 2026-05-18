"""Rule 7: each reference URL must genuinely support the claim.

Phase 6 implementation: fetch each URL with ``httpx``, strip HTML
to readable text, then ask the LLM judge "does this page support
the topic? yes / no / unsure". Phase 8 Step 9a relaxed the fail
condition to MAJORITY-VOTE — a candidate's refs survive unless
``no_count >= ceil(N / 2)``. The original single-no-fails rule
killed otherwise-credible candidates on a single LLM hiccup
against authoritative sources like NIST or finops.org.

Phase 9 reviewer-feedback round added two MUTATIONS to the
candidate's references list:

  1. Drop refs that returned HTTP 404 / 410 (genuinely broken URLs
     the agent invented). 403s are KEPT — many publishers
     (Gartner, CNCF) bot-block HEAD/GET but the URL is fine in a
     human browser; we can't verify so we trust.

  2. Null out the new ``quote`` field when the agent's verbatim
     quote doesn't actually appear in the fetched page text. This
     catches hallucinated quotes attributed to real URLs. When
     the page can't be fetched (403, timeout, JS-rendered), the
     quote stays — we can't disprove it, the reviewer eyeballs
     the page.

After the mutations, if the candidate has fewer than MIN_LIVE_REFS
verified refs remaining, the rule fails — without enough evidence,
the candidate isn't worth a reviewer's time even if the survivors
look credible.

Cost trade-off — Rule 7 is the most expensive rule on the path
(roughly $0.003 / candidate at 3 refs, more at 5-8). The dispatcher
places it after the free structural rules (3/4/6/5+8) and Rule 10
layers a/b so we never pay it for a candidate that's going to fail
anyway.

Failure modes handled inline:
  - Non-200 fetch (other than 404/410) → ``unsure`` (don't kill on transient HTTP)
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
PAGE_MAX_CHARS = 4000  # ~1k tokens — enough for the LLM judge
PAGE_QUOTE_CHARS = 30000  # bigger window for substring quote search
USER_AGENT = "Mozilla/5.0 (course-agent verifier; +https://edstellar.com)"

# Minimum refs that must survive the 404-drop filter. Lower than the
# agent's 5-8 target so we don't over-fail when a candidate had a
# couple of broken URLs but 3+ live ones support it.
MIN_LIVE_REFS = 3

# Status codes that mean "this URL is genuinely broken, drop the ref".
# 403 deliberately excluded — many publishers bot-block but the URL
# resolves fine for humans.
DEAD_STATUSES = {404, 410}

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


def _fetch(url: str) -> tuple[int | None, str | None]:
    """Return (status_code, full_text). status_code is None on network errors.
    full_text is None when the body is missing or too short to use; otherwise
    the stripped page text (capped at PAGE_QUOTE_CHARS for quote search).
    """
    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT_S,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            resp = client.get(url)
        if resp.status_code != 200:
            log.info("rule_07 fetch %s -> HTTP %d", url, resp.status_code)
            return resp.status_code, None
        body = resp.text
        if not body:
            return 200, None
        return 200, _strip_html(body)[:PAGE_QUOTE_CHARS]
    except httpx.RequestError as exc:
        log.info("rule_07 fetch %s -> error %s", url, type(exc).__name__)
        return None, None


def _verify_quote(quote: str | None, page_text: str | None) -> bool:
    """True if the quote appears verbatim (case-insensitive) on the page."""
    if not quote or not page_text:
        return False
    return quote.strip().lower() in page_text.lower()


def _judge_relevance(
    topic: str, ref_name: str, ref_url: str, page_excerpt: str, ctx
) -> str:  # noqa: ANN001
    """Return 'yes', 'no', or 'unsure' from the LLM verifier."""
    prompt = _load_prompt().format(
        topic=topic,
        ref_name=ref_name,
        ref_url=ref_url,
        page_content=page_excerpt,
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
    dropped_404 = 0
    unverified_quotes = 0
    refs_kept = []  # mutates onto candidate.references at the end

    for ref in candidate.references:
        status, page_text = _fetch(ref.url)

        # Phase 9: drop genuinely-broken URLs. Quote (if any) goes
        # with them — a quote attached to a 404 is worthless anyway.
        if status in DEAD_STATUSES:
            dropped_404 += 1
            continue

        # Phase 9: quote verification when we successfully fetched
        # the page. When the fetch failed (403, timeout) we can't
        # disprove the quote so we leave it.
        if ref.quote and page_text:
            if not _verify_quote(ref.quote, page_text):
                ref.quote = None
                unverified_quotes += 1
                log.info(
                    "rule_07 unverify-quote %s (not on page)", ref.url
                )

        # LLM judgement on relevance — only when we have readable
        # content. JS-rendered or 403 → unsure (don't kill candidate).
        if page_text and len(page_text) >= 100:
            excerpt = page_text[:PAGE_MAX_CHARS]
            verdict = _judge_relevance(topic, ref.name, ref.url, excerpt, ctx)
        else:
            verdict = "unsure"

        if verdict == "yes":
            yes += 1
        elif verdict == "no":
            no += 1
            no_urls.append(ref.url)
        else:
            unsure += 1
        refs_kept.append(ref)

    # Phase 9: replace the candidate's refs with the survivors. The
    # persist node + UI both read candidate.references; mutating in
    # place avoids threading a "filtered_refs" sidecar through the
    # whole pipeline. RawCandidate is a Pydantic model but field
    # mutation is allowed at runtime.
    if dropped_404 or unverified_quotes:
        candidate.references = refs_kept
        log.info(
            "rule_07 filter %s dropped_404=%d unverified_quotes=%d kept=%d",
            candidate.title[:50],
            dropped_404,
            unverified_quotes,
            len(refs_kept),
        )

    # Hard minimum after the drop filter — without enough evidence
    # the candidate isn't worth reviewer time even if survivors look
    # credible.
    if len(refs_kept) < MIN_LIVE_REFS:
        return RuleResult.failed(
            f"refs after-filter kept={len(refs_kept)} dropped_404={dropped_404} "
            f"need>={MIN_LIVE_REFS}"
        )

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

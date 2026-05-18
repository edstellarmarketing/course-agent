# Serper-verify path for references — planned, not yet built

> **Status**: planned, **not yet implemented**. Pick up this doc next
> session to make the open decisions, then say "go" and the agent
> will execute. File name is `serper-verify.md` (not "server") — this
> is about Serper, the Google-search API the engine already uses.

---

## Why this exists

Reviewer feedback: the agent sometimes invents URLs that look real but
404 on click-through. A recent example: a plausible-looking Gartner
press-release URL `gartner.com/.../2023-11-28-gartner-predicts-...`
that was actually fabricated. The agent attributed a quote to it; the
URL doesn't exist.

`rule_07` already drops genuine 404s (committed in `006bd37`) but
publisher bot-blocks (Gartner, CNCF, McKinsey — return 403 to httpx)
let other fabricated URLs slip through because we can't `GET` them
to verify.

**Serper-verify** uses Google's index — via the Serper API the engine
already wires for research — to confirm each reference URL really
exists before the agent's suggestion gets persisted.

---

## How it works

A new step at the **top of `rule_07`**:

```
research_one → raw_candidates
   └─► rule_engine
        └─► rule_07
             1. Serper-verify (NEW): drop refs Google doesn't know
             2. httpx fetch (existing): on survivors only
             3. quote substring verify (existing)
             4. LLM relevance judge (existing)
             5. majority-vote on candidate
```

Per ref, the new step does:

```
domain    = urlparse(ref.url).netloc.removeprefix("www.")
query     = f'"{ref.name}" site:{domain}'
results   = serper.search(query, num=5)

for r in results:
    if normalize_url(r.link) == normalize_url(ref.url):
        return "verified"   # KEEP
return "missing"            # DROP
```

URL normalization: lowercase + strip `www.` + strip trailing slash +
strip query/fragment, then compare host + path.

**Outcomes per reference:**

| Serper result | What happens |
|---|---|
| Agent's URL in top 5 | KEEP — verified real |
| Different URL on same domain matching `name` | KEEP for v1 (replacement deferred — see below) |
| Nothing matches | DROP — agent invented it |

**Bot-block bypass** is the main win — Gartner returns 403 to httpx but
Serper sees Google's already-crawled index of the page, so we can verify
Gartner URLs without ever fetching them ourselves.

---

## Cost + latency budget

| Metric | Estimate |
|---|---|
| Serper queries per agent run | ~150 (5 refs × 5 cands × 5 cats, roughly) |
| Cost per run added | **~$0.15–0.20** |
| Sequential latency | ~2.5 min |
| Parallelized (5 at a time) | **~30 s** |
| Daily run total | Still well under the $5/run + $10/day ceilings |

Free Serper tier is 2,500 queries/month — too small. Confirm the
Serper plan can handle ~4,500/month before flipping the feature on.

---

## Files to be touched

| File | Change |
|---|---|
| `engine/src/engine/config.py` | 3 new env-var fields: `SERPER_VERIFY_REFS_ENABLED` (bool, default true), `SERPER_VERIFY_TOP_N` (int, default 5), `SERPER_VERIFY_CONCURRENT` (int, default 5) |
| `engine/src/engine/llm/ref_verify_serper.py` | **NEW**. Exports `verify_refs_via_serper(refs) -> (kept, dropped, dropped_urls)`. URL normalization helper. Reuses existing `engine.llm.serper`. |
| `engine/src/engine/rules/rule_07_references.py` | Call `verify_refs_via_serper()` at the top of `check()`. Pass survivors through to existing httpx + LLM flow. |
| `engine/src/engine/llm/serper.py` | Verify the existing wrapper returns full URLs in result objects — may need a tiny extension. |
| `engine/tests/test_rules.py` | Optional: unit tests for URL normalization edge cases. |

Effort: ~1 hour of code + 30 min local verify.

---

## Open decisions to make next session

| # | Question | Recommended default |
|---|---|---|
| 1 | Drop-only, or also auto-replace bad URLs with Serper's top match? | **Drop-only for v1**. Replacement is risky — agent's quote was attributed to the OLD URL, swapping might mis-attribute. Add later behind a flag if it'd help. |
| 2 | Search format | **Domain-constrained primary** (`"name" site:domain`), broader fallback (`"name"`) if domain-constrained returns nothing. |
| 3 | How many top results to scan | **Top 5**. Serper returns 10 by default; top 5 is enough to find the canonical URL. |
| 4 | URL normalization aggressiveness | **Yes** — strip `www.`, strip trailing slash, lowercase, drop query+fragment. |
| 5 | Concurrency | **Parallel, 5-at-a-time** via thread pool. Cuts 2.5 min to ~30 s. |
| 6 | Behaviour when Serper is down | **Skip verification, log warning, proceed with existing httpx-only flow.** Don't fail the run. |
| 7 | Where to log dropped refs | **stdout** (visible in Coolify cron logs) + Sentry breadcrumb |

If you accept all defaults, say **"go with all defaults on serper-verify"** next time and the agent will execute.

If you want to change something, tell me which row + how before saying go.

---

## Testing plan (for after it ships)

1. **Local dry-run with verbose logging** — see which refs got "Serper missing" verdicts; spot-check 2–3 of them in your browser to confirm they're actually fabricated (not over-rejection of real obscure sources).

2. **A/B run on the same category** — once with `SERPER_VERIFY_REFS_ENABLED=false`, once with it on. Compare:
   - Candidate count (some weak candidates may fail rule_07's `MIN_LIVE_REFS=3` floor after Serper dropping)
   - Ref count per surviving candidate
   - 404 rate post-persist (should be near zero)

3. **Cost check** after a real run:
   ```sql
   select span, count(*), sum(cost_usd::numeric)
   from "course-agent".agent_runs ar,
        jsonb_array_elements(ar.cost_ledger -> 'calls') c(elem)
   where elem ->> 'span' like 'serper.%'
   group by span;
   ```
   Confirm it's roughly $0.15–0.20 per run, not $1+.

4. **Over-rejection check** — pick 5 dropped refs from the logs and try them in a browser. If 3+ are actually fine pages just not in Google's top results, the normalization or search query is too strict.

---

## Risks worth knowing in advance

1. **Serper rate limits** — confirm plan supports ~4,500/month before flipping on.
2. **Over-rejection of obscure sources** — small podcast pages, single-author PDFs, internal company microsites may not be indexed by Google but ARE real references. The broader fallback query helps but doesn't fix all cases.
3. **Domain quirks** — Serper occasionally returns subdomain variants (e.g. `cloud.google.com` vs `www.google.com/cloud`). Normalization needs care.
4. **Latency variance** — occasional Serper queries take 5+ s. Hard timeout of 8 s per query bounds this; failed queries fall through to "missing".
5. **What about real but very deep pages?** — Some publisher pages (training program detail pages on `pwc.com/.../specific-course-name`) may not be in Google's index even though they exist. These are the same pages Rule 7's existing httpx step would catch via 200 fetch — so the existing 404-drop logic is the safety net.

---

## Why we're doing Serper instead of Playwright

We considered using Playwright (headless Chrome) to fetch pages like a
real browser. Honest comparison from the previous session:

| Approach | Latency added | Cost added | Bot-block solved? | Effort |
|---|---|---|---|---|
| Current (httpx) | 0 | 0 | ❌ misjudges 403s | — |
| **Serper-verify** | +30 s | **+$0.20/run** | ✅ Google has indexed it | **Low** (this doc) |
| Playwright | +10–15 min | $0 ext. but real compute | ✅ but Cloudflare etc. is cat-and-mouse | **High** (infra) |

Serper wins because it reuses an existing dependency, costs almost
nothing, and adds 30 s instead of 10–15 min. Playwright stays on the
shelf for later if we want screenshots or page-content matching.

---

## When you come back

1. Re-read the **Open decisions** table above.
2. Reply with either **"go with all defaults on serper-verify"** or "go with these changes: …".
3. The agent will:
   - Add the new file + env vars
   - Wire into `rule_07`
   - Run a local Cloud Computing test against the same baseline you've been using
   - Show the before/after numbers (drop rate, surviving refs, cost)
   - Commit + push if you accept the result

Estimated total session time: 30 min to ship + verify.

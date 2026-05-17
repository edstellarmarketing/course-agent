# Phase 6 — Python Agent Pipeline

Sister-doc to `edstellar_agent_build_plan.md`, `phase2.md`, `phase3.md`,
and `phase5.md`. The build plan says *what* Phase 6 produces; this doc
walks the work in the order it actually happens at a keyboard.

**Goal:** A manual run of the engine ingests yesterday's feedback,
reads inventory, picks under-supplied categories, researches the web
for candidate courses, runs all 10 rules, and writes 5–10 surviving
`suggestions` rows to Supabase. Reviewers walk in the next morning,
hit `/suggestions/today`, and act on real agent output.

**Duration:** ~7–10 focused days. This is the biggest single phase.

**Acceptance — Phase 6 is done when:**

- `uv --directory engine run agent run --category "Data Privacy and Security" --top-k 5`
  completes in under 10 minutes on a developer machine.
- The run inserts one `agent_runs` row with `model_used`,
  `categories_targeted`, `candidates_produced`, `candidates_persisted`,
  `total_tokens_in`, `total_tokens_out`, `cost_usd`, and a
  `prompt_version_id` linking to an `active` row.
- 5–10 `suggestions` rows land with `status='pending_review'`,
  `run_id` matching the new run, all passing every rule.
- At least one raw candidate that *would have* used a certification
  name (e.g. "CIPP/E Certification Prep") was caught by Rule 10 and
  either renamed to a neutral title or dropped. The internal log
  shows the catch.
- Re-running on the same day re-uses the same `agent_runs` row only
  if `--resume <run_id>` is passed; otherwise a fresh run is opened.
- A reviewer signs in and sees the new candidates in
  `/suggestions/today` with the run's metadata in the header banner
  (model used + categories targeted). The Phase 5 approve/reject/
  needs-revision flow writes feedback rows against them.
- Cost ceiling enforced: if a run's projected `cost_usd` would
  exceed `ENGINE_RUN_COST_CEILING_USD` (default $5), the run aborts
  with a clear error before any persistence happens.
- `uv --directory engine run smoke` still 6/6 green.

---

## Where exactly we are coming in

Snapshot at start of Phase 6 work:

| Layer | State |
|---|---|
| Supabase schema (`agent_runs`, `suggestions`, `feedback`, etc.) | ✅ All eight Phase 6 columns on `agent_runs` already exist in migration 0001. No DB migration needed unless we discover one mid-build. |
| Courses + embeddings | ✅ 1,623 rows with Voyage `voyage-3-large` 1024-dim vectors. ivfflat index live. |
| Categories | ✅ 43 rows in `categories`; `categories_with_counts` view live. |
| `rejection_taxonomy` | ✅ 11 seed rows; reviewers actively use them. |
| `feedback` | ⚠️ Has the 3 rows Phase 5 verification wrote (approved / rejected / needs_revision). The agent's feedback-ingest node will read these. |
| Engine package | ⚠️ Has `config.py` (pydantic-settings), `supabase.py` (service-role client, `lru_cache`'d), `smoke_test.py` (Phase 2 wiring check), `embed_courses.py` (Phase 4 backfill). No agent nodes yet. |
| Existing dependencies | `httpx`, `pydantic-settings`, `supabase`. Need: `langgraph`, `scrapegraphai`, `rapidfuzz`, `numpy`, `tiktoken` (for cost estimation), `langfuse` (optional). |
| Phase 5 seed migration | ✅ Migration 0006 inserted 10 pending suggestions. Phase 6's first real run will produce a separate `agent_runs` row; the seed run (`model_used='seed-data'`) remains and can be filtered out of audit queries. |

Last known good commit on `main`: `6580b2b` ("Phase 5: review workflow
end-to-end").

### One-time housekeeping before Step 1

1. **Confirm your OpenRouter spend cap is set.** Phase 6 makes real
   LLM calls. Set a monthly cap on the OpenRouter dashboard and a
   per-day budget alert. The default `ENGINE_RUN_COST_CEILING_USD`
   in code is $5 per run, but the dashboard cap is the real backstop.
2. **Pick a primary model.** Phase 2/5 smoke uses
   `deepseek/deepseek-chat-v3.1`. Phase 6 keeps DeepSeek as the
   primary research model and uses a Haiku-tier model (e.g.
   `anthropic/claude-haiku-4-5-20251001`) for the cert-name LLM
   judge in Rule 10. Both routed through OpenRouter.
3. **Smoke check** before changing anything:
   ```powershell
   pnpm --dir "C:\Users\Vijay\Downloads\Course-Agent\app" smoke
   uv  --directory "C:\Users\Vijay\Downloads\Course-Agent\engine" run smoke
   ```
   App: 2/3 (known GAS issue). Engine: 6/6.

---

## Pre-flight — decisions to make before opening the editor

| Decision | Recommendation | Why |
|---|---|---|
| State-machine library | **LangGraph** | Build plan §Phase 6 calls it out. The graph in §4 of the architectural plan maps cleanly: `feedback_ingest → inventory_read → gap_analyze → for_each_category[research → rule_engine] → cross_batch_dedupe → persist → notify`. LangGraph's checkpointing makes `--resume <run_id>` a one-liner. |
| Research backend | **ScrapeGraphAI** (`SearchGraph` for discovery, `SmartScraperGraph` for ref verification) backed by **Serper** for search and **OpenRouter** for the in-graph LLM | Build plan §Phase 6 calls them out, and Phase 2 smoke already verifies both keys. ScrapeGraphAI handles the JS-rendered-emptiness fallback we'd otherwise have to hand-roll. |
| Embedding model | **Voyage `voyage-3-large`, 1024-dim** | Already in use for `courses.embedding`; Rule 2 and Rule 9's cosine probes need vectors in the same space. Re-using avoids a second embedding provider. |
| Fuzzy title match | **RapidFuzz** `token_set_ratio` | Cheap, deterministic, deliberate Python-only dep. Combined with cosine in Rule 2 the way the architectural plan §3.6 describes. |
| Cert-name LLM judge model | **`anthropic/claude-haiku-4-5-20251001`** via OpenRouter | Rule 10 layer (c). Cheap, fast, and good enough for a yes/no on a single title. Don't use the primary research model — keeps the cert check independent of the proposer. |
| Cost ceiling | **`ENGINE_RUN_COST_CEILING_USD` env var, default $5** | A circuit-breaker checked before persistence. Per-call token usage is summed; if projected > ceiling, the run aborts with a clear error and writes `agent_runs.finished_at` so the partial state is visible. |
| CLI entry point | **`uv --directory engine run agent ...`** wired via `pyproject.toml` scripts | Mirrors the existing `smoke` and `embed_courses` scripts. No global install needed. |
| Where the rule engine lives | **`engine/src/engine/rules/`** — one module per rule, plus a `dispatcher.py` that runs them in cost order | Keeps the 10 rules legible and testable in isolation. The dispatcher logs which rule killed each candidate so `agent_runs` summaries can show rejection-by-rule. |
| Where prompts live | **`engine/src/engine/prompts/`** — one file per role (`research_system.txt`, `cert_judge.txt`, `ref_verifier.txt`) loaded at startup | Versioned strings under git; Phase 8 adds the `prompt_versions` DB-driven swap. For Phase 6 we hard-code v1 and insert one `prompt_versions` row with `status='active'`. |
| Langfuse | **Optional, no-op if `LANGFUSE_PUBLIC_KEY` is empty** | Phase 9 makes it real. For Phase 6 we wrap every LLM call in a `with maybe_langfuse_span(...)` context manager that's a no-op when the key isn't set. |
| Logging | **stdlib `logging` with a UTC ISO formatter** + structured key=value lines for cost tracking | Phase 9 swaps for Sentry breadcrumbs. For Phase 6 we want grep-able stdout. |

If any of these change, the schema stays the same — only the code does.

---

## Step-by-step

Each step ends with a `verify:` line you can run before moving on.
Steps 1–3 are scaffolding; Steps 4–7 are the agent itself; Steps 8–10
wire the run end-to-end.

### Step 1 — Add dependencies + LangGraph skeleton

`pyproject.toml`:

```toml
dependencies = [
  "httpx>=0.28.1",
  "pydantic-settings>=2.14.1",
  "supabase>=2.30.0",
  "langgraph>=0.2",
  "scrapegraphai>=1.30",
  "rapidfuzz>=3.10",
  "numpy>=2.1",
  "tiktoken>=0.8",
  "langfuse>=2.50",   # optional but cheap to import
]

[project.scripts]
agent = "engine.cli:main"
# (smoke, embed_courses remain)
```

Create the package layout:

```
engine/src/engine/
├── agent/
│   ├── __init__.py
│   ├── graph.py          # LangGraph node graph
│   ├── state.py          # TypedDict shared state passed between nodes
│   └── nodes/
│       ├── __init__.py
│       ├── feedback_ingest.py
│       ├── inventory_read.py
│       ├── gap_analyze.py
│       ├── research.py
│       ├── rule_engine.py     # thin wrapper that calls dispatcher
│       ├── cross_batch_dedupe.py
│       └── persist.py
├── rules/
│   ├── __init__.py
│   ├── dispatcher.py
│   ├── rule_03_price.py
│   ├── rule_04_format.py
│   ├── rule_06_category.py
│   ├── rule_10_cert_name.py
│   ├── rule_07_references.py
│   ├── rule_02_existing_course.py
│   ├── rule_09_recent_rejection.py
│   ├── rule_01_intra_batch.py
│   └── rule_05_08_structural.py
├── llm/
│   ├── __init__.py
│   ├── openrouter.py     # the wrapper
│   └── voyage.py         # already partially in embed_courses; extract here
├── prompts/
│   ├── research_system.txt
│   ├── cert_judge.txt
│   └── ref_verifier.txt
├── cli.py                # `agent run`, `agent show <run_id>`
└── …existing files
```

For Step 1 every node is a stub that logs its own name and returns
the state unmodified. The graph wires them in the order the
architectural plan §4 calls out.

**verify:**
```powershell
uv --directory engine run agent run --dry-run --category "Data Privacy and Security" --top-k 5
# expect: each node logs once in order, no DB writes, exit 0
```

---

### Step 2 — Inventory reader

`agent/nodes/inventory_read.py` populates state with:

- All `categories` rows (incl. `target_count`, `demand_score`, `is_pinned`).
- All `courses` rows pre-joined to their embedding vector. Loaded
  once per run and held in memory (the full set is ~1,623 × 1024
  floats = ~13 MB — well within an in-process cache budget).
- A `numpy.ndarray` shape `(n_courses, 1024)` for batched cosine
  similarity in Rule 2.

**verify:**
```python
# in a uv repl
from engine.agent.nodes.inventory_read import load_inventory
inv = load_inventory()
assert inv.courses_matrix.shape == (1623, 1024)
assert len(inv.categories) == 43
```

---

### Step 3 — Gap analyzer

`agent/nodes/gap_analyze.py` ranks categories:

```
under_supply = max(0, (target_count or 50) - course_count)
score = under_supply * (demand_score or 1.0)
pinned categories get score += 1000      # always picked
```

Takes top-K from state (`--top-k` flag from CLI). If `--category X`
is passed, override the ranking with that single category.

**verify:**
```powershell
uv --directory engine run agent gap-analyze --top-k 5
# expect: prints 5 categories with their scores; pinned ones at top
```

---

### Step 4 — OpenRouter wrapper

`llm/openrouter.py`:

```python
class OpenRouterClient:
    def __init__(self, default_model: str): ...
    def complete(self, messages, *, model=None, max_tokens=2048,
                 temperature=0.3) -> Completion: ...
    # Completion has: text, tokens_in, tokens_out, cost_usd
```

Implementation notes:

- Uses the OpenRouter `/chat/completions` endpoint (same shape as
  the smoke test).
- Retry-with-backoff: 3 attempts at 1s/2s/4s for 429 + 5xx; raise
  on connection errors.
- Cost from the `usage` block in the response; OpenRouter returns
  USD per call directly. Fall back to a tiktoken-based estimate at
  $0 if `usage` is missing.
- Every call appends to a `RunCostLedger` held in graph state so the
  ceiling check has a single source of truth.
- Wrapped in `with maybe_langfuse_span("openrouter.complete", model=...)`
  which is a no-op when Langfuse keys are unset.

**verify:** unit-test by patching `httpx.post` with a stub response
that returns `usage: {prompt_tokens: 10, completion_tokens: 5}`; assert
the ledger picks it up.

---

### Step 5 — Research node (ScrapeGraphAI)

`agent/nodes/research.py`: for each targeted category, invoke
ScrapeGraphAI's `SearchGraph` configured to use the OpenRouter
client for LLM and Serper for search. Returns ~20 raw candidates
per category as JSON matching this schema:

```python
class RawCandidate(BaseModel):
    title: str
    rationale: str
    proposed_subcategory: str | None
    target_audience: str
    duration_days: int
    suggested_price_usd: int
    price_basis: str
    references: list[dict]   # {name, url}
```

The system prompt is loaded from `prompts/research_system.txt`.
It bakes in:

- The 10 rules as constraints the model should self-enforce.
- The category-specific guardrails Phase 8 will add; Phase 6
  hard-codes a single global guardrail set.
- 2–3 few-shot examples (positive + negative) — Phase 6's seed
  examples can come from the migration 0006 seed rows we already
  have.

**verify:**
```powershell
uv --directory engine run agent research --category "Data Privacy and Security" --raw-only
# expect: prints 15–25 candidates as JSON; no DB writes.
```

---

### Step 6 — Rule engine in cost order

`rules/dispatcher.py` runs rules in this exact order, short-circuiting
on the first failure:

| # | Rule | Module | Cost | Notes |
|---|------|--------|------|-------|
| 3 | `price > 2500` | `rule_03_price` | free | structural |
| 4 | `delivery_format='instructor-led'` | `rule_04_format` | free | structural |
| 6 | category exists in `categories` | `rule_06_category` | 1 DB lookup | FK pre-check (the DB FK is the backstop) |
| 10a | static cert blocklist | `rule_10_cert_name` | free | substring + regex |
| 10b | regex patterns | `rule_10_cert_name` | free | same module |
| 10c | LLM judge (Haiku) | `rule_10_cert_name` | ~$0.0001/call | only if 10a/b pass |
| 5/8 | structural (price_basis ≥ 2 sources, no region restriction) | `rule_05_08_structural` | free | |
| 7 | refs: each URL fetched via `SmartScraperGraph` | `rule_07_references` | ~$0.001/ref × 3 refs | expensive, run last among "must do" |
| 2 | cosine vs `courses.embedding` < 0.85 AND fuzzy < 90 | `rule_02_existing_course` | 1 embed + matrix multiply | uses inventory cache from Step 2 |
| 9 | cosine vs last 90 days of rejections < 0.82 | `rule_09_recent_rejection` | 1 embed + matrix multiply | reads from `suggestions` joined to `feedback` where decision='rejected' AND created_at >= now() - 90d |
| 1 | pairwise within current batch | `rule_01_intra_batch` | matrix multiply | runs after every other rule survives, in the `cross_batch_dedupe` node |

Each rule module exports a `check(candidate, ctx) -> RuleResult`
function where `RuleResult` is either `Pass` or `Fail(reason: str)`.
The dispatcher logs every rejection as
`run_id=… candidate=… rule=… reason=…` so post-run audits can show
which rule killed what.

**verify:** for each rule, write one unit test with a candidate that
passes and one that fails. `uv --directory engine run pytest` should
go green on all 20+ tests.

---

### Step 7 — Cert-name blocklist + LLM judge

`rules/rule_10_cert_name.py` does the three-layer check the
architectural plan §3.6 spells out:

- **Layer (a) — static blocklist.** Stored in
  `engine/src/engine/rules/data/cert_blocklist.txt`, one entry per
  line. Seed with the architectural plan's list: IAPP, ISACA, ISC2,
  PMI, AXELOS, SHRM, CIPD, ASQ, NEBOSH, IOSH, BSI, CIPP/E, CISSP,
  PMP, CISA, CRISC, ITIL, PRINCE2, SHRM-CP, etc. Case-insensitive
  substring match.
- **Layer (b) — regex.** Patterns: `^Certified `, ` Certification$`,
  ` Certificate$`, `Exam Prep`, ` Foundation$`, etc.
- **Layer (c) — Haiku LLM judge.** Prompt at `prompts/cert_judge.txt`:
  > Given the course title `{title}`, does it reference a specific
  > industry certification, credential acronym, or imply partnership
  > with a certifying body? Answer with exactly one word: yes or no.

  Run only if (a) and (b) both pass. Cached per-title within the run
  so repeated candidates don't re-call.

**The agent should not just drop cert-name candidates.** If layer (c)
flags it, prompt the research model once more with the catch as
context: *"Your candidate `{title}` was rejected for referencing a
certification. Propose a neutral title that captures the same body
of knowledge without naming the credential or certifying body."*
The renamed title goes back through layers (a)–(c). If it still
fails, drop the candidate.

**verify:** a test fixture with the title "CIPP/E Certification Prep"
must come out the other side as something like "European Data Privacy
& GDPR Compliance for Enterprise Teams" — exactly what the seed
migration 0006 used as suggestion #1.

---

### Step 8 — Cross-batch dedupe + persistence

`agent/nodes/cross_batch_dedupe.py`: applies Rule 1 (pairwise cosine
< 0.85 within surviving candidates). Iteratively drops the
lower-priced of any pair that crosses the threshold.

`agent/nodes/persist.py`:

1. Insert a `prompt_versions` row if one with `status='active'` doesn't
   already exist (Phase 6 hard-codes v1; Phase 8 adds versioning).
2. Insert the `agent_runs` row with `started_at = run.started_at`,
   `model_used`, `categories_targeted`, `candidates_produced`,
   `candidates_persisted`, token + cost totals from the
   `RunCostLedger`, `prompt_version_id`.
3. Embed each surviving candidate (Voyage) and insert into
   `suggestions` with `status='pending_review'`, `run_id=…`, and the
   `embedding` column populated so Rule 2 has something to compare
   against on future runs.
4. Update `agent_runs.finished_at`.

All three writes use the engine's service-role client so RLS doesn't
apply — that's deliberate.

**verify:**
```sql
select id, candidates_produced, candidates_persisted, total_tokens_in,
       total_tokens_out, cost_usd
from "course-agent".agent_runs where model_used <> 'seed-data'
order by started_at desc limit 1;

select count(*) from "course-agent".suggestions
where run_id = (select id from "course-agent".agent_runs
                where model_used <> 'seed-data'
                order by started_at desc limit 1);
-- expect: count >= 5
```

---

### Step 9 — CLI + Langfuse hooks + cost ceiling

`engine/cli.py` exposes `agent run`, `agent show <run_id>`,
`agent gap-analyze`, `agent research --raw-only`.

Cost ceiling enforced in the dispatcher: before running the
expensive Rule 7 references check on a candidate, the dispatcher
asks the `RunCostLedger` how much has been spent so far. If
`(spent_so_far + projected_call_cost) > ENGINE_RUN_COST_CEILING_USD`,
the run aborts with a `RunCostCeilingExceeded` exception, writes
`agent_runs.finished_at` with what's there, and exits non-zero.

Langfuse hooks (`maybe_langfuse_span`) wrap every LLM call. If the
key isn't set, they're no-ops. With the key set, every run becomes a
single trace in Langfuse with per-node spans.

**verify:**
- `uv --directory engine run agent show <run_id>` prints the run
  summary including cost.
- Set `ENGINE_RUN_COST_CEILING_USD=0.001` in `.env` and re-run; the
  agent should abort cleanly after the first LLM call.

---

### Step 10 — End-to-end manual run + acceptance

```powershell
uv --directory engine run agent run --category "Data Privacy and Security" --top-k 5
```

Should complete in <10 min and persist 5 suggestions. Then:

1. Open `/suggestions/today` in the app — the new candidates appear
   alongside the 7 surviving seed rows.
2. Approve one, reject another with tags. Confirm Phase 5's flow
   still works against a real agent run's output (no schema drift).
3. Run again with `--category "Cybersecurity" --top-k 5` and confirm
   the second `agent_runs` row gets its own `id` and the
   `/suggestions/today` page shows both runs' candidates.
4. Spot-check a candidate's `references` array — three URLs, each
   the `SmartScraperGraph` verification accepted.

---

## Acceptance verification

| Check | Method |
|---|---|
| Run completes in <10 min | timer |
| 5–10 candidates persisted from 1 category | SQL count |
| `agent_runs` cost columns populated | SQL select |
| At least one cert-name catch in the log | grep run output for `rule=rule_10_cert_name` |
| `/suggestions/today` shows the candidates with the new run's model name in the header banner | manual |
| Phase 5 approve/reject/needs-revision still works on the new rows | manual |
| Cost ceiling aborts a run if exceeded | manual with `ENGINE_RUN_COST_CEILING_USD=0.001` |
| Phase 4 + Phase 5 didn't regress | both smokes still green; `/inventory` still 1,623; `/categories` still 43 |
| Pytest suite green | `uv --directory engine run pytest` |

---

## Gotchas worth knowing in advance

- **ScrapeGraphAI is the wildcard.** Two failure modes you should
  expect: (a) the target site blocks the scrape outright — handle by
  retrying with a different user-agent and falling back to Serper +
  a plain `httpx.get` if it still fails; (b) the page is JS-rendered
  and returns near-empty HTML — surface this as a Rule 7 fail with
  reason `reference_unverifiable_js_only`, not a crash.

- **Cost control matters from run #1.** The first few tuning runs
  will be more expensive than steady-state. Always run with
  `--top-k 1 --max-candidates 5` first to sanity-check before
  letting the agent loose on `--top-k 10 --max-candidates 20`.
  Watch the OpenRouter dashboard, not just the in-process ledger.

- **Rule order is load-bearing.** A candidate that fails the free
  structural check should never trigger the $0.003 reference-scrape
  check. If you re-order rules during tuning, profile the run cost
  before and after.

- **Don't mock OpenRouter in unit tests for the rule engine.** Mock
  ScrapeGraphAI and the LLM judge at their wrapper boundary instead.
  Rule-engine unit tests should run in <2s with no network.

- **Voyage rate limits.** Embedding the run's surviving candidates
  for Rule 2 / Rule 9 / persistence means up to ~30 embed calls per
  run. Voyage's default rate limit is 300 RPM at the free tier;
  fine for now, but if Phase 7's daily scheduler ever runs 10
  categories × 20 candidates that's tight — bake in a 200ms sleep
  between embed batches.

- **The `prompt_versions` row needs a `system_prompt` text.** Don't
  forget to write the full string into the row, not just a path
  reference. The DB column is `text not null`. Loading from
  `prompts/research_system.txt` at startup and inserting the
  contents is the cleanest path.

- **`agent_runs.categories_targeted` is `text[] not null`.** A run
  with zero categories targeted is a bug — gap analyzer should
  always return at least one. If `--category X` is passed, the array
  is `['X']`, not `[]`.

- **Don't write to `suggestions.embedding` from the Server Actions
  in Phase 5.** Those are reviewer-facing and run with the anon key.
  The agent's service-role client owns that column.

- **LangGraph checkpointing for `--resume`.** Store the state
  checkpoint somewhere durable — sqlite file under `engine/.state/`
  is enough for now. Phase 7's scheduler can graduate this to
  Postgres once daily runs are stable.

---

## What's deliberately not in Phase 6

- **The daily scheduler.** Phase 7 — also brings the email digest
  and Slack pings.
- **Versioned prompt evolution + A/B testing.** Phase 8 — the
  `prompt_versions` table gets used for real.
- **Per-reviewer routing or assignment.** Phase 8.
- **Sentry / Langfuse production-grade integration.** Phase 9 — the
  hooks land in Phase 6, the dashboards land in Phase 9.
- **Multi-category parallel runs.** Phase 6's loop is sequential per
  category; parallelism is a Phase 9 perf concern.
- **Re-prompting on `needs_revision` notes.** Architectural plan
  §3.8(c) covers this as part of the feedback loop. Phase 8 wires
  it; Phase 6's feedback-ingest only consumes `rejected` rows for
  Rule 9 and the prompt's negative few-shots.

---

## Done means

- [ ] All dependencies added to `pyproject.toml`; `uv sync` clean.
- [ ] `engine/src/engine/agent/`, `engine/src/engine/rules/`,
      `engine/src/engine/llm/`, `engine/src/engine/prompts/` populated
      per the layout in Step 1.
- [ ] All 10 rules implemented with unit tests; `uv run pytest` green.
- [ ] `agent run --category X --top-k 5` produces 5–10 persisted
      suggestions in <10 min from a clean DB.
- [ ] `agent_runs` row populated with all 8 cost/usage columns and
      a real `prompt_version_id`.
- [ ] At least one cert-name catch demonstrably visible in the run log.
- [ ] Cost ceiling aborts the run when crossed; partial state is
      visible in `agent_runs.finished_at`.
- [ ] Phase 5's review workflow renders + actions correctly against
      the agent's real output.
- [ ] Engine smoke (`uv run smoke`) still 6/6 green.
- [ ] App smoke (`pnpm --dir app smoke`) unchanged (2/3 with known
      GAS issue).
- [ ] Committed on `main` as "Phase 6: agent pipeline end-to-end".

---

## When you resume

1. Open this file. Should still be on `main`.
2. Run both smokes to confirm Phases 4 + 5 didn't drift.
3. Confirm OpenRouter spend cap + daily budget alert in the dashboard.
4. Start at Step 1 (deps + skeleton). Each step has a verify line;
   if any verify fails, the step isn't done.

Last known good commit on `main`: see `git log --oneline -5`.

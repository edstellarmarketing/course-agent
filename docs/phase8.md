# Phase 8 — Closed Feedback Loop

Sister-doc to `phase2.md`, `phase3.md`, `phase5.md`, `phase6.md`,
`phase7.md`. The build plan says *what* Phase 8 produces and §3.8
of the architectural plan sketches the design; this doc walks the
work in the order it happens at a keyboard.

**Goal:** The agent gets measurably smarter every week. Rule 9
(negative memory) goes live against real embedded rejections,
research prompts grow per-category guardrails and few-shot examples
from recent reviewer decisions, prompt versions get A/B tested,
and the `/learning` admin shows reviewers the trend lines proving
it. Reviewers signing back in tomorrow shouldn't see "Bitcoin day
trading" if they rejected it yesterday with `topic_outdated`.

**Duration:** ~5-7 focused days. Dense — touches the engine, the
DB, the schema, the prompts, and a new admin page. Steps are
deliberately small so each one commits cleanly.

**Acceptance — Phase 8 is done when:**

- Reject a suggestion with tag `topic_outdated` and reason text
  "Bitcoin day trading is consumer-grade, not enterprise". The
  next `agent run` doesn't propose any similar candidate — Rule 9
  catches the near-duplicate vector. Confirmed by grepping the
  run log for `rule rejection rule=rule_09_recent_rejection`.
- Mark another suggestion **Needs revision** with note "pitch at
  CFOs, not engineering leaders". The next run targeting the same
  category produces a candidate whose audience is CFO-aligned (the
  note flowed into the research prompt as targeted re-prompt
  context).
- A `/learning` admin page renders:
  - 4-week approval-rate line chart, with the 7-day average
    annotated on top.
  - Rejection-tag distribution as a horizontal bar chart, with
    month-over-month deltas highlighted (declining tags = the
    agent is learning).
  - Prompt-version stack: rows with version, status (active /
    candidate / retired), approval rate, runs observed,
    promote/retire buttons.
  - **"Generate next prompt from feedback"** button that fires
    `scripts/regenerate_prompt.py` and creates a candidate row.
- Admins can promote a candidate prompt; the next run uses it;
  two runs later the win-rate metric updates. "Needs more data"
  state shows clearly when n < 10 decisions.
- `suggestions.embedding` is populated for every row from the
  last 90 days. The backfill is idempotent (re-running is safe).
- Rule 7's reference verifier no longer false-rejects well-known
  authoritative sources (NIST, Microsoft Zero Trust docs) —
  majority-vote across refs (at least 2 of 3 must be ``yes``/
  ``unsure``).
- Cert-name layer (c) flags fire a rename retry against the
  research model before dropping the candidate. The unit test
  that simulates a cert-named title goes green via the rename
  path, not the drop path.
- DB-backed reviewer recipients replace the hard-coded list in
  `app/src/lib/email/recipients.ts`. Phase 7's
  `DIGEST_RECIPIENTS_OVERRIDE` env still works for dev.
- `suggestions.assignee_id` column exists and is honoured by
  `/suggestions/today` (reviewer A only sees their own queue;
  admins see everything). Phase 5's race-safe Server Actions
  unchanged.
- All three smokes still green: `pnpm --dir app smoke` 3/3,
  `uv --directory engine run smoke` 6/6, `pytest` 28+/28+
  (new tests added per step).

---

## Where exactly we are coming in

Snapshot at start of Phase 8:

| Layer | State |
|---|---|
| `suggestions.embedding` | ⚠️ Populated only for rows persisted by Phase 6 onward (the 7 agent rows). Seed migration 0006's 10 rows and any human-rejected legacy rows have NULL embeddings. Step 1 backfills. |
| Rule 9 (recent rejection probe) | ⚠️ Implemented in Phase 6 but the matrix is always empty because feedback_ingest is a stub. Step 2 makes it real. |
| Few-shot examples | ❌ Not in the research prompt. Step 3. |
| Per-category guardrails | ❌ Not in the prompt. Step 4. |
| `needs_revision` notes | ⚠️ Stored in `feedback.reason_text` but the agent never reads them. Step 5. |
| `prompt_versions` table | ⚠️ Has 1 row from Phase 6's hard-coded v1 (`status='active'`). Versioning logic ignores it. Step 6 makes the engine read from it; Step 7 generates candidates. |
| `/learning` page | ⚠️ Phase 1 mock-data screen. Phase 5 left it untouched. Step 8 wires it to real DB. |
| Rule 7 verifier | ⚠️ Single-`no`-fails semantics; over-strict on authoritative sources (NIST, MS Zero Trust, finops.org docs). Step 9 introduces majority-vote. |
| Cert-name layer (c) | ⚠️ Drops cert-named candidates; doesn't attempt rename. Step 9 fixes. |
| Cert-judge model | ⚠️ Running on DeepSeek; should be on Haiku. Step 9 finds the right OpenRouter slug. |
| Reviewer recipients | ⚠️ Hard-coded array in `app/src/lib/email/recipients.ts`. Step 10 moves to DB. |
| `suggestions.assignee_id` | ❌ Column doesn't exist; Phase 5 deferred. Step 10 adds it. |

Last known good commit on `main`: `cf44ad3` (Phase 7).

### One-time housekeeping before Step 1

1. **Run all three smokes** to confirm Phase 7 didn't drift:
   ```powershell
   pnpm --dir "C:\Users\Vijay\Downloads\Course-Agent\app" smoke
   uv  --directory "C:\Users\Vijay\Downloads\Course-Agent\engine" run smoke
   pnpm --dir "C:\Users\Vijay\Downloads\Course-Agent\app" exec tsc --noEmit
   ```
   Expected: app 3/3, engine 6/6, no TS errors.

2. **Re-read Phase 6's "Phase 8 backlog" at the bottom of
   `docs/phase6.md`.** The 10 items there were promised to Phase
   8; this doc folds them into Steps 9-10. Cross-check before
   starting in case anything's been quietly closed since.

3. **Capture a baseline screenshot of `/learning`.** Phase 1's
   mock-data version will be replaced; saving the current render
   makes diffs reviewable.

4. **Confirm pgvector ANN index status.** Run in Supabase Studio:
   ```sql
   select indexrelid::regclass, indrelid::regclass, indexdef
   from pg_indexes
   where schemaname = 'course-agent' and indexname like '%embedding%';
   ```
   The `suggestions_embedding_ivfflat_idx` from migration 0001
   should be present. If it's gone (rare, but happens after dump/
   restore), recreate it before Step 1 — the backfill writes
   embeddings that the index will use.

---

## Pre-flight — decisions to make before opening the editor

| Decision | Recommendation | Why |
|---|---|---|
| Where the backfill runs | **One-shot Python script `engine/src/engine/scripts/backfill_suggestion_embeddings.py`** | Same shape as `embed_courses.py`. Idempotent (`embedding is null`). Triggered via `uv --directory engine run backfill_suggestions`. No DB migration needed. |
| Few-shot fetch | **Supabase SQL function `get_few_shot_examples(category_name, k)`** returning 5 approvals + 5 representative rejections (one per tag) | Architectural plan §3.8(b)(3) calls this out by name. Function pushes the SELECT/GROUP BY work to Postgres; the engine just consumes the JSON it returns. |
| Per-category guardrail storage | **JSON file `engine/src/engine/prompts/category_guardrails.json` keyed by category name** | Small lookup, version-controlled, easy to edit. Phase 9 can move to a DB table if it grows past 10-15 entries. |
| Re-prompting on needs_revision | **Re-queue the original candidate with the note as an injected user turn** before the standard category research call | Closer to architectural plan §3.8(c) than re-generating from scratch. Same JSON schema response, just one extra message in the conversation. |
| Prompt-versioning ownership | **`prompt_versions` table + a `read_active_prompt()` helper** in `engine.prompts` | Engine reads `status='active'` at run start. Admins promote via the `/learning` page using a Server Action that flips one row to `retired` and the candidate to `active`. |
| Candidate prompt generation | **Standalone script `engine/scripts/regenerate_prompt.py`** that calls a top-tier model (GPT-4o or Claude Sonnet) with current prompt + last week's rejection data | Manual trigger from `/learning` admin only. **Never auto-promote** in Phase 8 — admin must click to flip the status. |
| A/B selection | **At run start, if both `active` and `candidate` rows exist, alternate by run count (modulo)** | Deterministic, no random; reviewers can replay a run. Win-rate computed across `agent_runs.approval_rate` per `prompt_version_id`. |
| `/learning` page | **Server Components for the data + one Client Component for the regenerate button + promote action confirmations** | Mirrors `/categories` from Phase 4. Cheap, no new client-state library. |
| Rule 7 tuning | **Majority-vote: a candidate's refs survive if `yes`+`unsure` count >= ceil(2/3 * refs)`** | A single overly-strict LLM verdict no longer kills a credible candidate. The "no" rate per category becomes a tunable signal Phase 9 can graph. |
| Cert-judge model | **`anthropic/claude-haiku-4-5` (no date suffix)** — confirmed valid OpenRouter slug | Phase 6's `claude-haiku-4-5-20251001` was rejected. The bare slug is the correct one. |
| Recipients table | **New table `course-agent.digest_recipients` with `email`, `is_active`, `assigned_categories text[]` (nullable = receives all)** | Phase 5/7's `mockReviewers` shape graduates to real DB. RLS-protected, admin-write. |
| `suggestions.assignee_id` | **`uuid references auth.users(id) null`** + per-reviewer-RLS adjustment | NULL = unassigned, anyone can act (current Phase 5 behaviour). Setting a UUID = only that reviewer sees it in their queue. Admins see everything regardless. |

If any of these change, the schema mostly stays the same — only
the data shape inside JSON fields and the prompt strings do.

---

## Step-by-step

Each step ends with a `verify:` line.

### Step 1 — Backfill `suggestions.embedding`

`engine/src/engine/scripts/backfill_suggestion_embeddings.py`:

```python
"""Phase 8 Step 1 — populate suggestions.embedding for legacy rows.

Walks every row where embedding IS NULL, builds the same
{title}. {rationale} document text Rule 2 uses, embeds with
Voyage voyage-3-large in batches of 16, writes back via update
on id.

  uv --directory engine run backfill_suggestions

Idempotent. Cost estimate: ~$0.0001 per row × ~20 rows = trivial.
"""
```

Re-uses `engine.llm.voyage.embed_one`. Updates rows in batches
of ~50 with a single `.upsert` per batch.

**verify:**
```sql
-- Should return 0 once Step 1 is done.
select count(*) from "course-agent".suggestions where embedding is null;
```

---

### Step 2 — Real Rule 9 against the rejection matrix

Replace `feedback_ingest.py`'s stub with the real pull:

```python
def run(state):
    sb = supabase()
    cutoff_iso = (datetime.now(UTC) - timedelta(days=90)).isoformat()
    rows = (
        sb.table("feedback")
        .select("suggestion_id,decision,reason_tags,created_at,suggestions(embedding,title)")
        .eq("decision", "rejected")
        .gte("created_at", cutoff_iso)
        .execute()
        .data
    )
    # Build a parallel matrix from the embedded suggestion rows;
    # skip any row whose suggestion lacks an embedding (Phase 8
    # Step 1 should have backfilled these, but be defensive).
    vectors = [...]
    matrix = np.asarray(vectors, dtype=np.float32) if vectors else None
    return {
        "recent_rejections": rows,
        "_recent_rejection_matrix": matrix,
    }
```

The `rule_engine` node already threads `_recent_rejection_matrix`
into `RuleContext`. Rule 9's existing code path (`COSINE_THRESHOLD
= 0.82`) becomes live.

**verify:** reject a suggestion with `topic_outdated` and reason
"Bitcoin day trading is consumer-grade". Re-run `agent run
--category "Finance and Accounting" --top-k 1` and grep the run
log for `rule_09_recent_rejection`. Confirm at least one cosine
hit.

---

### Step 3 — Few-shot injection into the research prompt

Migration 0007 — `get_few_shot_examples(category_name text, k int)`:

```sql
create or replace function "course-agent".get_few_shot_examples(
  category_name text, k int default 5
)
returns table (kind text, title text, rationale text, tags text[], reason text)
language sql stable as $$
  -- Top-K most recent approvals in the category.
  ( select 'approval'::text as kind, s.title, s.rationale,
           array[]::text[] as tags, null::text as reason
    from "course-agent".suggestions s
    join "course-agent".feedback f on f.suggestion_id = s.id
    where s.category = category_name and f.decision = 'approved'
    order by f.created_at desc limit k )
  union all
  -- One representative rejection per tag, most recent.
  ( select distinct on (unnest_tag) 'rejection'::text, s.title, s.rationale,
           f.reason_tags as tags, f.reason_text as reason
    from "course-agent".suggestions s
    join "course-agent".feedback f on f.suggestion_id = s.id,
         unnest(f.reason_tags) as unnest_tag
    where s.category = category_name and f.decision = 'rejected'
    order by unnest_tag, f.created_at desc );
$$;
grant execute on function "course-agent".get_few_shot_examples(text, int)
  to authenticated, service_role;
```

The research node calls `sb.rpc("get_few_shot_examples", {...})`
per targeted category and inlines the returned rows into the
research prompt above the user turn.

**verify:** run `agent research --category "Cybersecurity"
--raw-only` with at least 3 approvals + 5 rejections recorded in
that category. Inspect the printed `system+user` prompt (turn on
`-v` verbose mode) — confirm both blocks present.

---

### Step 4 — Per-category guardrails

Create `engine/src/engine/prompts/category_guardrails.json`:

```json
{
  "Cybersecurity": {
    "trigger_tag": "not_instructor_led_market",
    "addendum": "In Cybersecurity, market evidence overwhelmingly shows self-paced certification prep; only propose courses where you can cite at least one real instructor-led offering from a non-cert provider (e.g. SANS, Chainguard Academy, vendor SE teams)."
  },
  "Data Analytics": {
    "trigger_tag": "too_niche",
    "addendum": "Data Analytics candidates in the past 90 days have been rejected for niche-tooling focus. Favour courses framed around discipline (semantic modelling, governance) over specific tools (dbt, Tableau)."
  }
}
```

At run start, count the dominant rejection tag per category from
the last 30 days. If the dominant tag matches the guardrail's
`trigger_tag`, append the `addendum` to that category's research
prompt.

**verify:** with synthetic feedback data, simulate Cybersecurity
having 4+ `not_instructor_led_market` rejections in the window;
re-run research; grep the printed prompt for the addendum.

---

### Step 5 — Re-prompting on `needs_revision`

Architectural plan §3.8(c). When a reviewer marks a candidate
needs-revision with a note, the agent's next run targeting that
category should:

1. Look up suggestions with `status='needs_revision'` and a
   feedback row from the last 24 hours.
2. For each, run a **focused retry**: a research call with the
   original candidate JSON + the reviewer note as targeted
   re-prompt context. Output schema same as a fresh candidate.
3. Persist the renamed candidate as a NEW suggestions row with
   a `parent_id` link (migration 0008 — adds the column) back to
   the original. Status stays `pending_review`; the original
   stays `needs_revision`.

This lives between `feedback_ingest` and `research`, or as the
first iteration of `research`. Either pattern works.

**verify:** mark one suggestion needs-revision with the note
"pitch at CFOs, not engineering leaders". Re-run on that category.
Confirm a NEW row exists with `parent_id` populated and a target
audience that includes CFOs.

---

### Step 6 — DB-driven prompt versioning

The `prompt_versions` table is live since Phase 6 (one row with
`status='active'`). Step 6 makes the engine consume it.

- `engine.prompts.read_active_prompt()` queries `prompt_versions`
  where `status='active'` order by `version desc limit 1`. Caches
  result for the run.
- `research.py` replaces its `files(...).read_text()` call with
  this lookup. The system prompt at runtime is whatever the DB
  says is active.
- `persist.py` writes `prompt_version_id` on the new `agent_runs`
  row (currently hard-coded; now reads from state).

A/B alternation logic (see pre-flight decision row): when a
`status='candidate'` row exists, the engine picks `active` or
`candidate` by `agent_runs.count(model_used=...) % 2`.

**verify:** insert a candidate prompt row manually. Run twice in
a row on the same category. First run's `prompt_version_id` =
active; second run's = candidate. Logged in the run summary.

---

### Step 7 — Candidate prompt generation script

`engine/scripts/regenerate_prompt.py` — calls a top-tier model
(`anthropic/claude-sonnet-4-6` or `openai/gpt-4o`) with:

- The current `status='active'` prompt text.
- The last 7 days of rejections + reasons, fetched from `feedback`
  joined to `suggestions`.
- A meta-prompt: *"Read the rejection patterns. Propose a revised
  system prompt that would have avoided most of these without
  reducing the volume of valid candidates. Output the full new
  prompt, no commentary."*

Saves the result as a new `prompt_versions` row with
`status='candidate'`, `version = active.version + 1`. **Never
auto-promote**; admins promote via `/learning` (Step 8).

**verify:**
```powershell
uv --directory engine run regenerate_prompt
```
Returns the new candidate row's id. SQL spot-check:
```sql
select id, version, status, length(system_prompt) as prompt_chars
from "course-agent".prompt_versions order by version desc limit 3;
```

---

### Step 8 — `/learning` admin page

Replace `app/src/app/(app)/learning/page.tsx` mock data with real
queries. Server Component fetches in parallel:

- **Approval-rate trend** — 28 days of feedback grouped by date,
  rendered as a simple SVG sparkline or static line chart (`<svg>`
  inline, no chart library — keeps the bundle slim).
- **Rejection-tag distribution** — `count(*) group by reason_tag`
  for the last 30 days vs the prior 30; deltas highlighted red
  (going up) / green (going down).
- **Prompt-version stack** — every row from `prompt_versions` with
  status, approval rate computed from `agent_runs` linked rows,
  runs observed. Promote / retire buttons call Server Actions
  that flip statuses.
- **"Generate next prompt from feedback"** — Client Component
  button that POSTs to `/api/admin/regenerate-prompt` which
  shells out to the engine's `regenerate_prompt` script (or
  re-implements the same logic in Node — Phase 8 picks one).

Admin-only — the existing `proxy.ts` already gates `/learning`
to `app_metadata.course_agent_role === "admin"`.

**verify:** sign in as admin, open `/learning`. Approval rate
trend shows last 4 weeks. Rejection tag distribution shows top
3-5 tags. Prompt version stack lists 2 rows (v1 active, v2
candidate from Step 7). Promote v2 → v1 status flips to `retired`,
v2 becomes `active`. Next `agent run`'s `prompt_version_id`
matches v2's id.

---

### Step 9 — Phase 6 backlog cleanup

Three sub-tasks, all small:

**9a — Rule 7 majority-vote.** Update `rule_07_references.py`
to track yes/no/unsure counts. Fail only when `no >=
ceil(len(refs) / 2)`. Update unit test fixtures.

**9b — Cert-name rename loop.** On layer (c) flag, call the
research model once with the renaming prompt from `phase6.md`
Step 7 spec, re-run layers a-c on the new title. If it still
fails, drop. Update `rule_10_cert_name.py`.

**9c — Cert-judge model upgrade.** Change `RuleContext`'s default
`cert_judge_model` to `anthropic/claude-haiku-4-5` (confirmed
slug). Verify with one live cert-named fixture run that the
judge call succeeds.

Add a deliberate-cert-name regression test:

```python
# tests/test_rule_10_layer_c.py
def test_layer_c_flags_haiku_judge(monkeypatch):
    # Mock the OpenRouter call to return "yes" for the title.
    # Confirm rule_10_cert_name.check returns Fail("cert llm judge flagged")
```

**verify:**
- `pytest` 30+/30+ green.
- Manual: run with a deliberately weakened system prompt that
  allows cert names; confirm Rule 10 rename loop fires and
  produces a renamed candidate.

---

### Step 10 — DB-backed recipients + `suggestions.assignee_id`

Two pieces, both DB-shaped:

**10a — `digest_recipients` table.** Migration 0009:

```sql
create table "course-agent".digest_recipients (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  is_active    boolean default true,
  assigned_categories text[],  -- null = all categories
  created_at   timestamptz default now()
);
alter table "course-agent".digest_recipients enable row level security;
alter table "course-agent".digest_recipients force row level security;

create policy digest_recipients_admin_all on "course-agent".digest_recipients
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());

insert into "course-agent".digest_recipients (email)
  values ('marketing@edstellar.com');
```

`app/src/lib/email/recipients.ts` swaps from static array to a
service-role-client query. `DIGEST_RECIPIENTS_OVERRIDE` env var
still takes precedence for dev.

**10b — `suggestions.assignee_id`.** Migration 0010:

```sql
alter table "course-agent".suggestions
  add column assignee_id uuid references auth.users(id);
create index suggestions_assignee_idx on "course-agent".suggestions(assignee_id);

-- Reviewer-update policy: reviewers can act on rows assigned to
-- them OR rows with no assignee. Admins can act on anything.
drop policy if exists suggestions_reviewer_update on "course-agent".suggestions;
create policy suggestions_reviewer_update on "course-agent".suggestions
  for update to authenticated
  using (
    "course-agent".is_admin()
    OR assignee_id is null
    OR assignee_id = auth.uid()
  )
  with check (status in ('approved', 'rejected', 'needs_revision'));
```

`/suggestions/today` SELECT becomes:

```typescript
.or(`assignee_id.is.null,assignee_id.eq.${userId}`)
```

(Admins skip the filter.)

**verify:** add a second user as reviewer (non-admin). Assign 3
of the pending suggestions to them via SQL. Sign in as that user
→ `/suggestions/today` shows 3 cards + the unassigned ones. Sign
in as admin → see everything.

---

## Acceptance verification

| Check | Method |
|---|---|
| Bitcoin day-trading rejection blocks similar next-run candidate | manual two-day flow |
| `/learning` approval-rate trend renders 28 days | open page |
| `/learning` rejection-tag distribution renders + deltas | open page |
| Prompt-version stack lists active + candidate; promote works | click promote, verify next run uses new prompt |
| `regenerate_prompt` script inserts a candidate row | SQL select on `prompt_versions` |
| `suggestions.embedding` populated for all rows | `select count(*) where embedding is null` = 0 |
| Rule 7 no longer false-rejects NIST/finops.org | grep run log; confirm no `rule_07` rejections on known-good refs |
| Cert-name rename loop salvages at least one candidate in test | run with weakened prompt; observe rename log line |
| DB-backed recipients used by digest send | sign in as admin, add a second email row, run agent, both inboxes receive |
| `assignee_id` filtering per reviewer works | manual two-account test |
| All three smokes still green | `pnpm smoke`, `uv run smoke`, `tsc --noEmit` |
| pytest >= 30 tests pass | `uv run pytest` |

---

## Gotchas worth knowing in advance

- **90 days of rejections will eventually be hundreds of vectors.**
  The existing `suggestions_embedding_ivfflat_idx` from migration
  0001 covers this. Don't switch Rule 9 to exact-scan even when
  the matrix is small in early Phase 8 — keep the IVFFlat path
  warm so it stays fast at scale.

- **A/B sample size honesty.** Two runs of 5 candidates each (10
  decisions total) is not statistically meaningful. The `/learning`
  prompt-version stack MUST show a "needs more data (n < 20)"
  state instead of fake win-rates. Reviewers WILL act on the
  number if you show one — be careful.

- **Don't auto-promote prompt versions.** Phase 8 keeps promotion
  manual (admin clicks the button). Auto-promotion is a Phase 9
  feature *after* a month of manual data confirms the score is
  meaningful.

- **`get_few_shot_examples` is a stable SQL function, not
  immutable.** Stable means it can run inside a transaction
  but the planner can't memoize across calls. Don't add
  `immutable` to its signature — joins to time-windowed data
  break.

- **Embeddings backfill in batches.** `embed_one` is one-row-per-
  call; for ~20 backfill rows it's fine, but if Phase 8 ever
  re-runs against a longer window, batch the Voyage requests
  (the API accepts up to 128 inputs per call) to keep round-trips
  down.

- **Rename loop infinite recursion guard.** Layer (c) calls
  research model → rename → re-run layers a-c → which can flag
  again. Cap at ONE rename retry. If the rename also fails any
  layer, drop. The unit test in 9b should cover both paths.

- **`/learning` regenerate button is an admin nuke.** Inserting a
  new prompt-versions row affects every future run. Add a confirm
  dialog ("This will create a candidate prompt v{n+1}. Continue?")
  so a stray click doesn't mint orphan candidates.

- **`assignee_id is null OR = auth.uid()`** — be careful with the
  OR semantics inside RLS. Postgres short-circuits left-to-right
  but RLS policies are evaluated as `using ()` predicates, which
  cosmic-ray-style get rewritten by the planner. Test with both
  null and non-null cases before declaring 10b done.

- **Migration ordering matters.** Phase 8 introduces migrations
  0007 (function), 0008 (parent_id), 0009 (recipients), 0010
  (assignee_id). Apply in that order in Supabase Studio. The
  `0007_` filename leading is the source of truth for ordering.

- **`prompt_versions.system_prompt` is `text not null`.** The
  regenerate script must write the FULL string, not a file path.
  Phase 6's existing row is the contract — see Step 6 there.

---

## What's deliberately not in Phase 8

- **Daily / nightly scheduler.** Phase 7 + the manual CLI is
  enough; Phase 9 wires Prefect or GitHub Actions.
- **Sentry plumbing.** Phase 9.
- **Langfuse production dashboards.** Phase 9 — the no-op hook
  has been in place since Phase 6.
- **Multi-category parallel runs.** The LangGraph `Send` fan-out
  for parallel research belongs to Phase 9 once we have a real
  perf budget.
- **Auto-promotion of prompt versions.** Phase 9, only after a
  month of manual promote-vs-data validates the metric.
- **Per-reviewer-personalised digest contents.** Phase 8 routes
  by `assignee_id`, but everyone gets the same email body. Phase
  9 may add "your queue" filtering.

---

## Done means

- [ ] Migration 0007 (`get_few_shot_examples`) applied.
- [ ] Migration 0008 (`suggestions.parent_id`) applied.
- [ ] Migration 0009 (`digest_recipients`) applied.
- [ ] Migration 0010 (`suggestions.assignee_id`) applied.
- [ ] `backfill_suggestion_embeddings.py` runs; `select count(*)
      from suggestions where embedding is null` = 0.
- [ ] feedback_ingest pulls 90-day rejection matrix; Rule 9
      catches a planted near-duplicate.
- [ ] Few-shot rows inlined into research prompt; spot-checked
      via `agent research --raw-only -v`.
- [ ] Per-category guardrail adds the addendum when the dominant
      rejection tag matches.
- [ ] `needs_revision` notes flow into a focused retry; new row
      links via `parent_id`.
- [ ] `prompt_versions` drives the system prompt at runtime; A/B
      alternation works.
- [ ] `regenerate_prompt.py` inserts a candidate row.
- [ ] `/learning` page shows trends, rejection distribution,
      prompt stack, regenerate button.
- [ ] Admin promote/retire updates `prompt_versions.status`.
- [ ] Rule 7 majority-vote stops false-rejecting authoritative
      sources.
- [ ] Cert-name rename loop salvages candidates.
- [ ] Haiku slug (`anthropic/claude-haiku-4-5`) confirmed and used.
- [ ] DB-backed recipients replace the static array.
- [ ] `suggestions.assignee_id` filters per-reviewer queue.
- [ ] All three smokes still green; pytest 30+/30+ green.
- [ ] Committed on `main` as "Phase 8: closed feedback loop".

---

## When you resume — for Phase 9

1. Open `docs/phase9.md` (not written yet — start it the way
   `phase5.md` / `phase6.md` / `phase7.md` / this doc were
   structured before opening the editor).
2. Run all three smokes to confirm Phase 8 didn't drift.
3. Phase 9 brings: Sentry + Langfuse plumbing for real, daily
   scheduler (Prefect or GitHub Actions), auto-promotion of
   prompt versions once the A/B metric is trusted, parallel
   per-category research via LangGraph `Send`, basic backup +
   restore runbook. ~3-5 days. The doc itself ships the system
   "production-ready" per the build plan's Phase 9 framing.

Last known good commit on `main`: see `git log --oneline -10`.

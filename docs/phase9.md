# Phase 9 — Observability + Hardening

Sister-doc to `phase2.md`, `phase3.md`, `phase5.md`, `phase6.md`,
`phase7.md`, `phase8.md`. The build plan calls this *"the
production-ready phase: traced, monitored, alerted, backed up,
documented"*. This doc walks the work in the order it happens at
a keyboard.

**Goal:** the agent runs without anyone watching it and we still
know when something breaks. Every LLM call shows up in Langfuse as
part of a trace tree. Unhandled errors land in Sentry with the
right tags. A daily scheduler triggers `agent run` at 03:00 UTC
without a human. Three monitoring alerts fire on the three
failure modes that actually matter. A new team member can read
the runbook and bring the system back from a torched DB.

**Duration:** ~3-5 focused days. The surface is wide (two apps,
two SDKs, scheduler + alerts + backups + a runbook) but each
step is short.

**Acceptance — Phase 9 is done when:**

- A deliberately thrown error inside a Server Action lands in
  Sentry with the user_id + the requested path attached. The same
  for an exception raised inside an engine node — Sentry shows the
  run_id + node name.
- Every recent agent run shows up in Langfuse with one trace per
  run, per-node spans, OpenRouter calls nested underneath, and
  cost-per-prompt-version attribution working in the dashboard.
- The daily scheduler is wired: `cron`-style trigger at 03:00 UTC
  Mon-Sat (no Sunday digest by design) executes
  `agent run --top-k 5 --max-candidates 12` against the staging DB.
  Confirmed by a real automated run.
- Three monitoring alerts fire on their intended triggers:
  1. Daily run hasn't completed by 06:00 UTC → Slack #alerts ping.
  2. 7-day approval rate drops >10 percentage points vs the prior
     7-day window → Slack.
  3. OpenRouter 24-hour spend exceeds `OPENROUTER_DAILY_CEILING_USD`
     (default $10) → Slack.
- An `audit_log` table records every admin action: pin/unpin
  category, promote/retire prompt, add digest recipient, edit
  course inventory. Reviewer actions DO NOT — they already land
  in `feedback`.
- Top-k > 1 runs use LangGraph `Send` for parallel per-category
  research. A 5-category run completes in roughly the time of a
  single-category run plus a small constant (proves the fan-out is
  real, not sequential).
- A documented restore drill: spin up a sibling Supabase from
  yesterday's logical backup, confirm row counts match, confirm a
  reviewer can sign in and act on a suggestion against the restore.
  The runbook entry tells someone else how to do it next time.
- A fresh team member (or a one-hour-from-now you) can read
  `docs/runbook.md` and trigger a manual agent run + interpret the
  log + roll back a bad prompt promotion without help.
- All three smokes still green; pytest count holds or grows.

---

## Where exactly we are coming in

Snapshot at start of Phase 9 work:

| Layer | State |
|---|---|
| Sentry | ❌ Both `.env` files have `SENTRY_DSN=` (empty). Smoke tests skip Sentry as "optional". Phase 9 makes it real on both sides. |
| Langfuse | ⚠️ `engine.llm.langfuse_hook.maybe_langfuse_span()` is in place since Phase 6, but the API probing has been silently no-op'ing because the 4.x SDK's span method names didn't match the probes. Phase 9 picks the canonical Langfuse-4.x API, pins the SDK version, and validates a trace lands. |
| Scheduler | ❌ Every agent run today is manual `uv run agent run`. Phase 9 picks Prefect / GitHub Actions / pg_cron and wires the first scheduled trigger. |
| Parallel research | ⚠️ `agent/nodes/research.py` loops categories sequentially. With `top-k=5` that's 5× the latency of a single-category run. Phase 9 swaps the loop for LangGraph `Send` fan-out. |
| Audit log | ❌ Admin actions (promote prompt, pin category, edit course) write to their target tables but leave no audit trail. Phase 9 adds a `course-agent.audit_log` table and writes from every admin Server Action. |
| Monitoring alerts | ❌ Phase 7's GAS digest goes out but nobody pings Slack if it DOESN'T. Phase 9 adds the three alerts. |
| Backup | ⚠️ Self-hosted Supabase on Coolify. Probably backed up at the disk level but no documented logical backup of just `course-agent`. Phase 9 documents + drills. |
| Runbook | ❌ `docs/` has phase plans but no operational runbook. Phase 9 ships `docs/runbook.md`. |
| Cost ceiling | ✅ Per-run circuit-breaker exists since Phase 6 (`ENGINE_RUN_COST_CEILING_USD`, default $5). Phase 9 adds a daily-rolling ceiling alert on top — different signal: per-run protects one run, daily catches a cron loop run amok. |
| Auto-promote prompts | ❌ Phase 8 deliberately punted this. Phase 9 implements it behind a feature flag — never enable in the first month. |

Last known good commit on `main`: `9625364` (Phase 8 finale).

### One-time housekeeping before Step 1

1. **Run all three smokes** to confirm Phase 8 didn't drift:
   ```powershell
   pnpm --dir "C:\Users\Vijay\Downloads\Course-Agent\app" smoke
   uv  --directory "C:\Users\Vijay\Downloads\Course-Agent\engine" run smoke
   pnpm --dir "C:\Users\Vijay\Downloads\Course-Agent\app" exec tsc --noEmit
   ```

2. **Confirm Sentry account + DSNs ready.** Create two Sentry
   projects in the Edstellar org: `course-agent-app` (Next.js,
   JavaScript SDK) and `course-agent-engine` (Python). Grab both
   DSNs.

3. **Confirm Langfuse credentials work.** They've been in
   `engine/.env` since Phase 5; visit the Langfuse dashboard once
   and confirm you can sign in to the project the keys belong to.
   The pre-flight matters because Step 2 will hit the live API.

4. **Pick a scheduler** before Step 3. The three viable options
   are in the pre-flight table; commit to one before writing code
   so Step 3 doesn't loop.

5. **Snapshot the current rejection-tag distribution** — useful
   baseline for the monitoring alert that watches approval rate.
   ```sql
   select decision, count(*) from "course-agent".feedback
   where created_at >= now() - interval '14 days'
   group by decision;
   ```

---

## Pre-flight — decisions to make before opening the editor

| Decision | Recommendation | Why |
|---|---|---|
| Sentry SDK (app) | **`@sentry/nextjs`** | First-party Next.js integration. Handles Server Components, Server Actions, Edge runtime, and the browser bundle from one install. The community alternatives are a tax for no benefit. |
| Sentry SDK (engine) | **`sentry-sdk[fastapi]`** (or plain `sentry-sdk`) | Captures unhandled exceptions automatically. Integrate with `httpx` so failed OpenRouter / Voyage / Serper calls get breadcrumbs. |
| Langfuse SDK version | **Pin to `langfuse>=4.6,<5`** | Phase 6 floor was `>=2.50`; the actual installed 4.6.1 was what we developed against. Pin so the API surface stops drifting under us. The `start_as_current_observation` method on the 4.x client is what we'll actually use. |
| Scheduler | **GitHub Actions Cron** for Phase 9, with a note that Phase 10 (out of scope) can graduate to Prefect if multi-step orchestration arrives | Costs $0 on Edstellar's GitHub org, runs in a clean ubuntu-latest container, secrets management built-in, logs visible in the repo. Prefect/Cloud is overkill for one daily script. `pg_cron` (Supabase native) can't shell out to Python — wrong tool. |
| Audit log shape | **`course-agent.audit_log(id, actor_id, action, target_type, target_id, payload jsonb, created_at)`** | Schemaless `payload` keeps the table tolerant of future event types. Six fields is the right amount of metadata; more is YAGNI. |
| Audit-log write path | **Server-side helper `logAdminAction(...)` called from inside the existing Server Actions**; engine writes go through the service-role client | Triggers are tempting but invisible in code review. An explicit helper call is easier to verify when a future engineer touches `actions.ts`. |
| Alert delivery | **Reuse `SLACK_WEBHOOK_URL` from Phase 7**; add an `ALERTS_SLACK_WEBHOOK_URL` override if alerts should go to a different channel | Smallest surface. If the team later wants email-too, the alert-fire helper can be extended; not before. |
| Daily-run-missing check | **GitHub Actions Cron at 06:15 UTC** runs a tiny `check-daily-run.py` that queries `agent_runs` for a row with `started_at > today 03:00 UTC` and pings Slack if not. | Same scheduler as the actual run. Cron-on-cron is the simplest "did the cron fire" pattern. |
| Approval-rate drop check | **GitHub Actions Cron, weekly Mon 08:00 UTC** | Daily would noise out. Weekly week-over-week comparison is the right granularity. |
| Spend-threshold check | **GitHub Actions Cron daily 23:55 UTC** sums today's `agent_runs.cost_usd` | Reads what we already write; no new instrumentation needed. |
| Auto-promote prompt versions | **Feature flag `PROMPT_AUTO_PROMOTE_ENABLED=false` by default**, plus a `MIN_PROMOTE_DECISIONS=20` floor and a `MIN_PROMOTE_DELTA=0.05` (5pp absolute) | The build plan and `phase8.md` both call out that auto-promote without a month of manual data is dangerous. Phase 9 ships the mechanism behind a flag; the team turns it on later. |
| Parallel research | **LangGraph `Send` from `gap_analyze` into a sub-graph that fans out to N copies of the research node**, then merges back into a single `raw_candidates` list | Native LangGraph pattern; doesn't require threading custom asyncio. The `_or_client` + `_ledger` stay shared so cost tracking is correct. |
| Backup strategy | **`pg_dump --schema='course-agent'` daily via GitHub Actions, retained 30 days in a private R2/S3 bucket** | The Supabase self-host already has volume snapshots, but a schema-scoped logical backup is faster to restore selectively and trivial to drill. |
| Runbook location | **`docs/runbook.md`** — single file, search-friendly | Easier than `docs/runbook/*.md` per topic for a v1; can split if it grows past ~500 lines. |

If any of these change, mostly only the implementation changes —
the table above is the contract.

---

## Step-by-step

Each step ends with a `verify:` line.

### Step 1 — Sentry plumbing on both sides

App side (`@sentry/nextjs`):

```powershell
pnpm --dir app add @sentry/nextjs
pnpm --dir app exec sentry-wizard -i nextjs
```

The wizard creates `sentry.{server,client,edge}.config.ts` and
adds the build-time uploader. After it finishes:

- Set `SENTRY_DSN` in `app/.env.local` to the project DSN.
- Add `SENTRY_AUTH_TOKEN` (org-level, set in CI only — not in
  `.env.local`).
- In each Server Action that catches `{ok:false, ...}`, optionally
  call `Sentry.captureMessage("action failed", { extra: ... })` so
  business-logic failures show up as breadcrumbs even when
  technically they didn't throw.

Engine side (`sentry-sdk`):

```toml
# pyproject.toml
"sentry-sdk[httpx]>=2.20",
```

```python
# engine/src/engine/sentry.py — new module
def init_sentry() -> None:
    cfg = settings()
    if not cfg.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=cfg.sentry_dsn,
        traces_sample_rate=0.1,
        send_default_pii=False,
        integrations=[sentry_sdk.integrations.httpx.HttpxIntegration()],
    )
```

Call `init_sentry()` once at CLI boot, just before `_setup_logging`.
Inside each node's exception path, wrap the `log.warning` calls so
Sentry sees them — they're benign failures by design but the
absence of any signal would be worse than the noise.

**verify:** add a temporary `raise RuntimeError("phase9 sentry probe")`
inside the research node; run agent. Sentry shows the exception
with run_id breadcrumb. Remove the probe + re-commit.

---

### Step 2 — Real Langfuse traces

The Phase 6 hook (`engine/src/engine/llm/langfuse_hook.py`) was
defensive about SDK shape — Phase 9 commits to a specific API and
validates it lands.

Pin in `pyproject.toml`: `"langfuse>=4.6,<5"`.

Replace the probe-and-shrug logic with one shape:

```python
@contextlib.contextmanager
def maybe_langfuse_span(name, **attrs):
    if not langfuse_configured(): yield; return
    client = _get_client()
    with client.start_as_current_observation(name=name, metadata=attrs) as obs:
        yield obs
```

Add a top-level trace from `cli.py`'s `_cmd_run`:

```python
with maybe_langfuse_trace(name="agent.run", run_id=...):
    final_state = graph.invoke(initial)
client.flush()  # important — otherwise spans drop on exit
```

The `client.flush()` is what Phase 6 was missing. Without it the
process exits before Langfuse's background thread sends.

**verify:** run any agent against staging; visit Langfuse
dashboard. Confirm:
- One trace per run, named `agent.run`
- Per-node spans nested underneath (`feedback_ingest`,
  `research`, `rule_engine`, etc.)
- OpenRouter completions as leaves with token counts + cost
- Cost-attribution-by-metadata pivot shows
  per-prompt-version totals

---

### Step 3 — Daily scheduler (GitHub Actions Cron)

`.github/workflows/agent-daily.yml`:

```yaml
name: agent-daily
on:
  schedule:
    - cron: "0 3 * * 1-6"   # 03:00 UTC Mon-Sat
  workflow_dispatch:        # manual trigger button
jobs:
  run:
    runs-on: ubuntu-latest
    environment: agent-production
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv --directory engine sync
      - env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}
          SERPER_API_KEY: ${{ secrets.SERPER_API_KEY }}
          LANGFUSE_PUBLIC_KEY: ${{ secrets.LANGFUSE_PUBLIC_KEY }}
          LANGFUSE_SECRET_KEY: ${{ secrets.LANGFUSE_SECRET_KEY }}
          INTERNAL_WEBHOOK_URL: ${{ secrets.INTERNAL_WEBHOOK_URL }}
          INTERNAL_WEBHOOK_SECRET: ${{ secrets.INTERNAL_WEBHOOK_SECRET }}
          SENTRY_DSN: ${{ secrets.SENTRY_DSN_ENGINE }}
        run: uv --directory engine run agent run --top-k 5 --max-candidates 12
```

Add an `environment: agent-production` so secrets are scoped + the
GH UI has a clear toggle to disable nightly runs without deleting
the workflow.

**verify:**
- `gh workflow run agent-daily.yml` from a dev machine triggers a
  successful run that lands in `agent_runs`.
- Schedule fires at 03:00 UTC the next day (or trigger-and-wait).
- The Phase 7 digest delivers within 30s of completion.

---

### Step 4 — Parallel per-category research via LangGraph `Send`

Today `research.run()` iterates `targeted_categories` sequentially.
Each category is ~30-90s. With `top-k=5` that's 2.5-7.5 minutes.
LangGraph's `Send` fan-out lets each category run as its own
graph branch.

Pattern from the LangGraph 1.x docs:

```python
from langgraph.types import Send

def fan_out(state):
    return [
        Send("research_one", {"category": c, "_or_client": state["_or_client"], "_ledger": state["_ledger"]})
        for c in state["targeted_categories"]
    ]

# Conditional edge from gap_analyze → either research_one (per-category)
# → merge_research → rule_engine.
```

The reducer for `raw_candidates` becomes additive (a custom
annotated reducer) so multiple branches' outputs concatenate.

**verify:** `agent run --top-k 5 --max-candidates 8` completes in
≤ 1.5× the time of a single-category run. Profile both before
the change (~7 minutes for 5 categories) and after (~2 minutes)
and record both in the commit message.

---

### Step 5 — Audit-log table + admin write paths

Migration 0011:

```sql
create table "course-agent".audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users(id),
  action      text not null,
  target_type text not null,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz default now()
);
create index audit_log_actor_idx     on "course-agent".audit_log (actor_id);
create index audit_log_action_idx    on "course-agent".audit_log (action);
create index audit_log_created_idx   on "course-agent".audit_log (created_at desc);

-- RLS: read-everyone, write-service-role-only (admins write via
-- Server Actions that use the session client; we wrap each call
-- to also fire a logAdminAction via service-role).
alter table "course-agent".audit_log enable row level security;
alter table "course-agent".audit_log force  row level security;

create policy audit_log_select on "course-agent".audit_log
  for select to authenticated using (true);
-- No insert/update policy → only service_role writes.
```

App side helper `app/src/lib/audit.ts`:

```typescript
export async function logAdminAction(args: {
  action: string;       // "prompt.promote" | "category.pin" | etc.
  targetType: string;   // "prompt_versions" | "categories" | ...
  targetId: string;
  payload?: Record<string, unknown>;
}) {
  const supabase = createAdminClient();
  const profile = await getCurrentReviewer();
  if (!profile) return;
  await supabase.from("audit_log").insert({
    actor_id: profile.id, ...args, payload: args.payload ?? {}
  });
}
```

Wire into:
- `categories/actions.ts` upsertCategory → `category.upsert`
- `learning/actions.ts` promotePromptVersion → `prompt.promote`
- `learning/actions.ts` retirePromptVersion → `prompt.retire`
- Any future digest-recipient writes when Phase 10 ships the
  `/settings` admin UI

**verify:** promote a prompt from `/learning`; check
`select * from "course-agent".audit_log order by created_at desc limit 5;`
— the row exists with the right actor_id + payload.

---

### Step 6 — Three monitoring alerts

`engine/src/engine/scripts/check_daily_run.py`:

```python
def main():
    # Did agent_runs.started_at land after today 03:00 UTC?
    # If not, ping Slack.
```

`.github/workflows/alert-daily-missing.yml` at 06:15 UTC. Same
shape as Step 3.

Approval-rate drop and spend-threshold scripts follow the same
pattern. All three share a tiny `_alerts.py` module:

```python
def slack_alert(text: str) -> None:
    cfg = settings()
    url = cfg.alerts_slack_webhook_url or cfg.slack_webhook_url
    if not url: return
    httpx.post(str(url), json={"text": text}, timeout=5.0)
```

**verify:**
- Manually run `check_daily_run.py` against a day with no run →
  Slack pings.
- Manually run with a fake spend threshold of $0.001 → Slack
  pings (today's actual spend > $0.001 from Phase 8 runs).
- Approval-rate check: synthesize a 10pp drop in recent feedback
  → Slack pings.

---

### Step 7 — Backup + restore drill

Daily logical backup of just our schema, retained 30 days.
`.github/workflows/backup-schema.yml` at 02:00 UTC (before the
agent runs):

```yaml
- run: |
    pg_dump --schema='course-agent' --no-owner --no-acl \
      "${{ secrets.SUPABASE_DB_URL }}" \
    | gzip > backup-$(date -u +%Y%m%d).sql.gz
- run: aws s3 cp backup-*.sql.gz s3://edstellar-course-agent-backups/
```

(Adjust if the team uses Cloudflare R2 / GCS; the pg_dump line
is the same.)

Drill script in `docs/runbook.md`:

```
1. spin up a fresh Postgres instance (Supabase dashboard or local docker).
2. createdb edstellar_drill
3. psql edstellar_drill < <(gunzip -c backup-YYYYMMDD.sql.gz)
4. select count(*) from "course-agent".suggestions;   # match prod
5. drop database edstellar_drill;
```

Schedule one drill on a quiet Saturday and document the time it
took. The runbook entry says "should take ~5 min for the size we
have today; revisit when row counts cross 100k".

**verify:** drill once, record outcome in `docs/runbook.md` under
"Restore drill log". Future drills append to the log.

---

### Step 8 — Auto-promote prompt versions (flag-gated)

`engine/src/engine/scripts/auto_promote.py`:

```python
def main():
    cfg = settings()
    if not cfg.prompt_auto_promote_enabled: return 0
    # Compare candidate vs active win-rates over the last N runs.
    # Only promote if:
    #   candidate has >= MIN_PROMOTE_DECISIONS feedback rows on its runs
    #   candidate.win_rate > active.win_rate + MIN_PROMOTE_DELTA
    # Log to audit_log on promote.
```

Run nightly via GitHub Actions, but the env var ships
`PROMPT_AUTO_PROMOTE_ENABLED=false`. The script reports what it
WOULD have done in dry-run mode so the team can monitor for a
month before flipping it on.

**verify:** dry-run logs match manual `/learning` math. Flip the
flag on a staging DB and confirm a candidate that crosses the
threshold gets promoted + an audit_log row gets written.

---

### Step 9 — Runbook + docs

`docs/runbook.md` sections:

- **How to manually trigger an agent run** (`uv run agent run --category ... --top-k N`)
- **How to roll back a prompt version** (SQL flip: `update prompt_versions set status='active' where version=N; update prompt_versions set status='retired' where status='active' and version<>N;`)
- **What to do if approval rate collapses** (check `/learning`, check the last `regenerate_prompt` candidate, consider rollback)
- **How to add a new rejection tag** (insert into `rejection_taxonomy`, no code change needed)
- **How to update the Rule 10 certification blocklist** (edit `engine/src/engine/rules/data/cert_blocklist.txt`, commit, restart)
- **How to add a digest recipient** (insert into `digest_recipients`)
- **How to assign a suggestion to a specific reviewer** (update `suggestions.assignee_id`)
- **Restore drill procedure** (Step 7)
- **What each alert means and what to do**

Cross-link from `phase{2,3,5-8}.md` "When you resume" sections
so onboarding finds the runbook first.

**verify:** read it cold. Ask a teammate (or future you) to
trigger a manual run from the runbook alone. If they get stuck,
the runbook isn't done.

---

### Step 10 — Final acceptance + commit

Run the doc's acceptance suite (top of this file). All should be
green. Cleanup: delete any debug `console.log` / `print` left from
Steps 1-9, run all three smokes + pytest, confirm `tsc --noEmit`.

Commit on `main` as `"Phase 9: observability + hardening"`.

---

## Acceptance verification

| Check | Method |
|---|---|
| Sentry catches a thrown error with run_id tag | manual `raise` test inside a node |
| Sentry catches a Server Action error with user_id | manual `throw` in a Server Action |
| Langfuse shows one trace per run with nested spans | dashboard inspection |
| GitHub Actions Cron triggers agent at 03:00 UTC | scheduled fire — verify next-day run lands |
| Daily-run-missing alert fires when no run | manual trigger after deleting today's run |
| Approval-rate drop alert fires on synthetic 10pp drop | inject test feedback, re-run script |
| Spend-threshold alert fires on $0.001 ceiling | re-run script with fake ceiling |
| `audit_log` has rows from prompt-promote, category-pin | SQL select after exercising each action |
| Parallel research: 5-cat run ≤ 1.5× single-cat time | timer both runs |
| Restore drill completes; row counts match prod | drill once, record in runbook |
| Runbook is followable cold | new-teammate or 1-hr-from-now you |

---

## Gotchas worth knowing in advance

- **Sentry source maps in production.** `@sentry/nextjs`'s
  wizard adds the upload step; if you skip the `SENTRY_AUTH_TOKEN`
  in CI the stack traces will be minified-only. Set the token in
  GitHub Actions secrets BEFORE the first production deploy.

- **Langfuse `flush()` is non-optional.** Without it, agent runs
  exit before background spans send. The dashboard will be
  intermittently missing data and you'll waste an hour blaming the
  SDK.

- **GitHub Actions secrets are environment-scoped.** Once you
  create `agent-production`, secrets bound to that environment are
  only available when the job declares
  `environment: agent-production`. Drop the line in the YAML and
  the run fails with "missing SUPABASE_URL".

- **`pg_dump` via the Supabase pooler vs direct connection.** The
  pooler doesn't speak the replication protocol pg_dump needs. Use
  the direct connection string (`db.<project>.supabase.co:5432`),
  not `aws-0-...pooler.supabase.com:6543`.

- **LangGraph `Send` reducer semantics.** Default state-merging
  REPLACES list fields; `Send` fan-out needs `Annotated[list[…],
  add]` (or your own concat reducer) on `raw_candidates`. Easy to
  forget and produces silently-empty merges.

- **The `RunCostLedger` is currently a single shared object** —
  parallel research branches will race on its `.calls` list.
  Wrap appends in a lock OR have each branch keep a local ledger
  that the merge step folds in. Phase 9 picks the locking path
  for minimal code change.

- **`audit_log` actor_id is `not null`.** Anything that writes to
  it from a service-role context (engine, scripts) needs to either
  resolve to a real auth.users row or skip the log. A "system"
  pseudo-user row in auth.users is one way; deferring the log when
  there's no human caller is another.

- **Slack alert dedup.** If the daily-run-missing check runs
  multiple times after a failed cron, the alert will fire
  multiple times. Idempotent path: store the last-alert timestamp
  in a tiny `alerts_state` table (or the `audit_log` itself with
  an `alert.fired` action) and skip if already alerted today.

- **The 03:00 UTC schedule** can drift up to 15 minutes per the
  GitHub Actions docs. The 06:00 daily-run-missing check has a
  3-hour buffer for exactly this reason. Don't tighten it.

- **Auto-promote will eat itself** if the candidate is worse than
  active but you flip the flag prematurely. The 20-decision
  minimum + 5pp delta is conservative; resist the urge to lower
  them in the first month. The dry-run log is there to build
  trust before the team turns it on.

- **Backup schema name has a hyphen.** `pg_dump
  --schema='course-agent'` works in psql 14+ but quoting matters
  on Windows shells. Use single quotes; if you copy-paste into
  PowerShell, the outer string handling can strip them.

---

## What's deliberately not in Phase 9

- **Phase 3 demand signals** (SerpAPI Google Trends, Lightcast
  job-posting data). The build plan calls this out as
  out-of-scope for v1.
- **Reviewer-personalised hints** — per-reviewer rejection
  probability prediction.
- **In-app agent chat** (Strands-style conversational layer for
  "find me more references for this candidate").
- **Multi-language support.** Dashboard ships English-only.
- **Mobile-optimised review.** Desktop-first; tablet works,
  native-quality mobile is v2.
- **Prefect for orchestration.** Phase 9 ships GitHub Actions
  Cron. Phase 10 may graduate if a multi-step pipeline
  materializes.
- **In-app notifications / bell icon.** Email + Slack covers v1.

---

## Done means

- [ ] `@sentry/nextjs` installed; both server + client init wired;
      thrown errors land in Sentry with user_id + path tags.
- [ ] `sentry-sdk[httpx]>=2.20` installed in engine; init from CLI
      at boot; engine exceptions land in Sentry with run_id +
      node name.
- [ ] `langfuse>=4.6,<5` pinned; hook rewritten to
      `start_as_current_observation` + a top-level `agent.run`
      trace; `client.flush()` called before CLI exit; dashboard
      shows nested spans with cost.
- [ ] `.github/workflows/agent-daily.yml` triggers at 03:00 UTC
      Mon-Sat; manual `gh workflow run` works; one real scheduled
      run lands in `agent_runs`.
- [ ] Parallel research via LangGraph `Send`; 5-category run
      profiled at ≤ 1.5× a single-category run.
- [ ] Migration 0011 (`audit_log`) applied; `logAdminAction()`
      called from every admin Server Action; rows visible.
- [ ] Three alert scripts + GitHub Actions Cron schedules; each
      fires its Slack ping on its trigger.
- [ ] Daily `pg_dump --schema='course-agent'` retained 30 days in
      private bucket; restore drill completed once, time recorded
      in runbook.
- [ ] `docs/runbook.md` covers manual run, prompt rollback,
      approval-rate triage, taxonomy + blocklist edits, recipient
      add, assignee change, restore drill, alert response.
- [ ] Auto-promote script shipped behind
      `PROMPT_AUTO_PROMOTE_ENABLED=false`; dry-run logs sane.
- [ ] All three smokes still green; pytest count holds (50+).
- [ ] Committed on `main` as "Phase 9: observability + hardening".

---

## When you resume — for the post-launch life

Phase 9 is the last build plan phase. After it ships the system
is in steady state: nightly runs, monitored alerts, restorable
backups, documented runbook. Day-to-day work becomes:

1. Reviewer time on `/suggestions/today` — the actual product.
2. Periodic prompt regeneration + manual promotion (or
   auto-promote once trusted).
3. Watching the three alerts and acting on them.
4. Occasional rejection-tag additions as reviewers find new
   failure modes.
5. The out-of-scope items at the bottom of
   `edstellar_agent_build_plan.md` (Phase 3 demand signals,
   reviewer-personalised hints, in-app chat) graduate to the v2
   roadmap.

Last known good commit on `main`: see `git log --oneline -10`.

When something breaks: open `docs/runbook.md` first.

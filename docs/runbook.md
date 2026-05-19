# Operational runbook

Single source for "how do I do X" in production. Open this file
first when something breaks or when a teammate asks "where's the
button for…?"

The phase plans (`phase{2,3,5-9}.md`) describe how the system was
built. This runbook describes how to keep it running.

---

## Table of contents

- [Manually trigger an agent run](#manually-trigger-an-agent-run)
- [Roll back a prompt version](#roll-back-a-prompt-version)
- [Approval rate collapsed — what now?](#approval-rate-collapsed--what-now)
- [Add a new rejection tag](#add-a-new-rejection-tag)
- [Update the Rule 10 certification blocklist](#update-the-rule-10-certification-blocklist)
- [Add a digest recipient](#add-a-digest-recipient)
- [Bulk-upload courses](#bulk-upload-courses)
- [Assign a suggestion to a specific reviewer](#assign-a-suggestion-to-a-specific-reviewer)
- [Restore from backup (drill or real)](#restore-from-backup-drill-or-real)
- [Alert response](#alert-response)

---

## Manually trigger an agent run

When you need a run outside the 03:00 UTC schedule — after a prompt
promotion, to validate a code change, to back-fill a missed day.

### From your machine

```powershell
cd <repo>/engine

# Full run — same args the cron uses.
uv run agent run --top-k 5 --max-candidates 12

# Smaller verify run — one category, no DB writes.
uv run agent run --category "Cybersecurity" --top-k 1 --max-candidates 5 --dry-run
```

Read the tail of the log for `run end final_candidates=N run_id=<UUID>`.
A non-dry run lands a row in `agent_runs` and N suggestions in
`suggestions`. A dry run prints `DRY-RUN — no DB writes` and `run_id=None`.

### From GitHub (no terminal access)

`Actions → agent-daily → Run workflow → main → Run workflow`.

Same args, fixed: `--top-k 5 --max-candidates 12`. To override,
edit the workflow file inline temporarily (don't commit the change)
or use `workflow_dispatch` inputs — but inputs aren't wired yet.

### When the manual run fails

- `pydantic.ValidationError` on boot → a required env var is empty.
  Compare your shell `env` (local) or `agent-production` secrets (CI)
  against `engine/src/engine/config.py`.
- `httpx.ConnectError: Name or service not known` → DNS to Supabase
  is broken. From CI, check the `Pin Supabase hostname → IP` step.
  Locally, run `nslookup` against the Supabase host.
- `RunCostCeilingExceeded` → you crossed `ENGINE_RUN_COST_CEILING_USD`
  (default $5). Either bump the ceiling temporarily or pick a smaller
  `--max-candidates`.

---

## Roll back a prompt version

You promoted v8 in `/learning`, approval rate cratered, and you want
v7 back active immediately. Two writes inside a single SQL Editor
session in Supabase Studio:

```sql
-- 1. Find the rows.
select id, version, status
from "course-agent".prompt_versions
where status in ('active', 'retired')
order by version desc
limit 5;

-- 2. Retire the bad one.
update "course-agent".prompt_versions
   set status = 'retired'
 where status = 'active';

-- 3. Re-activate the good one. Replace <previous-version-number>.
update "course-agent".prompt_versions
   set status = 'active'
 where version = <previous-version-number>
   and status = 'retired';
```

Then run `agent run --category <one>` and watch `/learning` — the
prompt-version pill in the suggestion-source column should show the
restored version.

The Phase 8 step that wired DB-driven prompts means this is a
data-only fix; no engine restart needed.

If you want the rollback to leave an audit trail, run the same flip
through `/learning` (Promote on the old row, Retire on the new one)
instead of raw SQL — that goes through `promotePromptVersion` /
`retirePromptVersion` which write `audit_log` rows.

---

## Approval rate collapsed — what now?

The Mon 08:00 UTC `alert-approval-rate` ping fired, or you noticed
the trend on `/learning` dropping ≥10pp week-over-week.

### Triage in order

1. **`/learning` → Prompt versions panel**: which version is active?
   When did it become active? Compare its win rate (the live
   per-prompt figure) to the version it replaced.
2. **`/learning` → Rejection-reason mix**: did one tag spike?
   - `off_topic`, `wrong_audience` → prompt drift; the new active
     prompt is generating candidates that no longer match the brief.
   - `weak_references`, `unverifiable_claim` → Rule 7 is letting
     through worse refs (could be a Serper outage flooding poor
     hits, or a prompt change asking for fewer concrete URLs).
   - `bad_pricing`, `duration_unrealistic` → prompt no longer
     anchors on enterprise B2B norms.
3. **Recent runs**: in Studio,
   ```sql
   select id, started_at, prompt_version_id, candidates_persisted, approval_rate
   from "course-agent".agent_runs
   order by started_at desc limit 10;
   ```
   If `prompt_version_id` flipped recently and approval rate dropped
   right after, you have your culprit.

### Decide

- **Tag-spike with obvious cause** → fix the source (taxonomy edit,
  blocklist update, guardrail JSON) — do NOT roll back the prompt.
- **Prompt-driven drop** → roll back the active prompt (see
  previous section). Then run `regenerate_prompt` to spin a new
  candidate from the recent rejections and try again next week.
- **Data anomaly** (one reviewer rejecting everything, off-day) →
  wait for the next week. The 7d-over-7d window is intentionally
  noisy at small sample sizes.

---

## Add a new rejection tag

Reviewers found a failure mode the existing taxonomy doesn't cover.
No code change required — the `RejectModal` reads from the DB.

```sql
insert into "course-agent".rejection_taxonomy (key, label, description)
values (
  'fictional_provider',
  'Fictional provider',
  'The candidate cites a course from a provider that does not appear to exist.'
)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description;
```

- `key` is a stable identifier — use snake_case, never rename it
  once rows reference it.
- `label` shows in the modal; keep it short.
- `description` shows as helper text; one sentence, plain.

The Phase 8 guardrail addendums in
`engine/src/engine/rules/data/guardrails.json` are keyed by tag.
If you expect the new tag to drive a category-specific guardrail
later, add a stub entry there in the same PR — the agent reads it
on the next boot.

---

## Update the Rule 10 certification blocklist

Rule 10 rejects candidates whose title implies certification by a
vendor we know does no such thing. The blocklist lives in source:

```
engine/src/engine/rules/data/cert_blocklist.txt
```

One line per phrase, case-insensitive substring match. Comment lines
start with `#`. Examples that work:

```
# Vendors that do not issue certifications in this domain
# Salesforce Trailhead is training, not a Salesforce-issued cert
gartner certified
mckinsey certified
forrester certified
```

To add an entry:

```powershell
cd <repo>
# 1. Edit the file.
notepad engine/src/engine/rules/data/cert_blocklist.txt
# 2. Verify the rule still loads.
cd engine
uv run pytest tests/test_rules.py -k blocklist
# 3. Commit.
git add engine/src/engine/rules/data/cert_blocklist.txt
git commit -m "Rule 10: blocklist <vendor> <phrase>"
git push
```

The next scheduled or manual `agent run` picks up the new entries
on boot — no separate deploy step. CI auto-promote is not affected
(this is a research-time check, not a prompt change).

---

## Add a digest recipient

The Phase 7 daily digest email goes to every row in
`digest_recipients` where `is_active = true`. No admin UI yet — SQL
in Studio.

```sql
-- Receives every category.
insert into "course-agent".digest_recipients (email, notes)
values ('alex@edstellar.com', 'NL/EMEA review window')
on conflict (email) do update
  set is_active = true,
      notes    = excluded.notes;

-- Filter to specific categories (Phase 9 consumes the filter; if
-- you're on Phase 8 only, the digest send ignores this list).
insert into "course-agent".digest_recipients (email, notes, assigned_categories)
values (
  'priya@edstellar.com',
  'Cybersecurity + Cloud only',
  array['Cybersecurity', 'Cloud Computing']
)
on conflict (email) do update
  set assigned_categories = excluded.assigned_categories,
      notes               = excluded.notes,
      is_active           = true;
```

To pause delivery without deleting the row (e.g. someone is on
leave):

```sql
update "course-agent".digest_recipients
   set is_active = false
 where email = 'alex@edstellar.com';
```

RLS only admins (`is_admin()`) can read/write this table. If you
get a 0-row response, your `app_metadata.course_agent_role` isn't
`admin` — run the SQL with the service-role connection or have an
admin do it.

---

## Bulk-upload courses

When Edstellar adds courses through a non-agent channel (CMS edit,
partnership import, manual catalogue work), the agent's view of
`course-agent.courses` drifts out of sync with the production
website. `gap_analyze` then targets categories that are already
well-supplied. Bulk-upload from `/inventory` keeps the two in sync.

Admin role only — the **Upload courses** button is hidden from
reviewer accounts and the server action rejects non-admin callers.

### Walkthrough

1. `/inventory` → top admin strip → **Upload courses**.
2. (Optional) **Download sample CSV** for the column shape.
3. Drop a CSV with at least `name` + `category` columns. `num`,
   `subcategory`, `link` are optional but help dedup and the UI.
4. Preview shows the first 5 rows with per-row validation. Fix any
   row marked red in your source file and re-upload — bad rows are
   skipped, the rest still go through.
5. **Process upload** runs the reconciliation server action. Result
   panel reports new courses, auto-created categories, duplicates
   skipped, and any conflicts.

### Duplicate logic

For each CSV row:

1. **`num` match** — if the CSV row's `num` already exists in
   `courses`, skip. If the names differ, also report a conflict so
   you can investigate manually (we never overwrite).
2. **`name + category` exact match** — only when `num` is absent on
   the CSV row. Case-sensitive.
3. **Else** — insert.

### Embedding lag

New rows are inserted with `embedding = NULL`. Until embeddings are
backfilled, Rule 2 (dedup) and Rule 9 (demand) won't see these
courses — the next agent run could propose a near-duplicate. Run:

```bash
cd /opt/course-agent/engine
uv run embed_courses
```

…on the Coolify VPS, or set up the embed job there alongside the
existing daily cron. ~1s per row, idempotent.

### Conflicts

A conflict is "CSV row says `num=2001` is `Foo`, but DB row with
`num=2001` is `Bar`." The bulk action **never overwrites** — it
skips and reports. Investigate manually: usually one side has stale
data, occasionally a `num` was reassigned.

### Audit trail

Each upload is logged once as `courses.bulk_upload` with the
summary payload (new_courses, new_categories, skipped_duplicates,
conflicts, total_rows). Each auto-created category is also logged
as `category.upsert` with `source: "bulk_upload"`. Both show up on
`/history` → Decisions tab when filtered by action.

### Limits

| Limit | Value | Why |
|---|---|---|
| File size | 5 MB | ~50K rows; Edstellar has < 2K courses today, plenty of headroom. |
| Format | CSV (UTF-8, header row) | No `.xlsx` parser bundled — Save As CSV from Excel. |
| Mutation | Insert-only | This action never updates or deletes. SQL for those. |

---

## Assign a suggestion to a specific reviewer

By default a suggestion is "unassigned" and any reviewer can act on
it. Sometimes you want a specific person to triage one (subject-
matter expertise, language match, follow-up on their earlier
rejection).

```sql
-- 1. Find the suggestion (the suggestion-card URL in /suggestions/today
--    has the id) and the reviewer's auth.users.id.
select id, email, raw_user_meta_data->>'full_name' as name
from auth.users
where email ilike '%alex%';

-- 2. Set the assignee.
update "course-agent".suggestions
   set assignee_id = '<reviewer-uuid>'
 where id = '<suggestion-uuid>';
```

The Phase 8 Step 10 RLS update on `suggestions` lets a reviewer see:

- their own assignments,
- unassigned rows (assignee_id is null),
- nothing else.

So assigning routes the suggestion exclusively to that person. To
un-assign, set `assignee_id = null`.

---

## Restore from backup (drill or real)

Daily logical backups land in the configured S3-compatible bucket
via `.github/workflows/backup-schema.yml`, as
`backup-YYYYMMDD.sql.gz`. Retention is 30 days at the bucket level
— set the lifecycle rule in your S3/R2 console, not in this
workflow.

### Steps

```bash
# 1. Pick a backup. Use yesterday's unless you're rehearsing
#    "what would we do today if the schema were truncated".
stamp=20260517   # YYYYMMDD

# 2. Pull from the bucket. AWS S3:
aws s3 cp s3://<bucket>/backup-${stamp}.sql.gz .
#    Cloudflare R2:
# aws --endpoint-url https://<account>.r2.cloudflarestorage.com \
#     s3 cp s3://<bucket>/backup-${stamp}.sql.gz .

# 3. Spin up an isolated Postgres. Easiest: Docker.
docker run --rm -d --name pg-drill \
  -e POSTGRES_PASSWORD=drill -p 55432:5432 \
  postgres:16

# 4. Create the target DB.
PGPASSWORD=drill createdb -h localhost -p 55432 -U postgres edstellar_drill

# 5. Replay the dump. The schema name has a hyphen — quoting
#    matters in some shells. The gz expansion is a stream.
gunzip -c backup-${stamp}.sql.gz \
  | PGPASSWORD=drill psql -h localhost -p 55432 -U postgres edstellar_drill

# 6. Sanity-check row counts against prod (run the same select
#    in Supabase Studio and compare).
PGPASSWORD=drill psql -h localhost -p 55432 -U postgres edstellar_drill -c '
  select
    (select count(*) from "course-agent".courses)             as courses,
    (select count(*) from "course-agent".categories)          as categories,
    (select count(*) from "course-agent".agent_runs)          as agent_runs,
    (select count(*) from "course-agent".suggestions)         as suggestions,
    (select count(*) from "course-agent".feedback)            as feedback,
    (select count(*) from "course-agent".rejection_taxonomy)  as rejection_taxonomy,
    (select count(*) from "course-agent".prompt_versions)     as prompt_versions,
    (select count(*) from "course-agent".audit_log)           as audit_log;
'

# 7. Tear down when satisfied.
docker stop pg-drill
```

### Restore drill log

Run one drill per quarter (or after any backup change). Append to
this log so the next person knows whether the procedure is current.

| Date (UTC) | Backup used | Wall time | Row counts match | Notes |
|---|---|---|---|---|
| _(awaiting first drill)_ |  |  |  |  |

---

## Alert response

Three Slack alerts can fire. Each has a single, focused triage path.

### `:rotating_light: Daily agent run missing`

**What it means**: 03:00 UTC scheduled `agent-daily` didn't produce
an `agent_runs` row by 06:15 UTC. The cron was missed, the job
errored out, or it's still running 3+ hours in (very unusual).

**What to check**:

1. `Actions → agent-daily` — look for the failed run from the morning.
2. If the run failed, expand the failing step. Common causes already
   in this runbook above ("When the manual run fails").
3. If no run exists at all, the cron may have been disabled or the
   `agent-production` environment locked. Check
   `Settings → Environments → agent-production`.

**Fix**: trigger the run manually (see "Manually trigger an agent
run"). Reviewers can still work — yesterday's queue carries over.

### `:chart_with_downwards_trend: Approval rate dropped Xpp`

**What it means**: 7d approval rate is ≥10pp below the prior 7d
window, with ≥10 decisions in each window. Most likely cause: a
recently-promoted prompt is producing worse candidates.

**What to do**: follow "Approval rate collapsed — what now?" above.

### `:money_with_wings: Daily spend $X exceeded ceiling $Y`

**What it means**: sum of today's `agent_runs.cost_usd` crossed
`OPENROUTER_DAILY_CEILING_USD` (default $10). Not the same as the
per-run ceiling (`ENGINE_RUN_COST_CEILING_USD`, default $5) — one
expensive run won't trip this, but several runs accumulating will.

**What to check**:

```sql
select id, started_at, model_used, cost_usd, candidates_persisted
from "course-agent".agent_runs
where started_at >= date_trunc('day', now() at time zone 'utc')
order by cost_usd desc;
```

If you see >1 run today, something is firing the agent more than
once per day — check the GitHub Actions schedule history for
`agent-daily` and any rogue manual triggers. If a single run is
expensive, look at Langfuse for the trace and find the runaway
node (usually Rule 7's ref-verification cascade on a candidate
with many references).

**Fix options**:

- Bump `OPENROUTER_DAILY_CEILING_USD` in repo variables if today's
  spend is a one-off (rerun after a flaky day).
- Lower `--top-k` or `--max-candidates` in `agent-daily.yml` if
  every run consistently costs this much.
- Tighten the per-run ceiling so individual runaways are caught
  sooner.

---

## What's still missing here

Add a section the first time you do an op that isn't covered. The
runbook stays useful only as long as it grows with the system.

# Operational runbook

Single source for "how do I do X" in production. Phase 9 Step 7
seeds the restore drill; Phase 9 Step 9 expands the rest (manual
agent run, prompt rollback, approval-rate triage, taxonomy + blocklist
edits, recipient add, assignee change, alert response).

When something breaks, open this file first.

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

## What's still missing here

Phase 9 Step 9 will add sections for:

- Manual agent run from the CLI / via `gh workflow run`
- Rolling back a bad prompt promotion
- Approval-rate triage (when the Mon 08:00 UTC alert fires)
- Adding a new rejection tag
- Updating the Rule 10 certification blocklist
- Adding a digest recipient
- Assigning a suggestion to a specific reviewer
- What each Slack alert means and what to do about it

Don't wait for Step 9 to use this file — add a section the first
time you do an op someone else might do later.

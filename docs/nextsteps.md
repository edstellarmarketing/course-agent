# Next steps — picking up from the Phase 3 pause

Work paused mid-Phase 3. This doc says exactly where things stopped, what's blocking, and what to do when you sit back down.

## TL;DR

| Phase | State | Notes |
|---|---|---|
| Phase 0 | ✅ Done | Repos, tooling, design tokens, hello page |
| Phase 1 | ✅ Done | All 11 routes click through with mock data |
| Phase 2 | ✅ Done | All required wires live (Supabase, OpenRouter DeepSeek, Voyage 1024-dim, Serper, hardened GAS relay with shared-secret check, Langfuse configured) |
| Phase 3 Steps 2–6 | ✅ Done in source | `supabase/migrations/0001_initial.sql` + `0002_seed_rejection_taxonomy.sql` applied to the Supabase Postgres |
| Phase 3 Step 1 | 🔴 **Blocked** | `PGRST_DB_SCHEMAS` includes `course-agent` in the Coolify env list, but PostgREST inside `supabase-rest` isn't seeing it — every query against the `course-agent` schema returns HTTP 406 |
| Phase 3 Steps 7–12 | ⏸ Not started | Auth providers, Supabase client wrappers, real `/login`, middleware, replacing `mockCurrentReviewer` |

`pnpm --dir app smoke` and `uv --directory engine run smoke` are both green except for the one Phase 3 schema check, which fails with the 406 above.

## Where exactly we paused

Last attempted: applying Phase 3 Step 1 (PostgREST schema exposure) to a self-hosted Supabase running under Coolify.

What we know:

- The `course-agent` schema **exists in Postgres** — migrations 0001 + 0002 ran successfully via `psql` on the Coolify Terminal of the `supabase-db` container.
- The Coolify resource-level env var `PGRST_DB_SCHEMAS` includes `course-agent` in its literal value:
  ```
  public,storage,graphql_public,Marketing-PM-Tool,Corporate-Assessment-Tool,eggdrop,course-agent
  ```
- A full stack restart happened (`Saved configuration files to /data/coolify/services/dfpiopwrqgdf8iods10d4546.` → every container recreated, all healthy).
- Despite that, `Accept-Profile: course-agent` against `/rest/v1/rejection_taxonomy` returns HTTP **406** from Kong/PostgREST. A diagnostic probe against a non-existent table inside the same schema also returns 406 — meaning PostgREST has zero awareness of `course-agent`, not just a per-table issue.

**Working hypothesis:** the Coolify-generated `docker-compose.yml` for this Supabase stack is hardcoding `PGRST_DB_SCHEMAS` in the `supabase-rest` service definition (or substituting from a different variable name), so the resource-level env-var edit doesn't propagate inside the container.

## Resume checklist

Three diagnostics in order, then unblock and continue.

### 1. Confirm what `supabase-rest` actually sees for `PGRST_DB_SCHEMAS`

In Coolify, drill down to the **`supabase-rest-dfpiopwrqgdf8iods10d4546`** container (not the parent resource). Open its Terminal and run:

```bash
env | grep PGRST_DB_SCHEMAS
```

Outcomes:

| Output | Diagnosis | Fix |
|---|---|---|
| Full list including `course-agent` | env is reaching the container but PostgREST cached state somehow | Re-run `psql -U postgres -c "NOTIFY pgrst, 'reload config';"` on the db container, then re-run smoke |
| Short list, **missing `course-agent`** | The compose template hardcodes the schemas list; Coolify's resource env isn't being used here | See step 3 — edit the compose template |
| (no output) | Same as the short-list case — env var isn't being passed into this container at all | See step 3 |

### 2. Confirm Postgres state is good

Independently of PostgREST, verify the migrations are really in:

```bash
# From the supabase-db container's Terminal
psql -U postgres -c "select schema_name from information_schema.schemata where schema_name = 'course-agent';"
# expect: 1 row, "course-agent"

psql -U postgres -c '\dt "course-agent".*'
# expect: 7 tables — agent_runs, categories, courses, feedback,
# prompt_versions, rejection_taxonomy, suggestions

psql -U postgres -c 'select count(*) from "course-agent".rejection_taxonomy;'
# expect: 11
```

If any of these don't match, replay the migration via the same Terminal:

```bash
psql -U postgres -f /tmp/0001_initial.sql       # paste from supabase/migrations/0001_initial.sql first
psql -U postgres -f /tmp/0002_seed_rejection_taxonomy.sql
```

### 3. Fix the env propagation

Most likely the Coolify Supabase template generated a `docker-compose.yml` at:

```
/data/coolify/services/dfpiopwrqgdf8iods10d4546/docker-compose.yml
```

(that path is in the restart log). SSH to the Coolify host and find the `supabase-rest` (sometimes `rest`) service block. Look for the `environment:` section. You should see something like:

```yaml
services:
  rest:
    environment:
      PGRST_DB_URI: ...
      PGRST_DB_SCHEMAS: public,storage,graphql_public    # ← hardcoded value
      PGRST_JWT_SECRET: ${PGRST_JWT_SECRET}
```

If it's hardcoded, change to use the Coolify-injected value:

```yaml
PGRST_DB_SCHEMAS: ${PGRST_DB_SCHEMAS:-public,storage,graphql_public}
```

Save the file. Then redeploy from Coolify (the editor option in Coolify lets you commit changes to the generated compose; if not, the change reverts on the next Coolify deployment — in that case the upstream Coolify Supabase template needs the same fix).

Re-run the smoke:

```powershell
cd C:\Users\Vijay\Downloads\Course-Agent\engine
uv run smoke
```

Expected output:

```
smoke-test (engine)
✓ Supabase reachable
✓ course-agent schema applied (11 rejection tags)
✓ OpenRouter completion (deepseek/deepseek-chat-v3.1)
✓ Voyage AI embedding (voyage-3-large, 1024-dim)
✓ Serper search

Langfuse:  configured
Sentry:    not configured (optional)

All checks passed.
```

When that line appears, Phase 3 Steps 1–6 are done.

## What's still ahead in Phase 3

Continue with `docs/phase3.md` from **Step 7** onwards:

- **Step 7** — Configure Supabase Auth providers (Google SSO + magic link) in Studio. Set Site URL + Redirect URLs. **Studio is currently not publicly reachable** — `https://supabasekong-…sslip.io:8000` returned `ECONNREFUSED` from outside the host. You'll need to either expose `supabase-studio-dfpiopwrqgdf8iods10d4546` via Coolify, port-forward it locally, or do this from a machine that has network access to the Coolify host.
- **Step 8** — Three Supabase client wrappers in `app/src/lib/supabase/` (browser, server-with-session, service-role). Install `@supabase/supabase-js` + `@supabase/ssr` first.
- **Step 9** — Engine Supabase client (`engine/src/engine/supabase.py`) using `supabase-py`.
- **Step 10** — Wire `/login` to real OAuth + magic-link, add `/auth/callback` route handler.
- **Step 11** — `app/src/middleware.ts` for session enforcement + admin route gating + `/403` page.
- **Step 12** — Delete `mockCurrentReviewer`, swap every call site for the real session.

`docs/phase3.md` has the full code blocks for each. None of these depend on the schema-exposure fix — they're code-only. You could write them in parallel and have them ready to test the moment Step 1 is unblocked.

## Quick reference

### Useful files

- `docs/phase3.md` — full Phase 3 plan
- `docs/phase2.md` — Phase 2 plan (Phase 2 itself is done; still worth re-reading on env wiring shape)
- `docs/gas-email-relay.md` — GAS hardened doPost reference, with the `debugProps` troubleshooting recipe
- `supabase/migrations/0001_initial.sql` — schema + tables + RLS
- `supabase/migrations/0002_seed_rejection_taxonomy.sql` — 11 reject-tag seed
- `engine/src/engine/scripts/smoke_test.py` — currently the source of truth for whether the schema is exposed (the diagnostic probe in the `schema()` function is the canonical 406-vs-404 distinguisher)

### Useful commands

```powershell
# App build + smoke
cd C:\Users\Vijay\Downloads\Course-Agent\app
pnpm dev          # Phase 1 routes
pnpm exec next build
pnpm smoke        # Supabase + GAS

# Engine smoke (includes the schema check now)
cd C:\Users\Vijay\Downloads\Course-Agent\engine
uv run smoke

# Force PostgREST to reload its config without restarting
# (run inside supabase-db container in Coolify Terminal)
psql -U postgres -c "NOTIFY pgrst, 'reload config';"
```

### Useful env-var debug (inside the supabase-rest container only)

```bash
env | grep PGRST_      # everything PostgREST sees
env | grep SUPABASE_   # Supabase template vars
```

## When you resume

1. Open `docs/nextsteps.md` (this file) — should still be on `main`.
2. Run `uv --directory engine run smoke` to confirm the failure mode hasn't changed.
3. Pick up at the "Resume checklist" above.
4. When the schema check is green, move to `docs/phase3.md` Steps 7–12.

Last known good commit on `main`: see `git log --oneline -5`.

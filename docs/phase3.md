# Phase 3 — Supabase Schema + Auth

Sister-doc to `edstellar_agent_build_plan.md` and `phase2.md`. The build plan describes *what* Phase 3 produces; this doc walks through the work in the order it actually happens at a keyboard.

**Goal:** the `"course-agent"` Postgres schema exists with every table, index, and constraint from §3.1 of the architectural plan, RLS is on and tested, and the dashboard's `/login` lands a real Google-authenticated user on `/dashboard`.

**Duration:** 3–4 focused days.

**Acceptance — Phase 3 is done when:**

- A reviewer signs in with Google on `/login`, lands on `/dashboard`, and sees their own name in the sidebar profile pill (not `mockCurrentReviewer`).
- A reviewer-role user navigating to `/learning` or `/settings` gets a 403, not the page.
- Manually inserting a row in Supabase Studio with the anon key returns 401; the same query with the service-role key (or via a logged-in reviewer's session) succeeds.
- `\d "course-agent".courses` in `psql` shows the table with the `vector(1024)` embedding column and the `ivfflat` index.
- Dropping the schema (`drop schema "course-agent" cascade;`) and re-running every migration cleanly recreates the world — migrations are idempotent.
- `pnpm --dir app smoke` still exits 0 (Phase 2 didn't regress).
- The 11 rejection-taxonomy rows are seeded; the `RejectModal` on `/suggestions/today` now sources its tags from the database, not from `lib/mock/rejection-taxonomy.ts`.

---

## Pre-flight — decisions to make before opening Supabase Studio

| Decision | Recommendation | Why |
|---|---|---|
| Schema name | **`"course-agent"`** (with hyphen, in quotes) | Already mandated in §3.1. Forces explicit qualification everywhere — there's no `search_path` shortcut a query can lean on, which prevents accidental cross-schema joins. |
| Migration tooling | **Hand-written SQL files in `supabase/migrations/`**, applied via the Supabase Studio SQL Editor | The Supabase CLI is the long-term home, but for a 3-table-per-day pace, copy-pasting SQL into Studio is faster and keeps the migration files as the single source of truth. Switch to the CLI in Phase 6+ when migrations become more frequent. |
| Migration filename convention | **`NNNN_<verb>_<noun>.sql`** (e.g. `0001_initial.sql`, `0002_seed_rejection_taxonomy.sql`) | Sorts deterministically. The leading `0` keeps the order stable past 9 migrations. |
| Auth providers | **Google SSO (primary)** + **email magic link (fallback)** | Google covers the Edstellar Workspace identity, magic link covers anyone we invite externally for QA without a full SSO setup. |
| Session strategy | **Cookies via `@supabase/ssr`**, not localStorage | Server Components can read the session; middleware can gate routes server-side. localStorage is invisible to the server. |
| Service-role key boundary | **Engine + Server Actions only.** Never `NEXT_PUBLIC_*`, never imported from a Client Component. | The service-role key bypasses RLS entirely; shipping it to a browser is a database-wide breach. The `app/src/lib/supabase/server.ts` wrapper is the only place it's read in the dashboard. |
| RLS default | **`force row level security`** on every table from creation. | "Default deny" is the only safe default for a multi-reviewer table. Without `force`, the table owner (us, during migrations) bypasses RLS — easy to ship a policy that "works in Studio" but fails in production. |

If any of these change, the env vars stay the same — only the values do.

---

## Step-by-step

Each step ends with a `verify:` line you can run before moving on.

### Step 1 — Expose the schema in PostgREST

Out of the box, Supabase only exposes `public` and `storage` over the REST API. The dashboard and engine both need REST access to `"course-agent"`.

- [ ] In Supabase Studio: **Settings → API → Exposed schemas**.
- [ ] Add `course-agent` to the comma-separated list. The final value is usually `public, course-agent, storage`.
- [ ] Save. PostgREST hot-reloads — no restart needed.

> **Self-hosted note:** the equivalent change in `docker-compose.yml` is `PGRST_DB_SCHEMAS=public,course-agent,storage` on the `rest` service. Restart that container only.

**verify:** `curl "$SUPABASE_URL/rest/v1/?accept-profile=course-agent" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"` returns a JSON OpenAPI document mentioning `"course-agent"` even though no tables exist yet.

---

### Step 2 — Create the migrations directory + the first migration

- [ ] Create the structure at the **monorepo root** (both `app/` and `engine/` will read from the same schema, so migrations don't belong inside either):
  ```
  supabase/
    migrations/
      0001_initial.sql
      0002_seed_rejection_taxonomy.sql
    seed/
      rejection_taxonomy.csv          (optional, generated from the .sql)
    README.md
  ```
- [ ] Commit the empty `0001_initial.sql` shell with a header comment that explains the migration order rule:
  ```sql
  -- Migration 0001 — initial schema for the Course Discovery Agent.
  --
  -- Idempotent. Safe to re-run. Drop + recreate by:
  --   drop schema "course-agent" cascade;
  --   <run every migration in order>
  --
  -- The hyphen in "course-agent" forces quoting everywhere. There is no
  -- way to set a search_path shortcut around this — it is a deliberate
  -- forcing function for explicit qualification.
  ```

**verify:** `git status` shows the new files; the README explains the apply order.

---

### Step 3 — Schema, extensions, grants

The whole content lives in `0001_initial.sql`. The order matters: schema → extensions → grants → tables → indexes → RLS.

```sql
-- ─── Schema ──────────────────────────────────────────────────────────
create schema if not exists "course-agent";

-- Authenticated reviewers can read; the service role used by Server
-- Actions and the engine can do everything.
grant usage on schema "course-agent" to anon, authenticated, service_role;
grant all on schema "course-agent" to service_role;
alter default privileges in schema "course-agent"
  grant select on tables to authenticated;
alter default privileges in schema "course-agent"
  grant all on tables to service_role;

-- ─── Extensions (installed into `extensions`, then exposed in schema) ─
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
```

> **Don't install extensions inside `"course-agent"`** — Supabase upgrades the `extensions` schema in place; an extension owned by your app schema is on your migration plate, not theirs.

**verify:** in the Studio SQL Editor:
```sql
select extname from pg_extension where extname in ('vector','pgcrypto');
select schema_name from information_schema.schemata where schema_name = 'course-agent';
```

---

### Step 4 — Tables

All seven tables go in `0001_initial.sql`. Each one is the shape from §3.1 of the architectural plan, with the schema-qualified types Postgres demands.

```sql
-- ─── courses ─────────────────────────────────────────────────────────
create table if not exists "course-agent".courses (
  id            uuid primary key default gen_random_uuid(),
  num           int,
  name          text not null,
  category      text not null,
  subcategory   text,
  link          text,
  embedding     vector(1024),
  last_seen_at  timestamptz default now(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists courses_category_idx
  on "course-agent".courses (category);
create index if not exists courses_embedding_ivfflat_idx
  on "course-agent".courses
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─── categories ──────────────────────────────────────────────────────
-- course_count is intentionally not stored — the §3.1 spec described it
-- as `generated as (select count(*) ...) stored`, but Postgres doesn't
-- allow subqueries in generated columns. Phase 4 will compute it in the
-- view below.
create table if not exists "course-agent".categories (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,
  target_count  int,
  demand_score  numeric,
  is_pinned     boolean default false,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create or replace view "course-agent".categories_with_counts as
  select
    c.*,
    coalesce(cnt.course_count, 0)::int as course_count
  from "course-agent".categories c
  left join (
    select category, count(*) as course_count
    from "course-agent".courses
    group by category
  ) cnt on cnt.category = c.name;

-- ─── rejection_taxonomy ──────────────────────────────────────────────
create table if not exists "course-agent".rejection_taxonomy (
  key         text primary key,
  label       text not null,
  description text not null,
  rare        boolean default false,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

-- ─── prompt_versions ─────────────────────────────────────────────────
create table if not exists "course-agent".prompt_versions (
  id              uuid primary key default gen_random_uuid(),
  version         int not null,
  model_slug      text not null,
  system_prompt   text not null,
  status          text not null check (status in ('active','candidate','retired')),
  approval_rate   numeric,
  runs_observed   int default 0,
  notes           text,
  created_at      timestamptz default now()
);
create unique index if not exists prompt_versions_version_uq
  on "course-agent".prompt_versions (version);

-- ─── agent_runs ──────────────────────────────────────────────────────
create table if not exists "course-agent".agent_runs (
  id                    uuid primary key default gen_random_uuid(),
  started_at            timestamptz default now(),
  finished_at           timestamptz,
  model_used            text not null,
  prompt_version_id     uuid references "course-agent".prompt_versions(id),
  categories_targeted   text[] not null,
  candidates_produced   int default 0,
  candidates_persisted  int default 0,
  approval_rate         numeric,
  total_tokens_in       bigint default 0,
  total_tokens_out      bigint default 0,
  cost_usd              numeric default 0,
  created_at            timestamptz default now()
);

-- ─── suggestions ─────────────────────────────────────────────────────
create table if not exists "course-agent".suggestions (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid references "course-agent".agent_runs(id),
  title                 text not null,
  rationale             text,
  category              text not null
                          references "course-agent".categories(name)
                          on update cascade,
  proposed_subcategory  text,
  target_audience       text,
  duration_days         int check (duration_days > 0),
  delivery_format       text not null
                          check (delivery_format = 'instructor-led'),
  suggested_price_usd   numeric not null
                          check (suggested_price_usd > 2500),
  price_basis           text,
  "references"          jsonb not null
                          check (jsonb_array_length("references") >= 3),
  embedding             vector(1024),
  status                text not null default 'pending_review'
                          check (status in ('pending_review','approved','rejected','needs_revision')),
  created_at            timestamptz default now()
);
create index if not exists suggestions_status_idx
  on "course-agent".suggestions (status);
create index if not exists suggestions_run_idx
  on "course-agent".suggestions (run_id);
create index if not exists suggestions_embedding_ivfflat_idx
  on "course-agent".suggestions
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- ─── feedback ────────────────────────────────────────────────────────
create table if not exists "course-agent".feedback (
  id              uuid primary key default gen_random_uuid(),
  suggestion_id   uuid not null references "course-agent".suggestions(id) on delete cascade,
  decision        text not null check (decision in ('approved','rejected','needs_revision')),
  reason_tags     text[] not null default '{}',
  reason_text     text,
  reviewer_id     uuid not null references auth.users(id),
  created_at      timestamptz default now()
);
create index if not exists feedback_suggestion_idx
  on "course-agent".feedback (suggestion_id);
create index if not exists feedback_reviewer_idx
  on "course-agent".feedback (reviewer_id);
```

> **`references` is a reserved word** in standard SQL — that's why the column is in double quotes in the `suggestions` table and the constraint. Every query that touches it from Postgres-aware ORMs needs the quoting too. From PostgREST / supabase-js, the column will be addressed as `references` — that's fine.

**verify:**
```sql
select table_name
from information_schema.tables
where table_schema = 'course-agent'
order by table_name;
```
Should list exactly: `agent_runs`, `categories`, `categories_with_counts`, `courses`, `feedback`, `prompt_versions`, `rejection_taxonomy`, `suggestions`.

---

### Step 5 — Seed the rejection taxonomy

This is `0002_seed_rejection_taxonomy.sql`. The 11 rows must match the keys hard-coded in `app/src/lib/types.ts` (`RejectionTagKey`) — Phase 1 already committed those keys, this step makes the database agree.

```sql
-- Migration 0002 — seed rejection_taxonomy.
-- Idempotent via on conflict.

insert into "course-agent".rejection_taxonomy (key, label, description, rare, sort_order)
values
  ('already_exists',              'Already exists',              'Duplicate of a course we already offer.',                                              false, 10),
  ('near_duplicate_within_batch', 'Near duplicate in batch',     'Too similar to another suggestion in today''s batch.',                                  false, 20),
  ('not_instructor_led_market',   'Not instructor-led in market','Topic only exists as e-learning / self-paced in the real world.',                       false, 30),
  ('price_unrealistic',           'Price unrealistic',           'Proposed price isn''t defensible by the market evidence.',                              false, 40),
  ('topic_outdated',              'Topic outdated',              'Once-popular topic now declining; weak forward demand.',                                false, 50),
  ('too_niche',                   'Too niche',                   'Audience too small to be a viable B2B program.',                                        false, 60),
  ('wrong_category',              'Wrong category',              'Category mapping is incorrect.',                                                        false, 70),
  ('weak_references',             'Weak references',             'Citations are low-quality, off-topic, or unverifiable.',                                false, 80),
  ('not_corporate_relevant',      'Not corporate-relevant',      'Consumer or hobbyist topic, not enterprise training.',                                  false, 90),
  ('certification_name_used',     'Certification name used',     'Title references a specific credential or certifying body.',                            true, 100),
  ('other',                       'Other',                       'Requires a free-text explanation below.',                                               true, 110)
on conflict (key) do update set
  label       = excluded.label,
  description = excluded.description,
  rare        = excluded.rare,
  sort_order  = excluded.sort_order;
```

**verify:**
```sql
select key, label, rare from "course-agent".rejection_taxonomy order by sort_order;
```
Eleven rows. The two `rare` ones (`certification_name_used`, `other`) appear last.

---

### Step 6 — Row-Level Security

This is the deliberate-deny-by-default boundary. Once these are on, **even the admin in Supabase Studio cannot read tables without a session** — that's the point. Service-role bypasses RLS; everything else goes through policy.

```sql
-- Enable + force RLS on every table.
alter table "course-agent".courses             enable row level security;
alter table "course-agent".courses             force row level security;
alter table "course-agent".categories          enable row level security;
alter table "course-agent".categories          force row level security;
alter table "course-agent".rejection_taxonomy  enable row level security;
alter table "course-agent".rejection_taxonomy  force row level security;
alter table "course-agent".suggestions         enable row level security;
alter table "course-agent".suggestions         force row level security;
alter table "course-agent".feedback            enable row level security;
alter table "course-agent".feedback            force row level security;
alter table "course-agent".prompt_versions     enable row level security;
alter table "course-agent".prompt_versions     force row level security;
alter table "course-agent".agent_runs          enable row level security;
alter table "course-agent".agent_runs          force row level security;

-- ─── Helper: is the current user an admin? ──────────────────────────
-- Role is stored in auth.users.app_metadata (server-set, trusted) NOT
-- in raw_user_meta_data (user-settable, untrusted).
create or replace function "course-agent".is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- ─── courses ─────────────────────────────────────────────────────────
create policy courses_select on "course-agent".courses
  for select to authenticated using (true);
create policy courses_admin_write on "course-agent".courses
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());

-- ─── categories ──────────────────────────────────────────────────────
create policy categories_select on "course-agent".categories
  for select to authenticated using (true);
create policy categories_admin_write on "course-agent".categories
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());

-- ─── rejection_taxonomy ──────────────────────────────────────────────
-- Everyone signed in can read; only admin can curate.
create policy rejection_taxonomy_select on "course-agent".rejection_taxonomy
  for select to authenticated using (true);
create policy rejection_taxonomy_admin_write on "course-agent".rejection_taxonomy
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());

-- ─── suggestions ────────────────────────────────────────────────────
-- Agent (service role) writes are unaffected by RLS. Reviewers read all
-- pending + their own historical decisions' suggestions; admins read all.
create policy suggestions_select on "course-agent".suggestions
  for select to authenticated using (true);
create policy suggestions_admin_update on "course-agent".suggestions
  for update to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());
-- Reviewers update only the status of their assigned suggestions
-- (Phase 5 will tighten this with an assignee column).
create policy suggestions_reviewer_update on "course-agent".suggestions
  for update to authenticated
  using (true)
  with check (status in ('approved','rejected','needs_revision'));

-- ─── feedback ───────────────────────────────────────────────────────
-- Reviewers can insert their own rows; nobody updates a feedback row.
create policy feedback_insert on "course-agent".feedback
  for insert to authenticated
  with check (reviewer_id = auth.uid());
create policy feedback_select on "course-agent".feedback
  for select to authenticated using (true);

-- ─── prompt_versions ────────────────────────────────────────────────
-- Admin-only.
create policy prompt_versions_admin_all on "course-agent".prompt_versions
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());

-- ─── agent_runs ─────────────────────────────────────────────────────
-- Everyone reads; only service-role (the engine) writes.
create policy agent_runs_select on "course-agent".agent_runs
  for select to authenticated using (true);
```

> **Test with two reviewer accounts before declaring this done.** Sign in as Reviewer A, approve a suggestion — confirm it works. Sign in as Reviewer B, attempt to update Reviewer A's feedback row — confirm it fails. The architectural plan flags this as the trickiest part of Phase 3 (§3.7's "RLS for suggestions is the trickiest"); it deserves the extra ceremony.

**verify:**
```sql
-- As an unauthenticated client (anon key, no Authorization header):
select * from "course-agent".courses;     -- expect: 0 rows or RLS error
-- As authenticated reviewer:
select count(*) from "course-agent".courses;    -- expect: count
-- As authenticated reviewer attempting admin write:
insert into "course-agent".categories(name) values ('test');  -- expect: RLS violation
```

---

### Step 7 — Auth providers

Supabase Auth is per-project; configuration lives in the dashboard, not in migrations.

- [ ] **Settings → Authentication → URL Configuration.**
  - Site URL: `https://course-agent.edstellar.com` (or `http://localhost:3000` for local dev).
  - Redirect URLs: add both `https://course-agent.edstellar.com/auth/callback` and `http://localhost:3000/auth/callback`. Supabase refuses any callback not on this allowlist.
- [ ] **Settings → Authentication → Providers → Google.**
  - Toggle on.
  - Paste the client ID and client secret from the Edstellar Google Cloud project (Workspace OAuth, restricted to `edstellar.com` accounts via the Workspace admin console).
- [ ] **Settings → Authentication → Email → enable** "Email magic link". Disable "Enable email signups" — invitations come from the admin console; reviewers don't self-sign-up.

**verify:** open a private browser window, visit `https://<your-supabase-project>.supabase.co/auth/v1/authorize?provider=google` — it should redirect to a Google login screen, not throw an error about an unknown provider.

---

### Step 8 — Supabase clients (Next.js side)

The dashboard needs **two** clients (per §3.7 of the architectural plan):

- `lib/supabase/client.ts` — browser client, anon key, **respects RLS**.
- `lib/supabase/server.ts` — server client, **service-role key, bypasses RLS**. Used only inside Server Actions that legitimately need to read across the table (the daily-digest aggregation, audit logs).
- `lib/supabase/server-with-session.ts` — server client, anon key, **respects RLS, bound to the user's session via cookies**. Used by Server Components that render reviewer-scoped data.

Install:
```bash
pnpm --dir app add @supabase/supabase-js @supabase/ssr
```

`app/src/lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

export function createClient() {
  const e = env();
  return createBrowserClient(e.SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: "course-agent" },
  });
}
```

`app/src/lib/supabase/server-with-session.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function createSessionClient() {
  const cookieStore = await cookies();
  const e = env();
  return createServerClient(e.SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: "course-agent" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Set from a Server Component — ignore, middleware refreshes it.
        }
      },
    },
  });
}
```

`app/src/lib/supabase/server.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client. Bypasses RLS. Use only from server-side
 * code that legitimately needs to read across all users (audit log
 * aggregation, agent webhooks, daily-digest). Never expose to a Client
 * Component, never call from a route handler that returns its body to
 * the browser.
 */
export function createAdminClient() {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "course-agent" },
  });
}
```

**verify:** in a Server Component, `const { data } = await createSessionClient().from("rejection_taxonomy").select("*")` should return 11 rows for a signed-in reviewer, 0 (or null) for an unauthenticated request.

---

### Step 9 — Supabase client (engine side)

```bash
uv --directory engine add supabase
```

`engine/src/engine/supabase.py`:
```python
"""Supabase client for the course-agent engine.

Service-role only — the engine reads inventory + feedback and writes
suggestions + agent_runs. There is no user-scoped path inside the
engine, so we don't bother with the anon/session client variants.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, ClientOptions, create_client

from engine.config import settings


@lru_cache(maxsize=1)
def supabase() -> Client:
    cfg = settings()
    return create_client(
        str(cfg.supabase_url),
        cfg.supabase_service_role_key,
        options=ClientOptions(schema="course-agent"),
    )
```

**verify:** add to the engine smoke test:
```python
def supabase_schema():
    rows = (
        supabase().table("rejection_taxonomy").select("key").execute().data
    )
    if len(rows) != 11:
        raise RuntimeError(f"expected 11 rejection-tag rows, got {len(rows)}")
```

---

### Step 10 — Replace `/login`'s stub with real auth

Today `app/src/app/login/page.tsx` sends both buttons to `/dashboard` with no real auth. Phase 3 wires:

- The Google button to `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: ... } })`.
- The magic-link form to `supabase.auth.signInWithOtp({ email })` and a "check your inbox" confirmation state.
- A new route handler at `app/(auth)/auth/callback/route.ts` that calls `supabase.auth.exchangeCodeForSession(code)` and redirects to `/dashboard`.

The login page itself becomes a Client Component (it has the OAuth click handler and the form state), while the callback is a Server Route Handler that runs server-side only.

**verify:** sign in with a Google `@edstellar.com` account — land on `/dashboard`. Sign in with a non-Workspace account — Supabase's Auth hook rejects it (configure this in **Auth → Hooks** with a single line that returns `error` for non-`edstellar.com` domains).

---

### Step 11 — Middleware + admin-route gating

Three Phase 1 routes need server-side protection: every route except `/login` requires a session; `/learning` and `/settings` additionally require `admin` role.

`app/src/middleware.ts`:
```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth/callback"];
const ADMIN_PATHS = ["/learning", "/settings"];

export async function middleware(req: NextRequest) {
  const e = env();
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(e.SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: "course-agent" },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (user && isPublic && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (user && ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    const role = user.app_metadata?.role;
    if (role !== "admin") {
      return NextResponse.redirect(new URL("/403", req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Also create `app/src/app/403/page.tsx` — a minimal "you don't have access" page that links back to `/dashboard`.

**verify:** sign in as a `reviewer` user → navigate to `/learning` → land on `/403`. Sign in as `admin` → navigate to `/learning` → land on the page.

---

### Step 12 — Replace `mockCurrentReviewer` everywhere

Phase 1 hard-coded `mockCurrentReviewer` in `app/src/components/app-nav.tsx` and the `Add category` admin gate. Phase 3 swaps each call site for the real session.

- [ ] `app-nav.tsx` becomes a Server Component or imports a Server Component shell that reads `supabase.auth.getUser()` and the joined `profiles` row, then passes the profile down as a prop.
- [ ] `categories-view.tsx` continues to take `canEdit` as a prop — the **page** computes `canEdit = profile.role === "admin"` and passes it in. The component doesn't change.
- [ ] `settings/page.tsx` does the same for `SettingsModelsSection`.
- [ ] Delete `app/src/lib/mock/reviewers.ts` once nothing imports it.

**verify:** sign in as `admin` Priya. Sidebar pill reads "Priya Menon" and "Admin". Sign in as `reviewer` Daniel. Pill reads "Daniel Cho" and "Reviewer", `+ Add category` button is absent on `/categories`, `/learning` is not navigable.

---

## Acceptance verification

Run this list end-to-end with two test accounts (one admin, one reviewer). If any step fails, the phase isn't done.

| Check | Method |
|---|---|
| Google sign-in works for both accounts | manual click-through |
| `/dashboard` lands directly post-login | manual |
| Reviewer cannot reach `/learning` or `/settings` | manual → expect `/403` |
| Anon client cannot read tables | `curl ".../rest/v1/courses" -H "apikey:$ANON"` → 401 or empty |
| Reviewer client can read `courses`, `categories`, `rejection_taxonomy` | dev console in browser, or Server Component |
| Reviewer cannot insert into `categories` | Supabase Studio impersonation → policy violation |
| 11 `rejection_taxonomy` rows present | SQL |
| Schema drop + re-migrate is clean | `drop schema "course-agent" cascade;` + re-run | 
| Phase 2 smoke tests still green | `pnpm --dir app smoke && uv --directory engine run smoke` |

---

## Gotchas worth knowing in advance

- **The hyphen forces explicit quoting in every SQL statement.** `"course-agent".courses` everywhere. There is **no** `search_path = "course-agent"` trick that survives a function call — `security definer` functions reset it. Don't try to work around the hyphen; the explicitness it forces is the point.
- **`force row level security` is non-negotiable.** Without `force`, the table owner (your migration role) bypasses RLS even after `enable row level security`. That means a policy can look right in Studio (as owner) and fail for every real user. Always pair `enable` with `force`.
- **`auth.users.app_metadata.role` is the trustworthy place to store role.** `raw_user_meta_data` is user-controllable via the standard Auth API; `app_metadata` requires service-role to write. The `is_admin()` SQL helper reads from `app_metadata` for this reason.
- **`@supabase/ssr` cookie handling needs to update cookies on the response in middleware.** A read-only cookies adapter (`cookieStore` from `next/headers` outside an action) silently fails the session refresh. Use the middleware's `req.cookies.getAll()` + `res.cookies.set()` pattern shown above.
- **The Google OAuth client must restrict to the `edstellar.com` Workspace.** Without that restriction, anyone with a Google account can sign in; the Supabase Auth Hook is your second line of defence (deny if `email` doesn't end in `@edstellar.com`).
- **Migration ordering matters.** `0002_seed_rejection_taxonomy.sql` references the `rejection_taxonomy` table created in `0001_initial.sql`. The README in `supabase/` should explicitly say: apply files in lexicographic order, never partial.
- **The `references` column name in `suggestions` is a SQL reserved word.** Quoted in DDL (`"references"`), unquoted in PostgREST JSON (the column appears as `references` in `select` queries). The supabase-js client handles this; raw `psql` queries need the quotes.
- **`force row level security` excludes the table owner — including the service-role**, *unless* the policies explicitly grant it. Service-role bypasses RLS because Supabase short-circuits it via JWT inspection, **not** because the policies say so. Don't confuse that with policy authoring; service-role still doesn't need a policy.

---

## What's deliberately not in Phase 3

- Replacing mock data on `/inventory` and `/categories` with real Supabase queries → **Phase 4**.
- Real `feedback` writes from the review queue → **Phase 5**.
- The agent pipeline that produces real suggestions → **Phase 6**.
- The `assignee_id` column on `suggestions` that enables true per-reviewer queue routing → covered loosely in Phase 8; today's RLS treats every reviewer as eligible to act on every suggestion.

---

## Done means

- [ ] Schema migrations applied and idempotent.
- [ ] 11 rejection-taxonomy rows seeded.
- [ ] RLS enabled + forced on every table, with policies covering read + write per role.
- [ ] PostgREST exposes `course-agent`.
- [ ] Google SSO + magic link both work on `/login`.
- [ ] Middleware redirects unauthenticated traffic to `/login`; admin-only routes 403 reviewers.
- [ ] Two `lib/supabase/*.ts` clients exist; engine has its own `supabase.py`.
- [ ] `mockCurrentReviewer` no longer imported anywhere; sidebar shows the real session.
- [ ] Acceptance table above all green.
- [ ] Commit on `main`, branch protection still happy.

--
-- Migration 0001 — initial schema for the Edstellar Course Discovery Agent.
--
-- Creates the "course-agent" schema and everything in it: extensions,
-- tables, indexes, the categories_with_counts view, an is_admin() helper,
-- and Row-Level Security (enabled + forced) with per-table policies.
--
-- Idempotent. Drop + recreate by:
--
--     drop schema if exists "course-agent" cascade;
--     drop function if exists "course-agent".is_admin() cascade;
--     -- then run this file
--
-- The hyphen in "course-agent" forces quoting everywhere. There is no
-- search_path shortcut that survives a security definer function; the
-- explicit qualification is deliberate.
--

-- ─── Schema + grants ─────────────────────────────────────────────────
create schema if not exists "course-agent";

grant usage on schema "course-agent" to anon, authenticated, service_role;
grant all   on schema "course-agent" to service_role;

alter default privileges in schema "course-agent"
  grant select on tables to authenticated;
alter default privileges in schema "course-agent"
  grant all on tables to service_role;

-- ─── Extensions ──────────────────────────────────────────────────────
-- Installed into the "extensions" schema (Supabase convention) so
-- upgrades stay outside our migration plate.
create extension if not exists vector    with schema extensions;
create extension if not exists pgcrypto  with schema extensions;


-- ─── Tables ──────────────────────────────────────────────────────────

-- courses: Edstellar's existing catalogue. Read-only for the agent.
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


-- categories: curated taxonomy with target counts + demand signal.
-- course_count is not stored — the §3.1 spec's "generated as (select
-- count(*) ...) stored" isn't supported in Postgres (no subqueries in
-- generated columns). The categories_with_counts view below provides
-- the join-on-read equivalent.
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


-- categories_with_counts: replaces the unimplementable generated column.
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


-- rejection_taxonomy: the 11-row reference table for the reject modal.
-- Seeded in 0002.
create table if not exists "course-agent".rejection_taxonomy (
  key         text primary key,
  label       text not null,
  description text not null,
  rare        boolean default false,
  sort_order  int default 0,
  created_at  timestamptz default now()
);


-- prompt_versions: every agent run records which prompt + model it used.
create table if not exists "course-agent".prompt_versions (
  id              uuid primary key default gen_random_uuid(),
  version         int not null,
  model_slug      text not null,
  system_prompt   text not null,
  status          text not null
                    check (status in ('active', 'candidate', 'retired')),
  approval_rate   numeric,
  runs_observed   int default 0,
  notes           text,
  created_at      timestamptz default now()
);

create unique index if not exists prompt_versions_version_uq
  on "course-agent".prompt_versions (version);


-- agent_runs: one row per nightly pipeline execution.
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


-- suggestions: agent-produced candidates awaiting human review.
--
-- The price > 2500 and delivery_format = 'instructor-led' constraints
-- enforce two of the 10 rules at the database layer — anything that
-- slips past the agent's rule engine still fails here.
--
-- "references" is a SQL reserved word; it's quoted in DDL but addressed
-- as `references` over PostgREST without quotes.
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
                          check (status in ('pending_review', 'approved',
                                            'rejected', 'needs_revision')),
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


-- feedback: one row per reviewer action (approve / reject / needs revision).
create table if not exists "course-agent".feedback (
  id              uuid primary key default gen_random_uuid(),
  suggestion_id   uuid not null
                    references "course-agent".suggestions(id) on delete cascade,
  decision        text not null
                    check (decision in ('approved', 'rejected', 'needs_revision')),
  reason_tags     text[] not null default '{}',
  reason_text     text,
  reviewer_id     uuid not null references auth.users(id),
  created_at      timestamptz default now()
);

create index if not exists feedback_suggestion_idx
  on "course-agent".feedback (suggestion_id);

create index if not exists feedback_reviewer_idx
  on "course-agent".feedback (reviewer_id);


-- ─── Role helper ─────────────────────────────────────────────────────
-- is_admin() reads from auth.users.app_metadata.role (server-set,
-- trustworthy). raw_user_meta_data is user-controllable via the public
-- Auth API and must never be the source of authority.
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

revoke all on function "course-agent".is_admin() from public;
grant execute on function "course-agent".is_admin() to anon, authenticated, service_role;


-- ─── Row-Level Security ──────────────────────────────────────────────
-- `force` ensures the table owner (our migration role) also respects
-- the policies — without it, a policy can look right in Studio and
-- silently fail for every real user.

alter table "course-agent".courses             enable row level security;
alter table "course-agent".courses             force  row level security;
alter table "course-agent".categories          enable row level security;
alter table "course-agent".categories          force  row level security;
alter table "course-agent".rejection_taxonomy  enable row level security;
alter table "course-agent".rejection_taxonomy  force  row level security;
alter table "course-agent".prompt_versions     enable row level security;
alter table "course-agent".prompt_versions     force  row level security;
alter table "course-agent".agent_runs          enable row level security;
alter table "course-agent".agent_runs          force  row level security;
alter table "course-agent".suggestions         enable row level security;
alter table "course-agent".suggestions         force  row level security;
alter table "course-agent".feedback            enable row level security;
alter table "course-agent".feedback            force  row level security;


-- ── courses ─────────────────────────────────────────────────────────
drop policy if exists courses_select       on "course-agent".courses;
drop policy if exists courses_admin_write  on "course-agent".courses;

create policy courses_select on "course-agent".courses
  for select to authenticated using (true);

create policy courses_admin_write on "course-agent".courses
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());


-- ── categories ──────────────────────────────────────────────────────
drop policy if exists categories_select       on "course-agent".categories;
drop policy if exists categories_admin_write  on "course-agent".categories;

create policy categories_select on "course-agent".categories
  for select to authenticated using (true);

create policy categories_admin_write on "course-agent".categories
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());


-- ── rejection_taxonomy ──────────────────────────────────────────────
drop policy if exists rejection_taxonomy_select       on "course-agent".rejection_taxonomy;
drop policy if exists rejection_taxonomy_admin_write  on "course-agent".rejection_taxonomy;

create policy rejection_taxonomy_select on "course-agent".rejection_taxonomy
  for select to authenticated using (true);

create policy rejection_taxonomy_admin_write on "course-agent".rejection_taxonomy
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());


-- ── prompt_versions ─────────────────────────────────────────────────
drop policy if exists prompt_versions_admin_all on "course-agent".prompt_versions;

create policy prompt_versions_admin_all on "course-agent".prompt_versions
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());


-- ── agent_runs ──────────────────────────────────────────────────────
drop policy if exists agent_runs_select on "course-agent".agent_runs;

create policy agent_runs_select on "course-agent".agent_runs
  for select to authenticated using (true);
-- Writes are service-role only; service-role bypasses RLS so no
-- explicit insert/update policy is needed.


-- ── suggestions ─────────────────────────────────────────────────────
-- Reads: every authenticated reviewer.
-- Writes (status update): every reviewer can move a suggestion to one
--   of the three terminal statuses; column-level tightening lands in
--   Phase 5 with the assignee_id column.
-- Writes (everything else): admin only.
-- Inserts: agent (service-role) only.
drop policy if exists suggestions_select           on "course-agent".suggestions;
drop policy if exists suggestions_admin_update     on "course-agent".suggestions;
drop policy if exists suggestions_reviewer_update  on "course-agent".suggestions;

create policy suggestions_select on "course-agent".suggestions
  for select to authenticated using (true);

create policy suggestions_admin_update on "course-agent".suggestions
  for update to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());

create policy suggestions_reviewer_update on "course-agent".suggestions
  for update to authenticated
  using (true)
  with check (status in ('approved', 'rejected', 'needs_revision'));


-- ── feedback ────────────────────────────────────────────────────────
-- Reviewers can insert their own rows only; nobody updates a feedback
-- row (audit-log shape); everyone reads.
drop policy if exists feedback_insert on "course-agent".feedback;
drop policy if exists feedback_select on "course-agent".feedback;

create policy feedback_insert on "course-agent".feedback
  for insert to authenticated
  with check (reviewer_id = auth.uid());

create policy feedback_select on "course-agent".feedback
  for select to authenticated using (true);

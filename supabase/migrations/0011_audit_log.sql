--
-- Migration 0011 — admin action audit log (Phase 9 Step 5).
--
-- Every write to admin-controlled state (prompt promote/retire,
-- category upsert, future digest-recipient adds, etc.) writes a
-- companion row here so we can answer "who changed what, when?"
-- without spelunking through Supabase auth logs.
--
-- Reviewer-side actions (approve / reject / needs_revision) already
-- land in feedback; this table is exclusively for admin actions.
--
-- Idempotent — safe to re-run after a clean drop. The
-- "course-agent" schema and is_admin() helper from migration 0001
-- are assumed to exist.
--

create table if not exists "course-agent".audit_log (
  id          uuid primary key default extensions.gen_random_uuid(),
  actor_id    uuid not null references auth.users(id),
  action      text not null,
  target_type text not null,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_actor_idx
  on "course-agent".audit_log (actor_id);
create index if not exists audit_log_action_idx
  on "course-agent".audit_log (action);
create index if not exists audit_log_created_idx
  on "course-agent".audit_log (created_at desc);

-- RLS: read-allowed for any signed-in reviewer; writes are
-- service-role only (no insert/update policy means the table is
-- closed to authenticated/anon writers). logAdminAction() in
-- app/src/lib/audit.ts uses the service-role client.
alter table "course-agent".audit_log enable row level security;
alter table "course-agent".audit_log force row level security;

drop policy if exists audit_log_select on "course-agent".audit_log;
create policy audit_log_select
  on "course-agent".audit_log
  for select
  to authenticated
  using (true);

comment on table "course-agent".audit_log is
  'Admin action trail. Reviewer-scoped reads, service-role writes only.';

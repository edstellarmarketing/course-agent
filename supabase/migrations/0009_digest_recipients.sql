--
-- Migration 0009 — digest_recipients table.
--
-- Phase 8 Step 10. Replaces the hard-coded reviewer-email array in
-- app/src/lib/email/recipients.ts. Admins manage the list via SQL
-- for now; a /settings admin UI is Phase 9 work.
--
-- `assigned_categories` is null = "send everything". Non-null array
-- means the daily digest is filtered to runs that targeted at least
-- one of these categories. Phase 8 wires the table; the digest send
-- treats null as "all" and ignores the filter for non-null until
-- Phase 9 actually consumes it (keeps Step 10 small).
--
-- RLS: admin-only writes via the existing is_admin() helper. Reads
-- are admin-only too (recipient list = audit data; reviewers don't
-- need to see who else gets the digest).
--
-- Idempotent re-application: create-if-not-exists + insert with
-- on-conflict-do-nothing on the unique email column.
--
-- Apply via Supabase Studio SQL Editor.
--

create table if not exists "course-agent".digest_recipients (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique not null,
  is_active           boolean not null default true,
  assigned_categories text[],     -- null = receives all categories
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists digest_recipients_active_idx
  on "course-agent".digest_recipients (is_active);

alter table "course-agent".digest_recipients enable row level security;
alter table "course-agent".digest_recipients force  row level security;

drop policy if exists digest_recipients_admin_all on "course-agent".digest_recipients;
create policy digest_recipients_admin_all on "course-agent".digest_recipients
  for all to authenticated
  using ("course-agent".is_admin())
  with check ("course-agent".is_admin());

-- Phase 7's hard-coded default. Idempotent — re-running does nothing.
insert into "course-agent".digest_recipients (email, notes)
  values (
    'marketing@edstellar.com',
    'Phase 7 hard-coded default; migrated here in Phase 8 Step 10.'
  )
on conflict (email) do nothing;

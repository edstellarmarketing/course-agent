--
-- Migration 0012 — relax audit_log.actor_id to nullable.
--
-- Phase 9 Step 8 ships an engine-side script (auto_promote.py)
-- that writes audit_log rows from a service-role context with no
-- signed-in human caller. The Phase 9 doc accepted two options
-- for that case: a "system" pseudo-user in auth.users, or
-- nullable actor_id with the action label carrying the origin.
-- The nullable path is the smaller surface — no magic user row
-- to maintain, no extra is_admin() carve-out — so we go with that.
--
-- App-side writes from logAdminAction() always supply a real
-- actor_id (the helper returns early when no reviewer is signed
-- in), so this loosens engine access without weakening the audit
-- trail for admin UI actions.
--
-- Idempotent: the alter statement is a no-op if actor_id is
-- already nullable.
--

alter table "course-agent".audit_log
  alter column actor_id drop not null;

comment on column "course-agent".audit_log.actor_id is
  'auth.users.id when the actor is a signed-in reviewer; NULL when '
  'the row was written by an engine-side script (action label '
  'carries the origin, e.g. prompt.auto_promote).';

-- Migration 0005 — grant write privileges to the `authenticated` role.
--
-- Migration 0001 set up `alter default privileges ... grant select on
-- tables to authenticated` so signed-in users can read every table in
-- the schema. But the default privilege was only SELECT, so every
-- INSERT/UPDATE/DELETE from a signed-in user hits PostgreSQL with
-- "permission denied for table X" (SQLSTATE 42501) — long before RLS
-- gets a chance to evaluate the per-row policy.
--
-- The Supabase convention is to grant the verbs broadly to
-- `authenticated` and rely on RLS policies (which migration 0001 also
-- set up) to filter rows. That's the pattern we adopt here.
--
-- Idempotent. Safe to re-run.

-- ─── categories ──────────────────────────────────────────────────────
-- Admins create + edit categories; reviewers only read (RLS enforces).
grant insert, update on "course-agent".categories to authenticated;

-- ─── suggestions ─────────────────────────────────────────────────────
-- Reviewers update status (approve / reject / needs_revision);
-- the engine inserts via service-role, which bypasses RLS.
grant update on "course-agent".suggestions to authenticated;

-- ─── feedback ────────────────────────────────────────────────────────
-- Reviewers insert one row per decision; nothing else mutates.
grant insert on "course-agent".feedback to authenticated;

-- ─── prompt_versions ─────────────────────────────────────────────────
-- Admin-only; RLS policy `prompt_versions_admin_all` already gates
-- by role.
grant insert, update, delete on "course-agent".prompt_versions
  to authenticated;

-- courses and agent_runs deliberately stay SELECT-only for signed-in
-- users — every write to those tables comes from the engine via the
-- service-role client, which bypasses both GRANT and RLS.

--
-- Migration 0013 — grant insert/update/delete on digest_recipients
-- to the authenticated role.
--
-- Bug from migration 0009: the table was created with RLS + an
-- admin-only policy (`digest_recipients_admin_all`), but no GRANTs
-- for insert/update/delete were added for the `authenticated` role.
-- Postgres checks GRANTs BEFORE evaluating RLS, so an admin user
-- attempting an insert from the Server Action got:
--
--     permission denied for table digest_recipients
--
-- ...instead of either succeeding (admin path) or being silently
-- rejected by RLS (non-admin path).
--
-- This migration adds the missing GRANTs. The RLS policy keeps
-- doing its job — only is_admin() reviewers can actually write
-- (the GRANT is necessary but not sufficient).
--
-- Idempotent: GRANT statements are no-ops when the privilege is
-- already present.
--

grant insert, update, delete on "course-agent".digest_recipients
  to authenticated;

-- Same fix shape as migration 0005, which did this for
-- prompt_versions / categories / suggestions when those tables
-- were originally given the same admin-only policy.

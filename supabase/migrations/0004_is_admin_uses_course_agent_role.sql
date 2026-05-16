-- Migration 0004 — keep is_admin() in lockstep with the app code.
--
-- Phase 3 Step 6 created is_admin() reading `app_metadata.role` per the
-- original phase3.md design. In Phase 3 Step 12 the app code switched
-- to `app_metadata.course_agent_role` so it wouldn't collide with the
-- sibling apps (Marketing-PM-Tool, eggdrop, trainerportal, etc.) that
-- share this Supabase. is_admin() needs the same namespacing or every
-- admin write silently fails RLS (Supabase returns 0 rows affected and
-- no error envelope, which is the worst possible failure mode).
--
-- security definer + empty search_path is preserved from the original
-- so an attacker controlling search_path can't shadow auth.jwt().

create or replace function "course-agent".is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'course_agent_role') = 'admin',
    false
  );
$$;

--
-- Migration 0010 — suggestions.assignee_id + RLS update.
--
-- Phase 8 Step 10. Reviewers will see only suggestions assigned to
-- them OR unassigned ones. Admins continue to see everything.
-- Phase 5's race-safe Server Actions stay unchanged — they only
-- write the status transition; this migration only filters what's
-- visible / what reviewers can act on.
--
-- The reviewer-update RLS policy is REPLACED (not extended) so the
-- new visibility rule applies cleanly. The existing
-- suggestions_admin_update policy stays — admins keep full update.
--
-- ON DELETE SET NULL on the FK to auth.users: if a reviewer is
-- deleted (rare), their assigned suggestions don't cascade-delete;
-- they just become unassigned.
--
-- Apply via Supabase Studio SQL Editor.
--

alter table "course-agent".suggestions
  add column if not exists assignee_id uuid
  references auth.users(id) on delete set null;

create index if not exists suggestions_assignee_idx
  on "course-agent".suggestions (assignee_id);

-- Drop + recreate the reviewer-update policy with the new
-- visibility predicate. is_admin() short-circuits before the
-- assignee check — admins keep full write regardless of
-- assignment.
drop policy if exists suggestions_reviewer_update on "course-agent".suggestions;

create policy suggestions_reviewer_update on "course-agent".suggestions
  for update to authenticated
  using (
    "course-agent".is_admin()
    OR assignee_id is null
    OR assignee_id = auth.uid()
  )
  with check (status in ('approved', 'rejected', 'needs_revision'));

-- SELECT policy stays: every authenticated reviewer can READ every
-- suggestion (per Phase 1 / 5 design — the audit trail must be
-- visible across the team). The /suggestions/today page filters
-- client-side via .or() so a reviewer's queue UI only shows their
-- own + unassigned rows; admins skip that filter in the page code.

--
-- Migration 0008 — suggestions.parent_id self-reference.
--
-- Phase 8 Step 5. When a reviewer marks a candidate "needs_revision"
-- with a note (e.g. "pitch at CFOs, not engineering leaders"), the
-- next agent run targeting the same category runs a focused retry
-- call with the original candidate + the note as targeted re-prompt
-- context. The rewritten candidate persists as a NEW row whose
-- parent_id points back to the original; the original stays
-- status='needs_revision' so the audit trail on the detail page
-- still tells the story.
--
-- ON DELETE SET NULL — if the parent gets deleted (admin cleanup,
-- never in normal flow), the child survives but loses its lineage
-- pointer rather than cascade-deleting.
--
-- Idempotent: add column + index only when missing.
--

alter table "course-agent".suggestions
  add column if not exists parent_id uuid
  references "course-agent".suggestions(id) on delete set null;

create index if not exists suggestions_parent_idx
  on "course-agent".suggestions (parent_id);

-- The existing reviewer-update RLS policy allows status transitions
-- to (approved, rejected, needs_revision). Children rows produced
-- by the retry path are persisted by the engine's service-role
-- client, so RLS doesn't gate the INSERT — service-role bypasses
-- it. No policy change needed for Step 5.

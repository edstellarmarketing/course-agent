--
-- Migration 0002 — seed the rejection_taxonomy table.
--
-- Eleven rows, matching the RejectionTagKey union in
-- app/src/lib/types.ts. The Phase 1 mock fixture in
-- app/src/lib/mock/rejection-taxonomy.ts mirrors the same content —
-- once Phase 5 wires the reject modal to this table, the mock file
-- can be deleted.
--
-- Idempotent via `on conflict (key) do update` — re-running this
-- migration after a label or description tweak applies the change
-- without producing duplicates.
--
-- sort_order controls how the modal ranks chips (lowest first). The
-- two "rare" tags (certification_name_used, other) sit at the bottom
-- of the primary list per §3.8a of the architectural plan.
--

insert into "course-agent".rejection_taxonomy
  (key, label, description, rare, sort_order)
values
  ('already_exists',
   'Already exists',
   'Duplicate of a course we already offer.',
   false, 10),

  ('near_duplicate_within_batch',
   'Near duplicate in batch',
   'Too similar to another suggestion in today''s batch.',
   false, 20),

  ('not_instructor_led_market',
   'Not instructor-led in market',
   'Topic only exists as e-learning / self-paced in the real world.',
   false, 30),

  ('price_unrealistic',
   'Price unrealistic',
   'Proposed price isn''t defensible by the market evidence.',
   false, 40),

  ('topic_outdated',
   'Topic outdated',
   'Once-popular topic now declining; weak forward demand.',
   false, 50),

  ('too_niche',
   'Too niche',
   'Audience too small to be a viable B2B program.',
   false, 60),

  ('wrong_category',
   'Wrong category',
   'Category mapping is incorrect.',
   false, 70),

  ('weak_references',
   'Weak references',
   'Citations are low-quality, off-topic, or unverifiable.',
   false, 80),

  ('not_corporate_relevant',
   'Not corporate-relevant',
   'Consumer or hobbyist topic, not enterprise training.',
   false, 90),

  ('certification_name_used',
   'Certification name used',
   'Title references a specific credential or certifying body.',
   true, 100),

  ('other',
   'Other',
   'Requires a free-text explanation below.',
   true, 110)
on conflict (key) do update set
  label       = excluded.label,
  description = excluded.description,
  rare        = excluded.rare,
  sort_order  = excluded.sort_order;

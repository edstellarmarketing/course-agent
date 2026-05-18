--
-- Migration 0014 — Phase 9 reviewer feedback: richer suggestion fields.
--
-- Six new nullable columns to support the reviewer-feedback round.
-- All nullable so existing rows (before the prompt v6 rollout) keep
-- rendering — the UI hides empty sections rather than throwing.
--
--   content_outline    jsonb   structured curriculum (item 1)
--                              shape: [{module, topics: [...]}, ...]
--   duration_hours_min int     replaces duration_days for new rows
--                              (item 2). duration_days kept as-is for
--                              legacy compatibility; agent stops
--                              populating it going forward.
--   duration_hours_max int     upper bound of the hours range (item 2)
--   package_fit        jsonb   Edstellar-package recommendation (item 3)
--                              shape: {
--                                licenses_per_batch_of_10: int,
--                                license_math: str,
--                                primary_package: "Starter"|"Growth"|
--                                                 "Enterprise"|"Custom",
--                                package_rationale: str
--                              }
--   lab_requirements   jsonb   what tech / accounts / tools are needed
--                              to deliver labs (item 5). Null or
--                              {required:false,...} when course is
--                              theory-only.
--                              shape: {
--                                required: bool,
--                                platforms: [str],
--                                tools: [str],
--                                notes: str
--                              }
--   edstellar_pitch    text    2-3 sentence Edstellar-specific
--                              business case (item 6) — distinct from
--                              `rationale` so reviewers can scan pitches
--                              across the queue.
--
-- Items 4 (version-awareness) is a prompt-only change; no schema
-- footprint.
--
-- Idempotent. Apply via Supabase Studio SQL Editor.
--

alter table "course-agent".suggestions
  add column if not exists content_outline    jsonb,
  add column if not exists duration_hours_min int,
  add column if not exists duration_hours_max int,
  add column if not exists package_fit        jsonb,
  add column if not exists lab_requirements   jsonb,
  add column if not exists edstellar_pitch    text;

comment on column "course-agent".suggestions.content_outline is
  'Structured curriculum: [{module, topics: [...]}, ...]. Populated by agent v6+; null on older rows.';
comment on column "course-agent".suggestions.duration_hours_min is
  'Lower bound of the duration range in hours (e.g. 16 in "16-24 Hrs"). Agent v6+ uses this instead of duration_days.';
comment on column "course-agent".suggestions.duration_hours_max is
  'Upper bound of the duration range in hours (e.g. 24 in "16-24 Hrs").';
comment on column "course-agent".suggestions.package_fit is
  'Edstellar package recommendation: {licenses_per_batch_of_10, license_math, primary_package, package_rationale}. Agent maps the course to one of Starter / Growth / Enterprise / Custom based on license consumption.';
comment on column "course-agent".suggestions.lab_requirements is
  '{required: bool, platforms: [str], tools: [str], notes: str}. Null or required=false for theory-only courses.';
comment on column "course-agent".suggestions.edstellar_pitch is
  'Edstellar-POV business case: catalogue gap + competitive fit + buyer match. 2-3 sentences.';

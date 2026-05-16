-- Migration 0003 — unique index on courses.num for idempotent imports.
--
-- The legacy course catalogue uses `num` as the stable row identifier
-- (the canonical position in Edstellar_Intelligence_Hub_Verified.html).
-- `link` would have been the intuitive natural key, but the source data
-- has 7 duplicate links across distinct courses (mostly placeholder
-- /category/* URLs and a couple of /course/* collisions), so we anchor
-- the import on num instead.
--
-- Idempotent. Safe to re-run.

create unique index if not exists courses_num_uq
  on "course-agent".courses (num);

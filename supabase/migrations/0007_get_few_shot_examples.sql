--
-- Migration 0007 — get_few_shot_examples() SQL function.
--
-- Phase 8 Step 3. Architectural plan §3.8(b)(3): per targeted
-- category, the research prompt is augmented with the K most recent
-- approvals AND one representative rejection per tag. Pushing the
-- JOIN + GROUP BY work down to Postgres keeps the engine code
-- simple — it just consumes the JSON rows.
--
-- Behaviour:
--   - kind='approval': up to K most recent suggestion+feedback pairs
--     where decision='approved' and suggestion.category = $category.
--   - kind='rejection': for each distinct tag in
--     feedback.reason_tags across rejections in $category, the most
--     recent suggestion+feedback pair carrying that tag. One row per
--     tag — keeps the prompt's negative examples diverse rather than
--     loading up on whichever rejection reason happens to dominate.
--
-- Idempotent. Re-running drops and recreates the function with the
-- same signature.
--
-- Run from Supabase Studio SQL Editor.
--

create or replace function "course-agent".get_few_shot_examples(
  category_name text,
  k             int default 5
)
returns table (
  kind          text,
  title         text,
  rationale     text,
  tag           text,        -- single tag for rejection rows; null for approvals
  reason_text   text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Most recent approvals in the category.
  ( select
      'approval'::text                       as kind,
      s.title,
      s.rationale,
      null::text                             as tag,
      f.reason_text,
      f.created_at
    from "course-agent".suggestions s
    join "course-agent".feedback   f on f.suggestion_id = s.id
    where s.category = category_name
      and f.decision = 'approved'
    order by f.created_at desc
    limit k )

  union all

  -- One most-recent rejection per tag in the category. We unnest
  -- reason_tags so a single feedback row with two tags surfaces
  -- under each — the most recent feedback within each tag wins
  -- (distinct on (tag) + order by tag, created_at desc).
  ( select distinct on (unnested_tag)
      'rejection'::text                      as kind,
      s.title,
      s.rationale,
      unnested_tag                           as tag,
      f.reason_text,
      f.created_at
    from "course-agent".suggestions s
    join "course-agent".feedback   f on f.suggestion_id = s.id,
         lateral unnest(f.reason_tags) as unnested_tag
    where s.category = category_name
      and f.decision = 'rejected'
    order by unnested_tag, f.created_at desc );
$$;

revoke all on function "course-agent".get_few_shot_examples(text, int) from public;
grant execute on function "course-agent".get_few_shot_examples(text, int)
  to authenticated, service_role;

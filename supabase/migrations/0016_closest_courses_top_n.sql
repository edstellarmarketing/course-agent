-- Migration 0016 — closest_courses_for_suggestions returns top N.
--
-- 0015 returned the single best match per suggestion (LIMIT 1) and the
-- "Closest existing course" panel always showed one course. Reviewers
-- want to see the next-best couple of matches too — pricing surveys,
-- title variants, near-duplicates the agent didn't catch — so we bump
-- the per-suggestion limit to N (default 3, caller can override).
--
-- Signature change: appends a new optional `match_limit int default 3`.
-- supabase-js .rpc() honours defaults, so callers that haven't passed
-- it yet keep working — they just get a bigger result set per id.

create or replace function "course-agent".closest_courses_for_suggestions(
  suggestion_ids uuid[],
  match_limit int default 3
)
returns table (
  suggestion_id uuid,
  course_id uuid,
  course_num integer,
  course_name text,
  course_category text,
  course_subcategory text,
  course_link text,
  similarity real
)
language sql
stable
security invoker
-- pgvector's `<=>` cosine operator lives in `extensions`; everything
-- inside the body remains schema-qualified.
set search_path = 'extensions'
as $$
  select
    s.id as suggestion_id,
    c.id as course_id,
    c.num as course_num,
    c.name as course_name,
    c.category as course_category,
    c.subcategory as course_subcategory,
    c.link as course_link,
    (1 - (c.embedding <=> s.embedding))::real as similarity
  from "course-agent".suggestions s
  cross join lateral (
    select c.id, c.num, c.name, c.category, c.subcategory, c.link, c.embedding
    from "course-agent".courses c
    where c.embedding is not null
    order by c.embedding <=> s.embedding
    limit greatest(match_limit, 1)
  ) c
  where s.id = any(suggestion_ids)
    and s.embedding is not null;
$$;

revoke all on function "course-agent".closest_courses_for_suggestions(uuid[], int) from public;
grant execute on function "course-agent".closest_courses_for_suggestions(uuid[], int)
  to authenticated, service_role;

-- The 0015 single-arg variant still exists in the catalog. Dropping it
-- avoids ambiguity for callers that don't pass match_limit (Postgres
-- would otherwise have to pick between the two overloads).
drop function if exists "course-agent".closest_courses_for_suggestions(uuid[]);

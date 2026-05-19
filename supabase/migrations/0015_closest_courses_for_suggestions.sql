-- Migration 0015 — closest_courses_for_suggestions RPC.
--
-- Powers the "Closest existing course" panel on /suggestions/today and
-- /suggestions/[id]. Originally that panel was hardcoded `null` (a Phase 6
-- TODO that never landed); reviewers couldn't see near-duplicates that
-- Rule 2 didn't reject because the cosine score was 0.65–0.85.
--
-- One call, N suggestions. The LATERAL join lets Postgres' planner use
-- the existing `courses_embedding_ivfflat_idx` for each per-suggestion
-- top-1 lookup. Returns no row for suggestions whose embedding is NULL
-- (older runs pre-Phase 6, or any row backfill missed).

create or replace function "course-agent".closest_courses_for_suggestions(
  suggestion_ids uuid[]
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
-- pgvector's `<=>` cosine operator lives in `extensions`; the empty
-- search_path elsewhere in the codebase hides it. We still schema-
-- qualify every table reference inside the body so this opens up
-- only the operator namespace, not random tables.
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
    limit 1
  ) c
  where s.id = any(suggestion_ids)
    and s.embedding is not null;
$$;

revoke all on function "course-agent".closest_courses_for_suggestions(uuid[]) from public;
grant execute on function "course-agent".closest_courses_for_suggestions(uuid[])
  to authenticated, service_role;

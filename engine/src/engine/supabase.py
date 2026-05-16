"""Supabase client for the course-agent engine.

Service-role only. The engine reads inventory + feedback and writes
suggestions + agent_runs — there is no user-scoped path inside the
engine, so we don't bother with the anon/session client variants.

The client is cached at module level via ``lru_cache`` so every call
site shares the same HTTP keep-alive pool. ``schema="course-agent"``
binds every query to our schema by default; cross-schema reads (e.g.
``auth.users``) need the explicit ``.schema()`` override.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, ClientOptions, create_client

from engine.config import settings


@lru_cache(maxsize=1)
def supabase() -> Client:
    cfg = settings()
    return create_client(
        str(cfg.supabase_url),
        cfg.supabase_service_role_key,
        options=ClientOptions(schema="course-agent"),
    )

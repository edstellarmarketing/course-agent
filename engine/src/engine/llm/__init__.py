"""LLM + embedding client wrappers.

Phase 6 Step 4 adds the OpenRouter wrapper with retry-with-backoff,
token/cost tracking, and optional Langfuse spans. Voyage embedding
calls (already partially in scripts/embed_courses.py) get extracted
into ``voyage.py`` here as part of Step 8 / Step 6 Rule 2 work.
"""

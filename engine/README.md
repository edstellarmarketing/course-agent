# Edstellar Course Discovery Agent — Engine

The Python half of the Course Discovery Agent. Runs nightly, reads inventory and feedback from Supabase, calls OpenRouter + Voyage AI + Serper via ScrapeGraphAI, and writes vetted course suggestions back into Supabase for human review.

See `../docs/edstellar_course_discovery_agent_plan.md` §4 for the LangGraph node sequence and §3.6 for the rule engine. The build sequence is in `../docs/edstellar_agent_build_plan.md` (engine work begins in Phase 6).

## Quick start

```bash
cp .env.example .env      # fill in keys before running anything
uv sync                   # install runtime + dev deps
uv run engine             # invoke the entry point in src/engine/__init__.py
uv run python -c "print('ok')"
```

## Tooling

- **uv** — package manager (`uv add`, `uv sync`, `uv run`).
- **ruff** — `uv run ruff check . && uv run ruff format .`
- **mypy** — `uv run mypy src`
- **pytest** — `uv run pytest`

## Talking to the dashboard

The engine and the Next.js dashboard share **nothing** but Supabase. No HTTP calls between them (except the Phase 7 webhook to trigger the digest email). If you find yourself wanting to import code from `../app/`, stop and route it through the database instead.

# Edstellar Course Discovery Agent

A two-part system that surfaces high-quality, enterprise-grade corporate training courses Edstellar's reviewers can approve into the catalogue.

- **`app/`** — Next.js 14+ dashboard (TypeScript, Tailwind, shadcn/ui). Reviewers sign in here to triage daily suggestions.
- **`engine/`** — Python 3.13 agent pipeline (LangGraph + ScrapeGraphAI + OpenRouter + Voyage AI + Supabase pgvector). Runs nightly to produce candidates.
- **`docs/`** — Architectural plan, build sequence, UI mockups.

The two halves communicate only through Supabase. No shared code.

## Quick start

### Dashboard
```bash
cd app
pnpm install
pnpm dev          # http://localhost:3000
```

### Agent engine
```bash
cd engine
uv sync
uv run python -c "print('ok')"
```

## Build sequence

Follow `docs/edstellar_agent_build_plan.md`. Don't move to the next phase until the current one's acceptance criteria pass.

| Phase | Focus |
|------:|-------|
| 0 | Project init (this commit) |
| 1 | UI skeleton, no backend |
| 2 | Env & API key wiring |
| 3 | Supabase schema + auth |
| 4 | Replace mocks with real data |
| 5 | Review workflow end-to-end |
| 6 | Python agent pipeline |
| 7 | Email + Slack notifications |
| 8 | Closed feedback loop |
| 9 | Observability + hardening |

## Repo layout

```
course-agent/
├── app/          Next.js dashboard
├── engine/       Python agent
├── docs/         Plans + mockups
├── .gitignore
└── README.md
```

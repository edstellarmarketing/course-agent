# Edstellar Course Discovery Agent — Build Plan

This is the **build sequence** for the system specified in `edstellar_course_discovery_agent_plan.md`. The architectural plan is the *what*; this document is the *order in which to build it*.

Each phase has a clear acceptance criterion. Don't move to the next phase until the current one passes — earlier shortcuts compound expensively later.

---

## Build Sequence at a Glance

```
┌───────────────────────────────────────────────────────────────┐
│   PHASE 0  ·  Project Init                       ~ 1 day      │
│   Repos, tooling, design tokens                                │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 1  ·  UI Skeleton (no backend)           ~ 5–7 days   │
│   All seven screens render with mock data                      │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 2  ·  Environment & API Key Wiring       ~ 1–2 days   │
│   Every external service answers a smoke test                  │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 3  ·  Supabase Schema + Auth             ~ 3–4 days   │
│   Tables exist, RLS works, real login flow                     │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 4  ·  Replace Mocks with Real Data       ~ 4–5 days   │
│   Inventory + Categories pages query Supabase                  │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 5  ·  Review Workflow End-to-End         ~ 3–4 days   │
│   Approve / Reject / Needs-revision writes feedback            │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 6  ·  Python Agent Pipeline              ~ 7–10 days  │
│   Real suggestions land in Supabase overnight                  │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 7  ·  Email + Slack Notifications        ~ 1–2 days   │
│   Morning digest, run-complete pings                           │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 8  ·  Closed Feedback Loop               ~ 5–7 days   │
│   Negative memory, prompt versions, /learning admin            │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌───────────────────────────────────────────────────────────────┐
│   PHASE 9  ·  Observability + Hardening          ~ 3–4 days   │
│   Langfuse, Sentry, audit logs, monitoring alerts              │
└───────────────────────────────────────────────────────────────┘
```

Rough total: **4–6 weeks** of focused work for one full-stack engineer, or 3–4 weeks split between a frontend dev and an agent/backend dev working in parallel from Phase 4 onwards.

---

## Phase 0 · Project Initialisation

**Goal:** Two clean repositories with tooling configured. No business logic yet.

**Duration:** ~1 day

**Deliverables:**
- `edstellar-agent-app/` — Next.js 14+ repo with App Router, TypeScript, Tailwind CSS, shadcn/ui, ESLint, Prettier.
- `edstellar-agent-engine/` — Python 3.11+ repo with `uv` or `poetry`, ruff, mypy, pytest set up.
- Design tokens committed: navy / orange palette, Syne + DM Sans + JetBrains Mono fonts, shadcn theme config matching the mockup.
- README in each repo with setup instructions.
- `.env.example` in each repo listing required variables (values empty for now).
- `.gitignore` correctly excludes `.env.local`, `.env.*.local`, `node_modules`, `__pycache__`, etc.

**Acceptance:**
- `npm run dev` boots Next.js on localhost:3000 with a working "hello" page using Syne + DM Sans.
- `uv run python -c "print('ok')"` runs in the agent repo.
- Both repos are in version control (GitHub / GitLab) with branch protection on `main`.

**Watch out for:**
- Don't install agent dependencies into the Next.js app or vice versa — keep them separate. They communicate only through Supabase.
- Pin Node and Python versions in `.nvmrc` and `pyproject.toml` so the team is reproducible.

---

## Phase 1 · UI Skeleton (No Backend)

**Goal:** All seven screens from the mockup file render in Next.js using hardcoded JSON. The app is fully clickable but does nothing real yet.

**Duration:** ~5–7 days

**Why this first:** Front-loading the UI lets the team show progress quickly, surfaces design questions early, and means by the time the database is ready in Phase 3, every page already has a place for the real data to land.

**Deliverables:**

- App Router structure:
  ```
  app/
    layout.tsx               ← root layout with fonts, nav
    page.tsx                 ← redirects to /dashboard or /login
    login/page.tsx
    dashboard/page.tsx
    inventory/page.tsx
    categories/page.tsx
    categories/least-supplied/page.tsx
    suggestions/today/page.tsx
    suggestions/[id]/page.tsx
    history/page.tsx
    learning/page.tsx         ← admin only (gated later)
    settings/page.tsx
  ```
- Shared components built as shadcn primitives + custom compositions:
  - `<AppNav />`, `<KpiCard />`, `<SuggestionCard />`, `<CategoryCell />`, `<RejectModal />`, `<RuleBadge />` (the green pills), `<BrowserFrame />` for any preview contexts.
- Mock data lives in `lib/mock/` as typed TypeScript fixtures — the same shapes that will later come from Supabase, so the swap in Phase 4 is mechanical.
- Reject modal is fully wired client-side: tag selection, optional textarea, validation. It just doesn't call a real action yet.

**Acceptance:**
- Open localhost in a browser, click through every route in the mockup file.
- Reject modal opens, requires a tag selection, simulates a "submit" by closing.
- Lighthouse accessibility score ≥ 95 on every route.
- TypeScript strict mode passes with no `any` in shared component props.

**Watch out for:**
- Don't shortcut the data shapes — define the TypeScript types now to match the Supabase schema from §3.1 of the architectural plan. Mock data conforming to the wrong shape means rewriting components when real data arrives.
- Build `RejectModal` to accept the rejection-tag list as a prop, not as a hardcoded array — Phase 5 will source it from the `rejection_taxonomy` table.

---

## Phase 2 · Environment & API Key Wiring

**Goal:** Every external service in §5.1 of the architectural plan responds to a smoke test from each app. No business logic yet — just "the wires are plugged in."

**Duration:** ~1–2 days

**Why now:** Doing this in isolation, before any feature depends on it, means when something fails later you know it's not a config problem.

**Deliverables:**

- `.env.local` in `edstellar-agent-app/`:
  ```
  SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  GAS_EMAIL_WEBHOOK_URL=
  GAS_EMAIL_SHARED_SECRET=
  SLACK_WEBHOOK_URL=               # optional
  SENTRY_DSN=                       # optional
  ```
- `.env` in `edstellar-agent-engine/`:
  ```
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=
  OPENROUTER_API_KEY=
  VOYAGE_API_KEY=
  SERPER_API_KEY=
  LANGFUSE_PUBLIC_KEY=              # optional
  LANGFUSE_SECRET_KEY=              # optional
  LANGFUSE_HOST=                    # optional
  SENTRY_DSN=                       # optional
  ```
- **Env validation** with Zod (Next.js) and Pydantic Settings (Python) — fail loudly at startup if a required var is missing.
- `scripts/smoke-test.ts` in the Next.js app and `scripts/smoke_test.py` in the agent — both hit every configured service and print a green tick or red cross per service.

**Smoke test checklist:**
1. Supabase reachable — `select 1` query succeeds.
2. OpenRouter — single tiny completion (`{"model": "anthropic/claude-haiku-4.5", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5}`).
3. Voyage AI — embed the string `"ping"`, confirm vector of length 1024 returned.
4. Serper — single search for `"corporate training"`, confirm results.
5. Google Apps Script email — POST a test payload with the shared secret, confirm 200 response. **Do not actually send to a real user in this test; send to a sink address you control.**
6. Slack (if configured) — post a test message to the channel.

**Acceptance:**
- Both smoke-test scripts exit 0 and print a green tick for every required service.
- A deliberately missing key produces a clear "X_API_KEY is required" error, not a cryptic NPE deep in some library.

**Watch out for:**
- The Google Apps Script `doPost` you shared accepts anything posted to it. Before this phase ends, edit the script to require a shared-secret field — otherwise the URL is a public spam relay.
- OpenRouter routes some models through providers in specific regions. Test with the model you actually plan to use in production, not just the cheapest one.

---

## Phase 3 · Supabase Schema + Auth

**Goal:** The `course-agent` schema exists, all tables are created, RLS policies are in place, and the Next.js app's login flow works end-to-end with real Supabase Auth.

**Duration:** ~3–4 days

**Deliverables:**

- A SQL migration file (`supabase/migrations/0001_initial.sql`) that creates:
  - The `course-agent` schema and grants.
  - All tables from §3.1 of the architectural plan: `courses`, `categories`, `suggestions`, `feedback`, `rejection_taxonomy`, `prompt_versions`, `agent_runs`.
  - The pgvector extension and `ivfflat` indexes on embedding columns.
  - All FK constraints and CHECK constraints (especially `suggested_price_usd > 2500` and `delivery_format = 'instructor-led'`).
- A SQL seed file (`supabase/seed/rejection_taxonomy.sql`) that inserts the 11 tag rows from §3.8a (including `certification_name_used`).
- **RLS policies** on every table:
  - `courses` — admins read/write, reviewers read-only.
  - `suggestions` — agent service role inserts; reviewers read; reviewers update status only on their assigned queue.
  - `feedback` — reviewers insert their own rows only; everyone reads.
  - `categories` — admins write, reviewers read.
  - `prompt_versions` — admin-only.
- Supabase Auth configured: email magic-link + Google OAuth (using your workspace's OAuth credentials).
- **Two Supabase clients** in `lib/supabase/`:
  - `client.ts` — browser client with anon key, gated by RLS.
  - `server.ts` — server client with service-role key, for Server Actions that must bypass RLS (`agent_runs` writes, audit logs, etc.).
- Login flow wired in `/login`: real auth, real session, real redirect-on-success based on `auth.users.app_metadata.role`.
- Middleware protects every route except `/login`; admin-only routes (`/learning`, `/settings`) protected by role check.

**Acceptance:**
- Click "Continue with Google" on `/login`, end up signed in on `/dashboard`.
- A reviewer-role user trying to visit `/learning` is redirected with a 403 page.
- Manually inserting a fake suggestion into the database (via Supabase Studio) is invisible to the anon client — RLS blocks it — but visible to a logged-in reviewer's session.
- All migrations are idempotent (`drop schema "course-agent" cascade; <run migrations>` works cleanly).

**Watch out for:**
- The `course-agent` hyphen requires quoting in SQL: `"course-agent".courses`, not `course-agent.courses`. Set the search path explicitly in functions and policies.
- RLS policies for `suggestions` are the trickiest. Test with two different reviewer accounts to confirm row scoping works.
- Don't skip the seed file. Reviewers will hit a blank rejection modal in Phase 5 if `rejection_taxonomy` is empty.

---

## Phase 4 · Replace Mocks with Real Data

**Goal:** The Inventory and Categories pages query Supabase directly. The 1,623 courses are imported and embedded.

**Duration:** ~4–5 days

**Deliverables:**

- A one-off bulk import: `scripts/import_courses.ts` reads the existing courses (CSV or JSON), normalises them, and inserts into `course-agent.courses`. Idempotent (upsert on URL).
- A second one-off: `scripts/embed_courses.py` walks every row where `embedding IS NULL`, calls Voyage AI (`voyage-3-large`, `input_type="document"`), and writes the 1024-dim vector back. Run in batches of 128 to stay within rate limits.
- `/inventory` page replaced: Server Component fetches courses via Supabase, table renders the real data, search and filter work via URL params.
- `/categories` page replaced: aggregates `courses` by `category`, computes counts, joins to the `categories` table for `demand_score` and `is_pinned`. Heatmap colour-grades by under-supply score.
- `/categories/least-supplied` reuses the same query with an `ORDER BY` and `LIMIT 20`.

**Acceptance:**
- `/inventory` shows 1,623 rows. Search "Python" returns the Python course. Filter by "Cloud Computing" narrows correctly.
- `/categories` shows 43 cells. Pinning a category (admin action) immediately updates the visual marker.
- Every `courses` row has a non-null embedding of length 1024.
- A cosine-similarity query in Supabase Studio (`select id, name, 1 - (embedding <=> '[…]'::vector) as sim from "course-agent".courses order by sim desc limit 5;`) returns sensible nearest neighbours.

**Watch out for:**
- Voyage AI has a max input length per request. Truncate long course descriptions to ~8k characters before embedding, or batch-split.
- Importing 1,623 courses sequentially is slow. Use a server-side bulk insert (`upsert([...rows])`) in chunks of ~500.
- After embedding, run `vacuum analyze "course-agent".courses;` so the `ivfflat` index gets built properly.

---

## Phase 5 · Review Workflow End-to-End

**Goal:** Reviewers can act on suggestions. Approvals, rejections (with structured tags), and needs-revision all write to `feedback`. The agent doesn't exist yet, but the human side of the loop is fully functional.

**Duration:** ~3–4 days

**Deliverables:**

- A SQL seed file with ~10 realistic test suggestions inserted into `course-agent.suggestions` (across the under-supplied categories, all marked `pending_review`). These exist purely to give reviewers something to click on.
- `/suggestions/today` queries `suggestions where status = 'pending_review' and created_at >= today` (or the most recent run), renders cards in the order returned.
- Three Server Actions wired:
  - `approveSuggestion(id)` — updates `suggestions.status`, inserts a `feedback` row with `decision='approved'`.
  - `rejectSuggestion(id, tags[], reasonText)` — same, plus tags array, plus optional text.
  - `requestRevision(id, note)` — sets status `needs_revision`, inserts feedback with the note.
- Reject modal sources its tag list from `course-agent.rejection_taxonomy` via a Server Component.
- `/suggestions/[id]` detail view: full suggestion + its feedback audit trail.
- `/history` view with search, filter by decision, filter by reviewer.
- The Dashboard `/dashboard` page's recent-activity feed reads from `feedback`.

**Acceptance:**
- Reviewer signs in, clicks "Approve" on a suggestion. Status flips, suggestion disappears from queue, appears in history with the reviewer's name.
- Reviewer clicks "Reject", modal opens, attempting to submit with zero tags shows a validation error, submitting with one tag succeeds.
- Open the database directly — the `feedback` row exists with the correct reviewer_id, tags array, and timestamp.
- Two reviewers working in parallel don't see each other's queue items disappear (eventually consistent is fine; ghost-clicks should fail gracefully).

**Watch out for:**
- Server Actions need to use the **authenticated** Supabase client (the one bound to the user's session via cookies), not the service-role client. Mistakes here mean reviewers can write feedback as other users.
- Optimistic UI updates are nice but introduce sync bugs. Stick to "click → server action → re-fetch" for the MVP; optimistic comes later.

---

## Phase 6 · Python Agent Pipeline

**Goal:** A real agent run produces real suggestions and writes them to Supabase. Triggered manually for now; the daily scheduler comes in this phase too.

**Duration:** ~7–10 days — the biggest single phase.

**Deliverables (in build order):**

1. **State machine skeleton** (LangGraph). Define the node graph from §4 of the architectural plan: `feedback_ingest → inventory_read → gap_analyze → for_each_category[research → rule_engine] → cross_batch_dedupe → persist → notify`. Each node initially does nothing but log.

2. **Inventory reader.** Pulls `courses` and `categories` from Supabase. Caches embeddings in memory for the run.

3. **Gap analyzer.** Computes under-supply score per category. For Phase 1, demand_score defaults to a uniform value — real demand signals are a later add. Honours `is_pinned`.

4. **OpenRouter client wrapper.** Thin wrapper that takes a model slug + messages and returns the response. Includes retry-with-backoff and Langfuse trace hooks (no-op if Langfuse not configured).

5. **Research agent.** Per category, invokes ScrapeGraphAI's `SearchGraph` configured to use OpenRouter for its LLM backend and Serper for its search backend. Returns a list of raw candidates as JSON.

6. **Rule engine** — all 10 rules from §3.6 of the architectural plan, in this order:
   - Rule 3 (price > $2,500) and Rule 4 (instructor-led) — cheap rejects first.
   - Rule 6 (category mapping) — FK lookup.
   - Rule 10 (no certification names) — three-layer check: static blocklist file → regex → LLM judge (Haiku-tier model via OpenRouter).
   - Rule 7 (references) — for each URL, ScrapeGraphAI's `SmartScraperGraph` returns `{is_match, format, evidence}`.
   - Rule 2 (no existing inventory match) — Voyage embed the candidate, cosine vs. all courses, fuzzy title match.
   - Rule 9 (not a recent rejection) — cosine vs. last 90 days of rejected suggestions.
   - Rule 1 (intra-batch dedupe) — pairwise within the current run's surviving candidates.
   - Rule 5 (price basis ≥ 2 sources) and Rule 8 (global) — structural validation on the JSON.

7. **Persistence.** Surviving candidates are written to `suggestions` with status `pending_review`, run_id linking back to the new `agent_runs` row.

8. **Trigger.** A simple CLI: `python -m agent run --categories=auto --top-k=5`. Daily schedule via cron or Prefect comes once manual runs are reliable.

**Acceptance:**
- Manually trigger a run targeting one category (e.g., Data Privacy and Security). Run completes in under 10 minutes.
- 5–10 candidates are persisted, all passing every rule.
- A candidate that would have used a certification name (e.g., the agent's first instinct was "CIPP/E Certification Prep") was caught by Rule 10 and rejected internally — the surviving candidate has a neutral title like "European Data Privacy & GDPR Compliance for Enterprise Teams".
- Reviewers can log into the app the next morning and see the agent's suggestions in `/suggestions/today`.
- An `agent_runs` row exists with `categories_targeted`, `candidates_produced`, `candidates_persisted`, `started_at`, `finished_at`.

**Watch out for:**
- **Cost control.** The first runs will be expensive while you're tuning. Set monthly spend limits on the OpenRouter key. Log token usage per run in `agent_runs` so you can see what each run cost.
- **ScrapeGraphAI's failure modes.** Sometimes a target site blocks the scrape, sometimes a page returns JS-rendered emptiness. Build fallback paths: if `SearchGraph` returns zero candidates for a category, try plain Serper + a separate scrape step.
- **The certification blocklist needs maintenance.** Start with the list in Rule 10; expect to add to it as reviewers reject things the static check missed.
- **Rule order matters for cost.** Cheap structural checks (price, format) run before expensive ones (LLM judge, scraping references). A candidate that fails Rule 3 should never trigger Rule 7's scraping calls.

---

## Phase 7 · Email + Slack Notifications

**Goal:** Reviewers get a morning digest. The system can ping Slack when the pipeline finishes.

**Duration:** ~1–2 days

**Deliverables:**

- A Server Action in the Next.js app: `sendDailyDigest()` that:
  - Queries today's pending suggestions grouped by category.
  - Renders an HTML email (one card per suggestion summary, link to `/suggestions/today`).
  - POSTs to `GAS_EMAIL_WEBHOOK_URL` with `{to, subject, html, secret: GAS_EMAIL_SHARED_SECRET}`.
- Triggered by a webhook from the agent service: when the Python agent finishes a run, it POSTs to `https://agent.edstellar.com/api/internal/run-complete` (auth'd by a shared secret), which calls `sendDailyDigest()`.
- Optional Slack ping from the agent service directly on run completion.

**Acceptance:**
- Trigger a manual agent run. Within 30 seconds of completion, the reviewer's inbox has a digest email with today's suggestion count and a deep link to the queue.
- Clicking the link signs the user in (if needed) and lands on `/suggestions/today`.
- Email passes basic spam-filter tests (DKIM/SPF on the gmail account, no spammy phrases).

**Watch out for:**
- Don't send digests when the run produced zero candidates. The email needs to handle the empty-queue case gracefully ("No new suggestions today — agent skipped categories that were saturated").
- Apps Script has a daily quota (around 100 emails for free Gmail, 1,500 for Workspace). Calculate your max reviewers × max digests per day and check you're under the limit.

---

## Phase 8 · Closed Feedback Loop

**Goal:** The agent measurably improves over time. Rule 9 (negative memory) is live, few-shot examples are injected, prompt versions get A/B tested, and the `/learning` admin shows the trends.

**Duration:** ~5–7 days

**Deliverables:**

- **Negative memory.** Before each run, the agent pulls all `feedback` rows where `decision='rejected'` and `created_at > now() - interval '90 days'`. Embed them. Rule 9 now does a real vector check against this set.
- **Few-shot injection.** Per targeted category, the research prompt is augmented with the 5 most recent approvals and 5 representative rejections (with their tag and reason text). These come from a `get_few_shot_examples(category_name)` Supabase function that picks one representative example per rejection tag.
- **Per-category guardrails.** If `not_instructor_led_market` is the dominant rejection tag for a category, the prompt for that category gains a sentence: *"In this category, providers commonly offer only self-paced formats; only propose courses where you can cite a real instructor-led offering."* Implement this as a small lookup table that maps `(category, dominant_tag) → prompt_addendum`.
- **Prompt versioning.** A weekly job (`scripts/regenerate_prompt.py`) calls a top-tier model with the current prompt and the last week's rejection data, asks it to propose an improved version, saves the result to `prompt_versions` with status `candidate`. The next two runs A/B test candidate vs. current; the winner is promoted.
- `/learning` page built: approval-rate chart, rejection-reason distribution with month-over-month deltas, prompt version stack with win-rates, "Generate Next Prompt From Feedback" button.

**Acceptance:**
- Reject a suggestion with tag `topic_outdated` and reason "Bitcoin day trading is consumer-grade, not enterprise". The next day, the agent does not surface a similar suggestion — Rule 9 catches the near-duplicate.
- Open `/learning`. Approval rate over the last 4 weeks shows a measurable uptick. Repeat-rejection rate trends toward zero.
- Promote a new prompt version manually. The next run uses it. Two runs later, the win-rate metric reflects whether the new version is better.

**Watch out for:**
- 90 days of rejections will eventually be hundreds of vectors. Use Supabase's pgvector ANN index, not exact search.
- A/B tests need enough sample size to be meaningful. Two runs of 5 candidates each (10 total) is not statistically robust — be honest about the limitation in the `/learning` UI. Add a "needs more data" state.
- Don't auto-promote prompt versions without admin approval in the first month. Manual promotion via the `/learning` admin button is safer until you trust the metric.

---

## Phase 9 · Observability + Hardening

**Goal:** The system is production-ready: traced, monitored, alerted, backed up, documented.

**Duration:** ~3–4 days

**Deliverables:**

- **Langfuse tracing** wired into every OpenRouter call. Each agent run shows up as a trace tree with per-node spans. Cost is attributed per run, per category, per prompt version.
- **Sentry** in both apps. Unhandled errors in Server Actions and agent nodes go to Sentry with run_id and user_id tags.
- **Monitoring alerts.** A simple cron-driven check (or Sentry alert) fires if:
  - The daily agent run hasn't completed by 06:00.
  - Approval rate over the last 5 runs drops more than 10 percentage points week-over-week.
  - OpenRouter spend in the last 24h exceeds threshold.
- **Audit log** for admin actions: pinning categories, editing courses, promoting prompt versions, changing user roles. Writes to a separate `audit_log` table.
- **Backup strategy.** Document and verify: daily logical backup of the `course-agent` schema, retention policy, restore procedure tested at least once.
- **Runbook documentation:**
  - How to manually trigger an agent run.
  - How to roll back a prompt version.
  - What to do if reviewers' approval rate collapses.
  - How to add a new rejection tag.
  - How to update the Rule 10 certification blocklist.

**Acceptance:**
- A deliberately broken run (e.g., delete a required env var temporarily) fires the monitoring alert.
- Sentry catches a deliberately thrown error in a Server Action and shows the stack trace with user context.
- A restore drill: spin up a new Supabase instance from yesterday's backup, confirm data integrity.
- A new team member can read the runbook and trigger a manual agent run end-to-end without help.

---

## What's Deliberately Out of Scope for the Initial Build

These are valuable but should not delay the v1 launch:

- **Phase 3 demand signals** (SerpAPI Google Trends, Lightcast job-posting data). Bolt on once the basic loop is working.
- **Reviewer-personalised hints** (per-reviewer rejection probability prediction). Phase 3 from the architectural plan.
- **In-app agent chat** (e.g., a Strands-powered conversational layer for asking "find me more references for this candidate"). Genuine feature, but a separate later track.
- **Multi-language support.** Edstellar is global but the dashboard ships English-only for v1.
- **Mobile-optimised review.** The mockups are desktop-first. Reviewers can use the dashboard on a tablet, but native-quality mobile UX is a v2 concern.

---

## Quick-Reference Per-Phase Checklist

| Phase | Done when... |
|------|---------------|
| 0    | `npm run dev` and `uv run` both boot cleanly; both repos in version control. |
| 1    | All 7 routes click through with mock data; reject modal validates. |
| 2    | Both smoke-test scripts exit 0; every required service responds. |
| 3    | Login flow works; RLS blocks unauthorised reads; admin-only routes gated. |
| 4    | `/inventory` shows 1,623 real courses; `/categories` heatmap is live. |
| 5    | Approve/reject/needs-revision all write to `feedback` correctly. |
| 6    | A manual run produces 5–10 valid candidates in `suggestions` with no certification names. |
| 7    | Morning digest email arrives; deep link works. |
| 8    | Approval rate trends up; repeat-rejection rate trends to zero; `/learning` is live. |
| 9    | Tracing, alerts, backups, runbook all in place. |

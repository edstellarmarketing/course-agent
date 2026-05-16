# Edstellar Autonomous Course Discovery Agent — Implementation Plan

## 1. Objective

Build a Next.js application **and** an autonomous, self-improving agent that work together to:
- Maintain a single source of truth for Edstellar's training catalogue in **self-hosted Supabase** (≈1,623 courses across 43 categories and 98 subcategories today).
- Detect under-supplied categories from the live inventory.
- Research the global corporate training market and propose new courses for those categories.
- Enforce strict rules: no duplicates / near-duplicates, instructor-led only, target price > $2,500, mapped to an existing Edstellar category, with at least three credible provider references per suggestion.
- Surface suggestions in the Next.js dashboard where the Edstellar team logs in daily to approve or reject, with structured reasons.
- **Learn from every rejection** so the next day's output is measurably better.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Next.js Web App                            │
│              (Edstellar Team Dashboard)                     │
│                                                             │
│   • Login (Auth.js / Clerk)                                 │
│   • Inventory views: all courses, by category, least-20     │
│   • Today's Suggestions (Approve / Reject + Reason)         │
│   • History · Categories heatmap · Learning admin           │
└──────────────────────────┬──────────────────────────────────┘
                           │  (Server Actions / API routes)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            Self-Hosted Supabase (Postgres + pgvector)        │
│                                                              │
│   courses           ← MANAGED by Edstellar (read-only        │
│                       to the agent; the source of truth)     │
│   categories                                                 │
│   suggestions       ← WRITTEN by agent, REVIEWED in app      │
│   feedback          ← WRITTEN by app from reviewer actions   │
│   rejection_tags                                             │
│   prompt_versions                                            │
│   agent_runs                                                 │
└──────────────────────────▲───────────────────────────────────┘
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
┌────────────────────┐                ┌──────────────────────┐
│ Scheduler (daily)  │ ─────────────▶ │  Agent Pipeline       │
└────────────────────┘                │  • Inventory Reader   │
                                      │  • Gap Analyzer       │
                                      │  • Feedback Ingest    │
                                      │  • Research Agent     │
                                      │  • Rule Engine        │
                                      │  • Writes suggestions │
                                      └──────────────────────┘
```

The agent no longer crawls `edstellar.com/sitemap.xml`. It reads the **`courses`** table in Supabase, which is the canonical inventory maintained by the Edstellar team (via the dashboard, bulk import, or whatever upstream process they prefer). This is faster, more accurate, and lets the team correct or augment course metadata that the sitemap can't expose.

---

## 3. Components

### 3.1 Supabase Data Model

All tables below live in the dedicated **`course-agent`** schema on the self-hosted Supabase instance — not in `public`. This isolates the application's data from anything else running on the same Postgres instance and makes RLS policies easier to scope.

```sql
create schema if not exists "course-agent";
-- grant usage to authenticated and service roles
grant usage on schema "course-agent" to authenticated, service_role, anon;
```

All table references in the rest of this section are implicitly `"course-agent".<table>`.

**`courses`** — managed by Edstellar; the agent treats this as read-only.
```
courses (
  id              uuid primary key,
  num             int,                  -- legacy/display index
  name            text not null,
  category        text not null,        -- e.g. "Artificial Intelligence"
  subcategory     text,                 -- e.g. "Machine Learning Training" or "—"
  link            text,                 -- canonical Edstellar URL
  embedding       vector(1024),         -- voyage-3-large default; populated by an upsert trigger or batch job
  last_seen_at    timestamptz default now(),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index on courses (category);
create index on courses using ivfflat (embedding vector_cosine_ops);
```

**`categories`** — explicit taxonomy with curated metadata (target counts, demand signal, pinned-for-targeting flag).
```
categories (
  id            uuid primary key,
  name          text unique not null,
  course_count  int generated as (select count(*) from courses where courses.category = categories.name) stored,
  target_count  int,                    -- ideal portfolio size, set by admin
  demand_score  numeric,                -- external signal (refreshed weekly)
  is_pinned     boolean default false,
  notes         text
);
```

**`suggestions`** — written by the agent.
```
suggestions (
  id                  uuid primary key,
  run_id              uuid references agent_runs(id),
  title               text not null,
  rationale           text,
  category            text references categories(name),
  proposed_subcategory text,
  target_audience     text,
  duration_days       int,
  delivery_format     text check (delivery_format = 'instructor-led'),
  suggested_price_usd numeric check (suggested_price_usd > 2500),
  price_basis         text,
  references          jsonb not null,   -- array of {name, url, accessed_at}
  embedding           vector(1024),
  status              text default 'pending_review',   -- pending_review, approved, rejected, needs_revision
  created_at          timestamptz default now()
);
```

**`feedback`** — written by the Next.js app when a reviewer acts.
```
feedback (
  id              uuid primary key,
  suggestion_id   uuid references suggestions(id),
  decision        text not null,   -- approved, rejected, needs_revision
  reason_tags     text[],          -- from rejection_taxonomy
  reason_text     text,
  reviewer_id     uuid references auth.users(id),
  created_at      timestamptz default now()
);
```

**Supporting tables:** `rejection_taxonomy`, `prompt_versions` (with `model_slug` column so each prompt version is tied to a specific OpenRouter model — different prompts perform differently per model, and A/B tests need both axes), `agent_runs` (one row per daily pipeline execution: started/finished, categories targeted, model used, candidate counts, win-rate at completion).

### 3.2 Scheduler
- **Tool:** Supabase scheduled functions, GitHub Actions, or a small worker on Fly.io / Render.
- **Cadence:** Daily pipeline run timed to finish before the team's morning login.

### 3.3 Inventory Reader (replaces the sitemap crawler)
At the start of each run, the agent:
1. Reads `courses` and `categories` from Supabase.
2. Computes any embeddings for new or updated rows (rows where `embedding IS NULL` or `updated_at > last_run`).
3. Persists the snapshot count and category distribution into `agent_runs` for audit and drift monitoring.

No scraping. No HTML parsing. The team owns the canonical data; the agent just reads it.

### 3.4 Gap Analyzer
- Joins `categories.course_count` with `categories.demand_score` to compute an **under-supply score**.
- Ranks categories; honours `is_pinned` overrides set by admins on `/categories`.
- Picks the top K (default 5) categories to target this run.

### 3.5 Research Agent
For each targeted category, runs a structured loop:
1. **Search + scrape + extract** with **ScrapeGraphAI's `SearchGraph`** across global sources — Coursera Business, LinkedIn Learning B2B, Udemy Business, Skillsoft, Simplilearn, KnowledgeHut, NIIT, EU/APAC/MENA training providers, analyst reports, vendor training catalogues. SearchGraph chains the search, page fetch, and LLM-driven structured extraction into a single pipeline, eliminating the separate `Tavily → httpx → parse` chain. (Tavily / Serper remain available as fallback search providers.)
2. **Reason** with an LLM (routed via **OpenRouter** — see §5.1) using a structured prompt that includes:
   - All existing Edstellar courses in this category (nearest by embedding if the list is large).
   - **Recent rejection feedback for this category** (the learning input — see §3.8).
   - **Recent approvals** as positive few-shot examples.
3. **Emit** JSON candidates conforming to the `suggestions` schema, with at least 3 references:

```json
{
  "title": "European Data Privacy & GDPR Compliance for Enterprise Teams",
  "category": "Data Privacy and Security",
  "rationale": "GDPR enforcement and post-Brexit divergence drive sustained EU privacy demand. Major B2B providers run instructor-led variants at the $3k tier. Neutral course name covers the same body of knowledge as market-leading credentials in this space without referencing any certifying body.",
  "target_audience": "Privacy officers, DPOs, Legal & compliance leads",
  "duration_days": 3,
  "delivery_format": "instructor-led",
  "suggested_price_usd": 3200,
  "price_basis": "Benchmarked against three instructor-led EU privacy programs in the $3,000–$3,500 range (cert and non-cert variants combined)",
  "references": [
    {"name": "IAPP Privacy Training & Certification Courses", "url": "https://iapp.org/train/courses/"},
    {"name": "InfosecTrain Privacy Training",                "url": "https://www.infosectrain.com/privacy-training"},
    {"name": "Skillsoft Percipio Learning Platform",          "url": "https://www.skillsoft.com/"}
  ]
}
```

### 3.6 Rule Engine
Every candidate must pass **all** checks before being persisted with status `pending_review`.

| # | Rule | Implementation |
|---|------|----------------|
| 1 | No similar / duplicate suggestions within the run | Pairwise cosine similarity < 0.85. |
| 2 | No existing Edstellar course (any category) | Vector similarity vs. `courses.embedding` < 0.85 **and** fuzzy title match (RapidFuzz) < 90. |
| 3 | High ticket > $2,500 | DB-level CHECK constraint + agent-side filter. |
| 4 | Instructor-led only | DB-level CHECK constraint. |
| 5 | Suggested target price | Required, with at least two competitor data points in `price_basis`. |
| 6 | Category mapping | Must reference an existing row in `categories`; FK enforces this. Unmapped candidates flagged for human review. |
| 7 | Research references | Min. 3 URLs; each fetched and content-verified using **ScrapeGraphAI's `SmartScraperGraph`** — given the URL and the candidate topic, it scrapes the page and returns a structured `{is_match, format, evidence}` JSON. Candidates failing any reference are dropped. |
| 8 | Global sources allowed | Search tool configured with no region restriction. |
| 9 | **Not a recently rejected idea** | Vector similarity vs. last 90 days of rejections < 0.82, unless the rejection reason has been resolved. |
| 10 | **No certification names, no credential acronyms, no governing-body names in the title** | Three-layer check: (a) static blocklist of certifying bodies and credential acronyms — IAPP, ISACA, ISC2, PMI, AXELOS, SHRM, CIPD, ASQ, NEBOSH, IOSH, BSI, etc., and credentials like CIPP/E, CISSP, PMP, CISA, CRISC, ITIL, PRINCE2, SHRM-CP; (b) regex against patterns like `^Certified `, ` Certification$`, ` Certificate$`, `Exam Prep`; (c) cheap LLM judge — *"does this course title reference a specific industry certification credential or imply partnership with a certifying body? Answer yes/no."* Any candidate failing any of the three is rejected. |

**On Rule 10 — why it exists and how the agent handles it.** Edstellar is not an authorised training partner of any certifying body, so the catalogue cannot use names like *CIPP/E*, *CISSP*, *PMP*, or *ITIL Foundation* — those names are owned and licenced by their issuing bodies, and using them creates a brand and legal risk. The agent is still **encouraged** to research what certifications dominate a given category, because a popular high-ticket certification is the single strongest signal that the underlying topic supports instructor-led training at the price point we target. But the agent must then propose a **descriptive, neutral course name** that captures the same body of knowledge without referencing the credential or its issuer.

For example, instead of *"CIPP/E Certification Prep"*, the agent proposes *"European Data Privacy & GDPR Compliance for Enterprise Teams"*. The certification provider (IAPP, etc.) can still appear in the `references` array as market validation — that's research, not branding. The boundary is: cert names belong in the research inputs, never in the proposed course title or marketing copy.

### 3.7 Next.js Review Dashboard
This is the daily-driver UI for the Edstellar team. It also serves as the **inventory browser** — replacing the static Intelligence Hub HTML with a live, queryable view.

**Stack**
- Next.js 14+ (App Router, Server Components, Server Actions), TypeScript.
- **Supabase JS client** + **Supabase Auth** for login and row-level security; or Auth.js / Clerk if preferred.
- **Prisma** or **Supabase generated types** as the data-access layer.
- Tailwind CSS + shadcn/ui.
- TanStack Query for client-side data fetching where Server Components aren't enough.
- Resend / Postmark for daily-digest emails.

**Routes / screens**
- `/login` — SSO + email magic link via Supabase Auth.
- `/dashboard` — KPIs at a glance: total courses, categories targeted today, pending review count, 7/30-day approval rate, top rejection reasons this week.
- `/inventory` — searchable, filterable table of all courses. Admin role can add, edit, deactivate courses; changes write to `courses` and trigger embedding refresh.
- `/categories` — ranking of all 43 categories with course counts, demand scores, and the under-supply heatmap; pin/unpin categories from the agent's targeting list.
- `/categories/least-supplied` — focused view of the bottom 20 under-supplied categories, surfaced for quick prioritisation.
- `/suggestions/today` — the main review queue. Card per suggestion with:
  - Title, mapped category, suggested price, duration, target audience.
  - Rationale and `price_basis`.
  - Reference links rendered as 3+ pill buttons; each opens a side-panel preview.
  - **Closest existing Edstellar course** shown side-by-side (computed via vector similarity) so the diff is obvious.
  - **Approve** / **Reject** / **Needs revision** buttons; reject opens a modal requiring tag(s) plus optional free text.
- `/suggestions/[id]` — full detail view with audit trail.
- `/history` — searchable archive of every past suggestion with its decision and reviewer.
- `/learning` — admin-only: current prompt version, recent rejection patterns, approval-rate trend, manual "regenerate prompt from feedback" trigger.
- `/settings` — users, roles, schedule overrides, integrations.

**Server-side patterns**
- All writes go through **Server Actions** that call Supabase with the reviewer's session — RLS enforces who can decide what.
- Heavy reads (history, inventory) use Server Components with Supabase server client.
- A webhook from the agent pipeline pings the app when a new run completes, optionally triggering the daily digest email and Slack ping.

**UI Mockups.** A standalone HTML preview of all seven screens lives alongside this document at `edstellar_agent_ui_mockups.html`. It shows the visual language, layout density, and interaction patterns for: Login, Dashboard, Today's Suggestions queue (with the side-by-side closest-existing-course rail), the structured Rejection modal, Categories heatmap with pinning, Inventory browser, and the Learning admin view. Treat it as a clickable wireframe — the data shown is illustrative, but the screens reflect actual design intent.

### 3.8 Feedback & Learning Loop
This is the part that makes the agent get smarter over time.

**a) Structured rejection taxonomy.** Reviewers cannot reject with just free text — they must pick one (or more) tags. Initial taxonomy stored in `rejection_taxonomy`:
- `already_exists` — duplicate of an existing course we already offer.
- `near_duplicate_within_batch` — too similar to another suggestion in today's batch.
- `not_instructor_led_market` — topic only exists as e-learning / self-paced in the real world.
- `price_unrealistic` — proposed price not defensible by the market.
- `topic_outdated` — once-popular topic now declining.
- `too_niche` — audience too small to be a viable B2B program.
- `wrong_category` — category mapping is incorrect (with optional "should be: X" field).
- `weak_references` — citations are low-quality or off-topic.
- `not_corporate_relevant` — consumer / hobbyist topic.
- `certification_name_used` — title references a specific credential or certifying body (Rule 10 escape). Rare, but reviewers act as the final backstop.
- `other` — requires free-text explanation.

Each rejection stores: tag(s), free-text note, reviewer, timestamp, the full candidate JSON, and its embedding.

**b) How the agent uses this feedback.**

Before each daily run, the pipeline performs a **feedback ingestion step**:

1. **Update the negative memory.** All rejections from the last 90 days become a vector blocklist. Any new candidate within similarity 0.82 of a rejected one is filtered (rule #9) — unless the rejection reason has aged out (`topic_outdated` decays faster than `already_exists`).
2. **Build per-category guardrails.** For each category, count rejection reasons. If `not_instructor_led_market` dominates in a category, the prompt for that category gains an extra constraint: *"In this category, providers commonly offer only self-paced formats; only propose courses where you can cite a real instructor-led offering."*
3. **Curate few-shot examples.** Pull the 5 most recent approvals and the 5 most representative rejections (with reasons) for the targeted category. Inline them as positive and negative examples.
4. **Versioned prompt evolution.** A weekly admin job (or manual trigger from `/learning`) asks a higher-tier model to read the last week of rejection patterns and propose an updated system prompt. The new version is saved in `prompt_versions`, A/B tested against the previous version on the next two runs, and promoted if its approval rate is higher.
5. **Reviewer-personalised hints** *(Phase 3, optional).* Track which reviewer rejects what kinds of suggestions. The agent can flag at suggestion time: "60% likelihood reviewer X rejects this based on past patterns" — useful for triage routing, not for filtering.

**c) Closing the loop on "Needs revision".** When a reviewer clicks **Needs revision** with a note (e.g., *"good idea, pitch it at senior execs not managers"*), the candidate is re-queued with the note as a targeted re-prompt instruction. The revised version comes back the next day, shown side-by-side with the original.

**d) Metrics that drive learning.**
- **Approval rate** per run, per category, per prompt version.
- **Rejection-reason distribution** trend over time — specific reasons should decline as the agent learns to avoid them.
- **Repeat-rejection rate** — how often the agent re-suggests something semantically close to a past rejection. This should trend to zero.

### 3.9 Output / Reporting
- Accepted suggestions stay in `suggestions` with status `approved` and become inputs for downstream content creation (course outline drafting, instructor sourcing, pricing finalisation).
- Daily digest email sent at 8:00 AM local time with a link to `/suggestions/today`.
- Optional Slack integration for real-time pings.

---

## 4. Daily Pipeline (End-to-End)

1. **00:00** — Scheduler triggers the pipeline; opens a new `agent_runs` row.
2. **Feedback ingestion** — pull yesterday's rejections, refresh blocklist embeddings, load active prompt version, build per-category guardrails.
3. **Inventory read** — pull `courses` + `categories` from Supabase; compute embeddings for any new/updated courses.
4. **Gap analysis** — rank categories by under-supply × demand × pinned overrides; pick top K.
5. **For each targeted category:**
   - Run research agent (with feedback-augmented prompt).
   - Generate ~20 raw candidates.
   - Pass through rule engine (including rejection-similarity rule #9).
   - Keep top 5–10 that survive.
6. **Cross-batch dedupe** across the run's surviving candidates.
7. **Persist** in `suggestions` with status `pending_review`.
8. **Notify** — email digest + Slack ping with link to `/suggestions/today`.
9. **06:00–09:00** — reviewers log in, approve / reject / needs-revision; feedback rows written.
10. **Next day** — that feedback is already in memory before the agent thinks again.

---

## 5. Tech Stack

**Frontend (review dashboard)**
- Next.js 14+ (App Router), TypeScript, Tailwind, shadcn/ui.
- Supabase Auth (email + Google SSO), with role-based access via Postgres RLS.
- Supabase JS client + generated types; TanStack Query for client interactions.
- Deployed on Vercel or self-hosted in the same Docker network as Supabase.

**Backend (agent pipeline)**
- Python 3.11+, separate service from the Next.js app.
- LangGraph for the agent state machine (preferred over open-ended agents for determinism and debuggability).
- **OpenRouter** as the LLM gateway — lets the agent route to Claude, GPT, Gemini, Llama, etc. via a single API. Different pipeline stages use different models (e.g., a flagship model for research reasoning, a cheap fast model for filtering and verification), and the `prompt_versions` table tracks which model each prompt was tested with.
- **ScrapeGraphAI** for web research and reference verification — `SearchGraph` handles the search+scrape+extract pipeline in §3.5, `SmartScraperGraph` handles per-URL content verification in rule #7. Configured to use OpenRouter as its LLM backend.
- httpx + selectolax as a fallback for any auxiliary scraping ScrapeGraphAI can't handle cleanly; Playwright only if a target site requires JS rendering.
- Prefect or simple cron-in-Docker for orchestration.

**Shared infrastructure**
- **Self-hosted Supabase** (Postgres + pgvector + Auth + Storage) reached via its Kong gateway URL. All app data lives in the dedicated `course-agent` schema; the `public` schema is left alone.
- S3-compatible bucket (Supabase Storage or MinIO) for any captured HTML snapshots and reference page archives.

### 5.1 External Services & API Keys

These are the third-party accounts and keys the system needs. **Required** means the agent cannot function without it. **Optional** means the system runs without it but loses a feature (notifications, observability, etc.).

**Required — core agent functionality**

| Service | Purpose | Key / Variable | Notes |
|---------|---------|----------------|-------|
| **OpenRouter** | LLM gateway. One API, many models — Claude, GPT, Gemini, Llama, etc. The agent can route different pipeline stages to different models (flagship for research, cheap models for filtering and verification) and the prompt-version A/B test compares model+prompt combinations. ScrapeGraphAI also uses OpenRouter as its LLM backend. | `OPENROUTER_API_KEY` | Sign up at openrouter.ai. Each model has its own per-token price visible in the dashboard. Set monthly spend limits per key to avoid runaway costs. |
| **Voyage AI** | Vector embeddings for the course inventory, suggestions, and rejection blocklist. Powers all similarity / dedup rules. | `VOYAGE_API_KEY` | Model: `voyage-3-large` (default 1024-dim output, matches the `vector(1024)` columns in the schema). OpenRouter does not proxy embedding models, so this is a direct Voyage AI key. |
| **Search backend for ScrapeGraphAI** | ScrapeGraphAI's `SearchGraph` needs a search engine under the hood. It can use free DuckDuckGo (no key) or a paid Google-backed search for higher reliability. | `SERPER_API_KEY` *(recommended)* **or** none (defaults to DuckDuckGo) | Serper gives Google-quality results at low cost (~$0.30 per 1k searches) and avoids DuckDuckGo's rate limits during heavy runs. |

**Required — production deployment**

| Service | Purpose | Key / Variable | Notes |
|---------|---------|----------------|-------|
| **Google Apps Script Web App** | Sends the morning digest email pointing reviewers at `/suggestions/today`. The Next.js app POSTs `{to, subject, html}` to your deployed Apps Script endpoint, which forwards via GmailApp. | `GAS_EMAIL_WEBHOOK_URL` *(server-side)*, `GAS_EMAIL_SHARED_SECRET` *(server-side, recommended)* | The webhook URL is the `/exec` URL of the deployed Apps Script. **Add a shared-secret check inside the script**: have the Next.js app POST an extra `secret` field and reject any request where it doesn't match a script-property value. Without that, anyone with the URL can send mail through your Gmail account. |

**Optional — strongly recommended**

| Service | Purpose | Key / Variable | Notes |
|---------|---------|----------------|-------|
| **Langfuse** *(or Helicone)* | LLM observability — traces every OpenRouter call, makes prompt-version × model comparisons in `/learning` possible, helps debug bad runs. | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | Langfuse is open source and can be self-hosted alongside Supabase. Skip at your own risk — without traces, debugging a bad run means reading raw logs. |
| **Sentry** | Application error tracking for both Next.js and the Python agent. | `SENTRY_DSN` *(one per service)* | Free tier is enough for both services at Phase 1–2 scale. |
| **Slack webhook** | Posts a "today's queue is ready" ping to a channel when the pipeline finishes. | `SLACK_WEBHOOK_URL` | A simple incoming webhook; no app install needed. |

**Optional — Phase 3 demand signals**

| Service | Purpose | Key / Variable | Notes |
|---------|---------|----------------|-------|
| **SerpAPI (Google Trends)** | Feeds `categories.demand_score` to improve gap-analyzer ranking. | `SERPAPI_KEY` | SerpAPI wraps Google Trends in a stable JSON API. |
| **Lightcast / Indeed API** | Job-posting frequency per skill as a second demand signal. | `LIGHTCAST_API_KEY` | Enterprise pricing; only worth setting up in Phase 3. |

---

## 6. Environment & Secrets

A consolidated view of every environment variable the two apps need at runtime. See §5.1 for what each external service is and how to choose between alternatives.

**Supabase connection** *(both apps)*

| Variable | Used by | Notes |
|----------|---------|-------|
| `SUPABASE_URL` | Next.js (server + client), Agent | The Kong gateway URL of the self-hosted instance. Safe to ship to the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js (client) | Public; intended to ship in the browser bundle, gated by RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js (server-side actions only), Agent | **Bypasses RLS. Never expose to the client.** Stored only in server-side env (Vercel project env, agent container secret manager). |

**LLM, search, and embeddings** *(Agent)*

| Variable | Required? | Notes |
|----------|-----------|-------|
| `OPENROUTER_API_KEY` | Required | LLM gateway. Used by both LangGraph and ScrapeGraphAI. |
| `VOYAGE_API_KEY` | Required | Voyage AI embeddings (`voyage-3-large`, 1024 dimensions). OpenRouter does not proxy embeddings. |
| `SERPER_API_KEY` | Recommended | Search backend for ScrapeGraphAI's `SearchGraph`. Without it, ScrapeGraphAI falls back to DuckDuckGo (free, less reliable). |

**Application services** *(Next.js)*

| Variable | Required? | Notes |
|----------|-----------|-------|
| `GAS_EMAIL_WEBHOOK_URL` | Required for production | The `/exec` URL of the deployed Google Apps Script Web App that fronts GmailApp. Server-side only. |
| `GAS_EMAIL_SHARED_SECRET` | Strongly recommended | Sent in the POST body and checked inside the Apps Script. Without it the email endpoint is effectively open to anyone with the URL. |
| `SLACK_WEBHOOK_URL` | Optional | Pipeline completion ping. |

**Observability** *(both apps)*

| Variable | Required? | Notes |
|----------|-----------|-------|
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | Strongly recommended | LLM tracing. |
| `SENTRY_DSN` *(one per service)* | Recommended | Application error tracking. |

**Rules:**
- All secrets live in environment variables or a secret manager — never in code, never in the Supabase database, never in the dashboard config.
- Rotate any key the moment it has been transmitted through an unencrypted or shared channel (chat, email, screen share). The Supabase `service_role` key is reset under Studio → Project Settings → API → Reset JWT secret.
- The Next.js app uses two Supabase clients: a browser client with the anon key (queries run under the authenticated user, gated by RLS), and a server-only client with the service-role key (Server Actions that need to bypass RLS, e.g. writing `agent_runs` audit rows).

---

## 7. Prompt Design (Feedback-Aware, Per-Category)

System prompt sketch (the live version is versioned in `prompt_versions`):

> You are a corporate training market researcher for Edstellar, a global instructor-led training company. For the category **{category}**, propose new courses that:
> - Do NOT overlap with the attached list of existing Edstellar courses in this category.
> - Do NOT resemble any of the attached recently rejected suggestions for this category (reasons included).
> - Are only viable as **instructor-led** programs (not e-learning, not self-paced, not free).
> - Have a market-justifiable price strictly **greater than USD 2,500** per learner (or equivalent corporate package).
> - Are supported by at least three reputable source URLs from any region globally.
> - Map cleanly to one of the existing Edstellar categories: **{category_list}**.
> - **Never reference any industry certification credential, certifying body, or exam name in the proposed course title** (e.g., do not propose *"CIPP/E Certification Prep"*, *"CISSP Bootcamp"*, *"PMP Exam Prep"*). Edstellar is not an authorised training partner for these bodies. You ARE encouraged to use certification market data as a signal that a topic supports high-ticket instructor-led training — then propose a descriptive, neutral course name that covers the same body of knowledge without using the credential name. The certifying body may appear in the `references` array as research validation.
>
> Recent **approved** examples (study their style and quality): {approved_examples}.
> Recent **rejected** examples with reasons (do not produce anything similar to these for the same reasons): {rejected_examples}.
>
> Return strict JSON conforming to the schema. If you cannot find a candidate that meets all constraints, return an empty list — do not relax the constraints.

Every input listed in `{ }` is pulled fresh from Supabase at run time.

---

## 8. Guardrails & Quality Controls

- **Human-in-the-loop is the system, not a phase.** The agent never publishes anything autonomously.
- **Hallucination check on references.** A second LLM call verifies that each cited URL contains content matching the suggested topic. If not, drop the candidate.
- **Price sanity check.** Reject suspiciously templated prices; require numerical evidence from cited sources.
- **Reviewer calibration.** Brief training so the rejection taxonomy is used consistently — otherwise the learning signal becomes noisy.
- **Drift monitoring.** Approval rate per run is the canary. Alert if it drops more than 10 points week-over-week.
- **Cost controls.** Cache embeddings, cap candidates per category, prefer Haiku for filtering steps.
- **RLS everywhere.** Reviewers can only read their assigned queue; only admins can change `categories.is_pinned` or `target_count`.

---

## 9. Suggested Phasing

**Phase 1 — Foundation (3–4 weeks).** Supabase schema with the existing 1,623 courses imported as the inventory of record. Next.js dashboard with login, inventory views, and basic approve/reject with free-text reason. Agent runs with single-shot LLM suggestions and the rule engine; feedback is stored but not yet feeding back.

**Phase 2 — Closed Loop (3–4 weeks).** Structured rejection taxonomy. Negative-memory blocklist (rule #9). Few-shot examples from approvals and rejections injected into the prompt. Daily email digest. "Needs revision" workflow. `/categories` heatmap and `/history` views.

**Phase 3 — Self-Improving (ongoing).** Versioned prompts with A/B testing. Weekly auto-generated prompt revision job. External demand signals (job market data, Google Trends) feeding `categories.demand_score`. Reviewer-personalised hints. `/learning` admin view with full transparency into the agent's evolving instructions.

---

## 10. Key Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Inventory drifts out of date | Edstellar owns `courses`; provide bulk import UI and admin edit flows in the dashboard. |
| LLM invents course providers or URLs | Mandatory URL fetch + content verification before accepting. |
| Near-duplicates slip through embedding check | Second-pass LLM judge on top candidates. |
| Reviewers use rejection tags inconsistently | Mandatory training; periodic inter-reviewer agreement audit. |
| Agent "learns" the wrong lesson from a noisy week | Versioned prompts + A/B test before promotion; one-click rollback. |
| Suggestions cluster around trendy topics only | Diversity penalty in the rule engine (max N candidates per sub-topic per run). |
| Prices below $2,500 sneak in | DB CHECK constraint, not just prompt language. |
| Single reviewer becomes a bottleneck | Multi-reviewer support with round-robin assignment in `/suggestions/today`. |
| Self-hosted Supabase downtime | Daily logical backups; pipeline has retry-with-backoff against Supabase API. |

---

## 11. Success Metrics

- **Approval rate** trending upward — primary success signal. Target > 40% by end of Phase 2; > 60% by end of Phase 3.
- **Repeat-rejection rate** trending to zero — proves the learning loop works.
- **Coverage** — reduced variance in course counts across the 43 categories over time.
- **Time saved** — hours of manual market research displaced per week.
- **Revenue impact** — inquiries / conversion on courses launched from agent suggestions vs. baseline.
- **Prompt version lift** — average approval-rate delta between consecutive promoted prompt versions.

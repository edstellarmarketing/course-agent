# Phase 5 — Review Workflow End-to-End

Sister-doc to `edstellar_agent_build_plan.md`, `phase2.md`, `phase3.md`,
and (forthcoming) `phase4.md`. The build plan says *what* Phase 5
produces; this doc walks the work in the order it actually happens at
a keyboard.

**Goal:** Reviewers can act on suggestions. Approve, reject (with
structured tags from `rejection_taxonomy`), and "needs revision" all
write to `course-agent.feedback`. The agent doesn't exist yet — the
real one lands in Phase 6 — but the human side of the loop is fully
functional and stable enough for two reviewers to run in parallel.

**Duration:** ~3–4 focused days.

**Acceptance — Phase 5 is done when:**

- A reviewer signs in, clicks **Approve** on a suggestion. Status
  flips to `approved`, the card disappears from `/suggestions/today`,
  and the decision appears at the top of `/history` and the
  dashboard's recent-activity feed with the reviewer's real name.
- A reviewer clicks **Reject**, the modal opens, attempting to submit
  with zero tags shows a validation error, submitting with at least
  one tag succeeds.
- A reviewer clicks **Needs revision**, types a note, submits;
  status flips to `needs_revision`, feedback row inserts with the
  note in `reason_text`.
- A direct `select * from "course-agent".feedback` shows the rows
  with the correct `reviewer_id`, `reason_tags` array, and timestamp.
- Two reviewers working in parallel don't ghost-click each other's
  queue items — the second reviewer's click on an already-acted-on
  suggestion fails gracefully with an in-UI message, not a 500.
- The 11 rejection-tag chips in the Reject modal come from
  `course-agent.rejection_taxonomy`, not from `lib/mock/`.
- `/history` filters by decision (approved/rejected/needs_revision)
  and by reviewer (dropdown sourced from real `auth.users`).
- `pnpm --dir app smoke` and `uv --directory engine run smoke` are
  still both green (Phase 2 + Phase 3 + Phase 4 didn't regress).

---

## Where exactly we are coming in

Snapshot at start of Phase 5 work:

| Layer | State |
|---|---|
| Auth + RLS + GRANTs | ✅ Working end-to-end. Migration 0005 already added `grant update on suggestions to authenticated` and `grant insert on feedback to authenticated` — Phase 5 doesn't need new GRANTs. |
| Course inventory (`courses`) | ✅ 1,623 rows imported + Voyage embeddings + ivfflat index. |
| Categories | ✅ 43 rows in `categories`; `categories_with_counts` view live; admin pin/edit through `/categories` writes to DB. |
| `rejection_taxonomy` | ✅ 11 seed rows from migration 0002. Phase 5's Reject modal will pull from here. |
| `suggestions` | ⚠️ Empty. Phase 5 Step 1 seeds ~10 realistic rows. |
| `feedback` | ⚠️ Empty. Populated by Phase 5's Server Actions. |
| `agent_runs` | ⚠️ Empty. Phase 5 inserts one synthetic row to link the seeded suggestions to (Phase 6 starts writing real rows). |
| Existing UI on `/suggestions/today`, `/suggestions/[id]`, `/history`, `/dashboard` recent activity | All Phase 1 mock-data reads. The component shells (`SuggestionQueue`, `DecisionPanel`, `RejectModal`) already take callback props for submit, so Phase 5 swaps the callbacks for Server Actions without rewriting markup. |

Last known good commit on `main`: `f066e0b` ("Phase 4 Checkpoint 2:
/inventory + /categories on real Supabase data").

### One-time housekeeping before Step 1

1. **Sign out and back in to the dashboard.** Your JWT was issued
   before `app_metadata.course_agent_role` was added on `2026-05-16`.
   Admin writes still worked through Phase 4 because the legacy
   `app_metadata.role` (set by Marketing-PM-Tool) happened to be
   `"admin"` too — but Phase 5's RLS policies on `suggestions`
   evaluate the JWT directly. A fresh JWT picks up the
   `course_agent_role` key cleanly.
2. **Quick smoke before changing anything:**
   ```powershell
   pnpm --dir "C:\Users\Vijay\Downloads\Course-Agent\app" smoke
   uv  --directory "C:\Users\Vijay\Downloads\Course-Agent\engine" run smoke
   ```
   App smoke: 2/3 green (GAS check is a pre-existing Phase 2
   issue, unrelated). Engine smoke: 6/6 green.

---

## Pre-flight — decisions to make before opening the editor

| Decision | Recommendation | Why |
|---|---|---|
| Where seed suggestions live | **`supabase/migrations/0006_seed_test_suggestions.sql`** | Treat it as a one-time bootstrap. Phase 6 will start inserting real rows via the engine; this seed is purely so reviewers have something to click on while the engine is built. Idempotent via `on conflict (id) do nothing`. |
| Server Action location | **`app/src/app/(app)/suggestions/actions.ts`** | Mirrors the `/categories/actions.ts` pattern from Phase 4. Co-located with the routes that use them; `"use server"` at the top so Client Components can import them. |
| Which Supabase client | **`createSessionClient()`** (anon key + cookies) | Server Actions must run as the signed-in reviewer so `feedback.reviewer_id = auth.uid()` works. **Never** use `createAdminClient()` here — that would let reviewers write feedback rows as other users by passing arbitrary `reviewer_id`. |
| Conflict detection on stale clicks | **Update with a `.eq("status", "pending_review")` guard** | If two reviewers race and one has already acted, the second's UPDATE affects 0 rows. The Server Action returns `{ok:false, error:"Already decided by another reviewer"}`. Same `.select("id")` zero-row trick we used on `/categories`. |
| Reject-modal tag source | **Server Component fetches from `rejection_taxonomy`, passes as prop** | Keeps the modal a pure Client Component. Tags rarely change; passing as prop also means the `<select>` markup is deterministic SSR (no flash). |
| `agent_runs` link | **One synthetic row inserted by the seed migration** | The `suggestions.run_id` FK needs to resolve. The synthetic run has `model_used = 'seed-data'` so audit queries can filter it out later. |

If any of these change, the schema stays the same — only the data does.

---

## Step-by-step

Each step ends with a `verify:` line you can run before moving on.

### Step 1 — Seed `agent_runs` + `suggestions`

The whole content lives in `supabase/migrations/0006_seed_test_suggestions.sql`.

```sql
-- Migration 0006 — seed one synthetic agent_run + ~10 pending suggestions.
-- Idempotent. Re-running is a no-op once the synthetic run id is present.

with seed_run as (
  insert into "course-agent".agent_runs (
    id, started_at, finished_at, model_used,
    categories_targeted, candidates_produced, candidates_persisted
  )
  values (
    '11111111-1111-1111-1111-111111111111',
    now() - interval '6 hours',
    now() - interval '5 hours 30 minutes',
    'seed-data',
    array['Cloud Computing','Cybersecurity','Data Privacy and Security','Generative AI for Business','DevOps'],
    10, 10
  )
  on conflict (id) do nothing
  returning id
)
insert into "course-agent".suggestions (
  id, run_id, title, rationale, category, proposed_subcategory,
  target_audience, duration_days, delivery_format,
  suggested_price_usd, price_basis, "references", status
)
values
  -- Cloud Computing
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111111',
   'European Data Privacy & GDPR Compliance for Enterprise Teams',
   'Sustained Q4 demand from EU clients; current catalogue under-supplied in this niche.',
   'Data Privacy and Security', 'GDPR Compliance',
   'Mid-to-senior data, privacy, and legal practitioners',
   3, 'instructor-led', 3200, 'Two market comparables at $2,900 and $3,400; both instructor-led 3-day.',
   '[{"name":"IAPP CIPP/E Body of Knowledge","url":"https://iapp.org/cert/cippe/"},
     {"name":"ICO GDPR Guide","url":"https://ico.org.uk/for-organisations/guide-to-data-protection/"},
     {"name":"EU Commission GDPR portal","url":"https://commission.europa.eu/law/law-topic/data-protection_en"}]'::jsonb,
   'pending_review'),
  -- Generative AI
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111',
   'Generative AI Governance for the Enterprise',
   'Reviewer interest spike + regulatory pressure (EU AI Act, NIST AI RMF).',
   'Artificial Intelligence', 'Governance',
   'CTO office, IT risk, compliance leadership',
   2, 'instructor-led', 3800, 'NIST AI RMF training providers price 2-day at $3,500–$4,000.',
   '[{"name":"NIST AI Risk Management Framework","url":"https://www.nist.gov/itl/ai-risk-management-framework"},
     {"name":"EU AI Act text","url":"https://artificialintelligenceact.eu/the-act/"},
     {"name":"ISO/IEC 42001 AI management","url":"https://www.iso.org/standard/81230.html"}]'::jsonb,
   'pending_review'),
  -- Add 8 more, mixing categories from the agent_runs categories_targeted array.
  -- Keep each suggestion's "references" array at >= 3 items so the
  -- jsonb_array_length check passes.
  -- (Trim or expand to taste; the rest of the page assumes ~10 rows.)

on conflict (id) do nothing;
```

> **The full file should have ~10 rows.** Mix categories so the
> agent_runs.categories_targeted array is representative. Every row
> must have at least 3 references (CHECK constraint), price > $2,500
> (CHECK), and `delivery_format = 'instructor-led'` (CHECK).

**verify:**
```sql
select count(*) as total,
       count(*) filter (where status = 'pending_review') as pending
from "course-agent".suggestions;
-- expect total = 10, pending = 10

select count(*) from "course-agent".agent_runs where model_used = 'seed-data';
-- expect: 1
```

---

### Step 2 — Wire `/suggestions/today` to real data

Replace the mock-data read in `app/src/app/(app)/suggestions/today/page.tsx`:

- Pull suggestions: `status = 'pending_review'`, sorted by
  `created_at desc`. Limit 50 (Phase 5 doesn't need pagination; the
  agent only produces ~10 per run anyway).
- The card component (`SuggestionCard` / `SuggestionQueue`) already
  takes a `suggestions` prop — same shape, just real data.
- Drop the `mockAllSuggestions` import; delete it from the file's
  imports.

```typescript
// app/src/app/(app)/suggestions/today/page.tsx (sketch)
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { Suggestion } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TodaysSuggestionsPage() {
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("suggestions")
    .select("*")
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(50);

  // Map snake_case → camelCase to match the Suggestion type
  const suggestions: Suggestion[] = (data ?? []).map(rowToSuggestion);

  return <SuggestionQueue suggestions={suggestions} />;
}
```

Map function: `references` column is already a JSONB array; surface
it as `references: row.references as SuggestionReference[]`. Keep the
`closestExistingCourse` hydration deferred — Phase 6 computes that
via the cosine probe.

**verify:** sign in → `/suggestions/today` shows 10 cards (or however
many you seeded). Each card links to `/suggestions/[id]`. The "1 of
6 categories targeted" line in the dashboard is still pulling from
mocks — that gets fixed in Step 7.

---

### Step 3 — Reject modal tags from `rejection_taxonomy`

Currently `RejectModal` receives `tags: RejectionTag[]` as a prop, and
the only caller passes `mockRejectionTaxonomy`. Phase 5 fetches the
real list in the page Server Component and passes it down.

Two places to wire this:

- `/suggestions/today/page.tsx` — pulls tags once, passes to
  `SuggestionQueue` (which forwards to its inline `<RejectModal>`).
- `/suggestions/[id]/page.tsx` — pulls tags once, passes to
  `DecisionPanel`.

```typescript
const { data: taxonomy } = await supabase
  .from("rejection_taxonomy")
  .select("key,label,description,rare")
  .order("sort_order");

const tags: RejectionTag[] = (taxonomy ?? []).map((t) => ({
  key: t.key as RejectionTagKey,
  label: t.label,
  description: t.description,
  rare: t.rare ?? false,
}));
```

Then delete the `mockRejectionTaxonomy` imports from both pages.

**verify:** open Reject modal — 11 chips, the two "rare" ones
(`certification_name_used`, `other`) at the bottom under the fold.

---

### Step 4 — The three Server Actions

Create `app/src/app/(app)/suggestions/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";

import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { FeedbackDecision, RejectionTagKey } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

async function applyDecision(args: {
  suggestionId: string;
  decision: FeedbackDecision;
  newStatus: "approved" | "rejected" | "needs_revision";
  reasonTags?: RejectionTagKey[];
  reasonText?: string | null;
}): Promise<Result> {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Race-safe status flip: only update rows still pending.
  // Zero rows back → someone else already acted.
  const { data, error } = await supabase
    .from("suggestions")
    .update({ status: args.newStatus })
    .eq("id", args.suggestionId)
    .eq("status", "pending_review")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "This suggestion was already decided by another reviewer.",
    };
  }

  const { error: fbError } = await supabase.from("feedback").insert({
    suggestion_id: args.suggestionId,
    decision: args.decision,
    reason_tags: args.reasonTags ?? [],
    reason_text: args.reasonText ?? null,
    reviewer_id: user.id,
  });
  if (fbError) {
    // Best-effort rollback: flip status back so the queue heals.
    await supabase
      .from("suggestions")
      .update({ status: "pending_review" })
      .eq("id", args.suggestionId);
    return { ok: false, error: fbError.message };
  }

  revalidatePath("/suggestions/today");
  revalidatePath("/suggestions/" + args.suggestionId);
  revalidatePath("/history");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function approveSuggestion(id: string): Promise<Result> {
  return applyDecision({
    suggestionId: id,
    decision: "approved",
    newStatus: "approved",
  });
}

export async function rejectSuggestion(
  id: string,
  tags: RejectionTagKey[],
  reasonText: string | null,
): Promise<Result> {
  if (tags.length === 0) {
    return { ok: false, error: "Pick at least one rejection tag." };
  }
  return applyDecision({
    suggestionId: id,
    decision: "rejected",
    newStatus: "rejected",
    reasonTags: tags,
    reasonText,
  });
}

export async function requestRevision(
  id: string,
  note: string,
): Promise<Result> {
  if (!note.trim()) {
    return { ok: false, error: "Add a short note for the agent." };
  }
  return applyDecision({
    suggestionId: id,
    decision: "needs_revision",
    newStatus: "needs_revision",
    reasonText: note.trim(),
  });
}
```

> **Why a manual rollback on feedback-insert failure?** If the status
> flip succeeds but feedback insert fails, the row is "in limbo":
> nobody can re-decide it (status != pending_review blocks the next
> reviewer), but there's no audit trail of why. Flipping status back
> heals the queue. A real DB transaction across two tables would be
> nicer; Supabase RPC is the path for that in Phase 6 if this two-step
> proves flaky.

**verify:** unit-test by triggering one approval from the UI; check
`feedback` table for the row with the right `reviewer_id`.

---

### Step 5 — Wire the buttons

The existing components already accept `onSubmit` callbacks. Phase 5
swaps them to call the new Server Actions.

- **`DecisionPanel`** (`/suggestions/[id]`): the three buttons each
  call the appropriate action via `useTransition`. On `{ok: false}`,
  surface the error in a banner above the buttons.
- **`SuggestionCard` + `RejectModal`** (used by `/suggestions/today`):
  same pattern. The queue page can show a toast when an action
  succeeds, but a simple inline "Approved · 2s ago" badge with
  `router.refresh()` is enough for MVP.

> **Don't optimistic-update.** Click → server action → revalidate is
> the safe MVP. Optimistic updates introduce sync bugs where the UI
> says "approved" but the DB still says "pending" because the action
> rejected. Phase 8 can add optimistic if it becomes worth the
> complexity.

**verify:** click Approve on a card — card disappears from
`/suggestions/today` after a beat (no page reload), reappears in
`/history` with your name.

---

### Step 6 — `/suggestions/[id]` detail + audit trail

Today the detail page reads `mockAllSuggestions.find(...)`. Replace with:

```typescript
const supabase = await createSessionClient();
const { data: suggestion } = await supabase
  .from("suggestions")
  .select("*")
  .eq("id", id)
  .single();
if (!suggestion) notFound();

const { data: feedback } = await supabase
  .from("feedback")
  .select("*")
  .eq("suggestion_id", id)
  .order("created_at", { ascending: false });
```

Render the existing `<DecisionPanel suggestion={...} tags={...} />`
plus a new `<FeedbackTimeline rows={feedback} />` that shows decision +
tags + reasonText + reviewer name + timestamp.

The reviewer-name lookup needs a join. Two options:
- **In SQL via PostgREST embedding:** the `reviewer_id` is a FK to
  `auth.users.id`, but RLS on `auth.users` blocks reading other users'
  rows directly. The clean fix: add a `profiles` view in a future
  migration; for Phase 5, fall back to showing `reviewer_id` truncated
  if the join fails, OR compose a small lookup map for the current
  reviewer only.
- **From the JWT:** show "you" for the current reviewer's rows, show
  the truncated UUID for others. Crude but acceptable for Phase 5;
  Phase 8 adds a proper `profiles` table.

**verify:** approve a suggestion, navigate to `/suggestions/[id]`,
see one row in the audit trail with your decision.

---

### Step 7 — `/history` from real `feedback`

Replace the `mockFeedback` read in `/history/page.tsx`:

```typescript
const supabase = await createSessionClient();
let query = supabase
  .from("feedback")
  .select("*, suggestions(title,category)")
  .order("created_at", { ascending: false })
  .limit(200);

if (decisionFilter !== "all") query = query.eq("decision", decisionFilter);
if (reviewerFilter !== "all") query = query.eq("reviewer_id", reviewerFilter);
```

The existing UI has filters for decision and reviewer. Keep them. For
the reviewer dropdown, list reviewers who have at least one feedback
row (via a distinct query) — that's better than listing every
`auth.users` row, and side-steps the same auth.users RLS issue from
Step 6.

**verify:** `/history` shows all the decisions made so far, in
reverse-chronological order. Filtering by decision narrows correctly.

---

### Step 8 — Dashboard recent-activity feed

`/dashboard` currently shows `mockFeedback.slice(0, 8)`. Replace with:

```typescript
const { data: recent } = await supabase
  .from("feedback")
  .select("id,decision,created_at,suggestion_id,suggestions(title)")
  .order("created_at", { ascending: false })
  .limit(8);
```

Render the same list component. Also the dashboard's "Pending
review" count should now come from a real query:

```typescript
const { count } = await supabase
  .from("suggestions")
  .select("*", { count: "exact", head: true })
  .eq("status", "pending_review");
```

`count` replaces `mockAllSuggestions.length` in the metric tile.

**verify:** approve one card, navigate to `/dashboard`, see your
approval at the top of "Recent activity" within a second of
`revalidatePath` firing.

---

### Step 9 — Cleanup pass

Search the `app/src` tree for `mock` references one more time and
delete what's no longer imported:

```powershell
# From the project root
Select-String -Path "app/src/**/*.tsx","app/src/**/*.ts" -Pattern "mockAllSuggestions|mockFeedback|mockRejectionTaxonomy"
```

`mockAllSuggestions`, `mockFeedback`, `mockRejectionTaxonomy`,
`mockPromptVersions` should all be removed by Phase 5's end. The
`mockReviewers` array stays until Phase 8 introduces a real profiles
table.

**verify:**
```powershell
pnpm --dir app exec tsc --noEmit
pnpm --dir app exec next build
pnpm --dir app smoke
uv  --directory engine run smoke
```
TS-check clean, prod build clean (no warnings about deprecated APIs
beyond the pre-existing one we already addressed in Phase 3), both
smokes still green.

---

## Acceptance verification

Run with two browser profiles signed in as different reviewers (you
can promote a second user via the same `course_agent_role=admin` SQL,
or use one admin + one reviewer-role for the role-mix test). If you
don't have a second reviewer, the parallel-race check can be done in
two incognito windows of the same admin — the race semantics are
identical.

| Check | Method |
|---|---|
| 10 seeded suggestions visible on `/suggestions/today` | manual |
| Approve flips status, removes card from queue, appears in `/history` | manual |
| Reject with zero tags shows validation error | manual |
| Reject with ≥1 tag inserts feedback row with `reason_tags` array | manual + SQL: `select reason_tags from "course-agent".feedback order by created_at desc limit 1;` |
| Needs-revision with a note inserts feedback row with `reason_text` | manual + SQL |
| Two parallel reviewers don't ghost-click | two-tab manual: Reviewer A approves; Reviewer B (already had the card open) clicks Approve → error banner "Already decided by another reviewer" |
| `/history` filters by decision + reviewer | manual |
| Dashboard "Recent activity" + "Pending review" both reflect real DB state | manual |
| Phase 4 didn't regress | `/inventory` still 1,623 rows, `/categories` still 43 cells, admin pins still persist |

---

## Gotchas worth knowing in advance

- **Use the session client, not the admin client, for Server Actions.**
  Reviewer-facing writes MUST go through `createSessionClient()`. The
  admin client bypasses RLS, which means a bug in your action could
  let any reviewer write feedback as any other reviewer. RLS policy
  `feedback_insert` already gates on `reviewer_id = auth.uid()`; only
  the session client makes that meaningful.

- **`reason_tags` is a `text[]` array, not JSONB.** Pass a JS array
  directly to supabase-js; it serializes correctly. Don't wrap in
  `JSON.stringify`.

- **The Reject modal needs to clear on close.** When you close
  without submitting, then re-open on a different card, the
  selected tags from the prior open shouldn't persist. The
  existing modal uses `key` for fresh mounts; if you change that,
  keep state-reset behaviour intact.

- **`revalidatePath` is the only path-cache invalidation that fires.**
  Don't use `router.refresh()` from the Client Component as well —
  it double-fetches. Pick one (revalidatePath in the action) and
  trust it.

- **Two-reviewer race**: the `.eq("status", "pending_review")` guard
  on the UPDATE is what makes this safe. The second reviewer's
  UPDATE affects 0 rows, my action returns `{ok:false, error:"…"}`,
  the UI shows the error. Don't replace that guard with a "select
  then update" pattern — the gap between the two queries is the
  race window.

- **JWT staleness** (carry-over from Phase 4): if `is_admin()`
  returns false for an account that should be admin, the user signed
  in BEFORE `course_agent_role` was set in `app_metadata`. Sign out
  and back in to refresh.

---

## What's deliberately not in Phase 5

- **The real agent that produces suggestions.** Phase 6.
- **`assignee_id` on suggestions for per-reviewer queue routing.**
  Phase 8. Today every reviewer is eligible to act on every suggestion.
- **A proper `profiles` table joining `auth.users` to reviewer names.**
  Phase 8.
- **Optimistic UI updates.** Phase 8.
- **Email digest with the day's decisions.** Phase 7 (the GAS relay is
  already wired from Phase 2).
- **Slack run-complete pings.** Phase 7.

---

## Done means

- [ ] Migration 0006 applied; 10 seeded suggestions + 1 synthetic
      `agent_run` in the DB.
- [ ] `/suggestions/today` reads from `suggestions` table directly.
- [ ] `/suggestions/[id]` reads suggestion + feedback audit trail.
- [ ] Reject modal tags come from `rejection_taxonomy`.
- [ ] All three Server Actions (`approveSuggestion`,
      `rejectSuggestion`, `requestRevision`) live in
      `app/src/app/(app)/suggestions/actions.ts` and write to
      `feedback` correctly.
- [ ] Two-reviewer race shows the second user a friendly error.
- [ ] `/history` paginates real feedback rows; filters work.
- [ ] Dashboard recent-activity reads from `feedback`; pending-review
      tile reads from `suggestions`.
- [ ] `mockAllSuggestions`, `mockFeedback`, `mockRejectionTaxonomy`,
      `mockPromptVersions` all unused; their imports gone from `app/src`.
- [ ] `pnpm --dir app exec next build` clean.
- [ ] Both smokes (`pnpm smoke`, `uv run smoke`) still green.
- [ ] Acceptance table above all green.
- [ ] Committed on `main` as "Phase 5: review workflow end-to-end".

---

## When you resume

1. Open this file. Should still be on `main`.
2. Sign out + back in to refresh JWT (one-time, see "Where exactly we
   are coming in" above).
3. Run both smokes to confirm Phase 4 didn't drift overnight.
4. Start at Step 1 (seed migration). Each step has a verify line; if
   any verify fails, the step isn't done.

Last known good commit on `main`: see `git log --oneline -5`.

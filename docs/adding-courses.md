# Bulk-upload courses + auto-create categories — plan

> **Status**: planned, **not yet implemented**. Pick up this doc to
> make the open decisions, then say "go" and I'll execute. Companion
> to `docs/serper-verify.md` and `docs/research-methodology.md` —
> sits next to those.

---

## Why this exists

Edstellar's catalogue grows from multiple sources: agent suggestions
the marketing team approves on `/suggestions/today`, courses added
through the website CMS, partnership-imported courses, etc. The
agent's `gap_analyze` reads the `course-agent.courses` table to pick
under-supplied categories. If the table drifts out of sync with the
production website, the agent's targeting is wrong — it'll keep
suggesting topics that already exist on edstellar.com.

A bulk-upload from `/inventory` lets a non-engineer keep the agent's
view current. Upload a CSV, system reconciles, only new rows land.

---

## End-to-end shape

```
/inventory page
   ↓
[Upload courses] button → modal
   ↓
File picker → CSV upload (or download sample first)
   ↓
Server action: parse → reconcile → insert
   ↓
Result panel: "N new courses added, M auto-created categories, X duplicates skipped"
   ↓
(Optional) "Run embedding job" button to backfill course embeddings
```

---

## CSV format

### Required columns

| Column | Required | Description |
|---|---|---|
| `name` | ✅ | Course title. Trimmed. Used for duplicate detection if `num` is missing. |
| `category` | ✅ | Category name. Must match an existing category exactly (case-sensitive) OR will be auto-created. |

### Optional columns

| Column | Required | Description |
|---|---|---|
| `num` | ⬜ | Edstellar's stable course identifier (integer). Primary key for duplicate detection — if you have it, supply it. |
| `subcategory` | ⬜ | Subcategory tag, free-text |
| `link` | ⬜ | Canonical URL on edstellar.com (e.g. `https://www.edstellar.com/course/phishing-awareness-training`) |

### Sample CSV (the user will be able to download this as a template)

```csv
num,name,category,subcategory,link
2001,Phishing Awareness Training,Cybersecurity,Threat Awareness,https://www.edstellar.com/course/phishing-awareness-training
2002,Effective Stakeholder Management,Leadership Communication,Communication,
,AWS Lambda for Enterprise Teams,Cloud Computing,,https://www.edstellar.com/course/aws-lambda-for-enterprise-teams
2003,"Negotiation Skills, Advanced",Sales,Influence,https://www.edstellar.com/course/negotiation-skills-advanced
```

Notes for whoever writes the CSV:
- Quote fields that contain commas
- Leave optional columns blank if you don't have the value
- Don't add a trailing comma at the end of each row
- UTF-8 encoding (Excel "Save As" → CSV UTF-8)
- Header row required (first line)

### What we'll NOT accept (validation rejects)

- Duplicate `num` within the same CSV
- Empty `name` or `category` on any row
- Header row missing or malformed
- File >5 MB (~50K rows; well above realistic batch size)

---

## Duplicate detection (the matching logic)

For each CSV row, the system checks in this order:

1. **`num` match** (when both CSV row and DB row have a `num`)
   - If `num` matches an existing row → it's a duplicate, **skip**
   - This is the strongest signal — `num` is unique per migration 0003

2. **`name + category` exact match** (when `num` is missing on the CSV row)
   - Case-sensitive exact text comparison
   - If matched → **skip**

3. **Neither matches** → it's new, **insert**

What we won't do (for v1):
- Semantic dedup via embedding similarity — too expensive, too fuzzy
- Case-insensitive or partial-string matching — too risky, can lose distinct courses
- Updating existing rows when CSV value differs — read-only ingest only

Conflict edge case: CSV row has `num=2001` AND `name=Foo`; DB has `num=2001` AND `name=Bar`. Result: **skipped + reported in the result panel under "Conflicts"** with both values shown. Admin can investigate manually.

---

## Auto-create categories

When the CSV's `category` value isn't already in `course-agent.categories`, the system auto-creates a row using the same shape as the agent's Rule 6 carve-out:

```json
{
  "name": "Sales Negotiation",
  "is_pinned": false,
  "demand_score": null,
  "notes": "Auto-created from CSV upload by <reviewer-email> on YYYY-MM-DD"
}
```

This matches the persist-node behaviour for agent-proposed new categories. Reviewer can edit pin / demand_score on `/categories` afterwards.

Audit-logged as `category.upsert` (matches the existing
audit-log shape from manual category adds).

---

## What gets persisted

Per CSV row that turns out to be new:

```sql
insert into "course-agent".courses (
  num, name, category, subcategory, link,
  embedding,                   -- NULL initially (see "Embeddings" below)
  last_seen_at, created_at, updated_at
) values (...);
```

Per category that's new in the CSV:

```sql
insert into "course-agent".categories (
  name, is_pinned, demand_score, notes
) values (...);
```

Both wrapped in a server action that calls `logAdminAction()` so
`/history` Decisions tab shows who uploaded what:

```
action: "courses.bulk_upload"
target_type: "courses"
payload: { new_courses: 47, new_categories: 3, skipped_duplicates: 12, conflicts: 1 }
```

---

## Embeddings (the tricky bit)

The `courses.embedding` column powers Rule 2 (dedup against current
catalogue) and Rule 9 (demand signal). Without embeddings, newly
uploaded courses are invisible to those rules — the next agent run
might propose a course Edstellar JUST added.

Three approaches:

| Option | How | Trade-off |
|---|---|---|
| **A. Insert with NULL embedding; user runs script later** | Server action inserts; UI shows "X courses awaiting embedding"; user/cron runs `uv --directory engine run embed_courses` | Simplest. Embedding lag of hours-to-days. Rule 2 misses these courses until embedded. |
| **B. App calls Voyage API directly during upload** | Add VOYAGE_API_KEY to Vercel env; server action embeds each row before insert | One-shot UX. App grows a Voyage dependency. ~$0.0001 per course (1000 courses = $0.10). |
| **C. Webhook back to engine after upload** | App inserts NULL embeddings; pings engine via internal webhook; engine runs `embed_courses --since=<timestamp>` | Decoupled. Engine needs to be reachable from Vercel (currently a network challenge). |

**My recommendation: Option A for v1, surface a clear banner.**
Embedding lag is acceptable for an admin-driven action. The
`embed_courses` script is already idempotent and exists. The user
can:

- Run it from their dev machine: `uv --directory engine run embed_courses`
- Schedule it via the Coolify VPS cron (similar to the rotation/scheduler work)
- Add a button in `/inventory` that opens the existing GH Actions
  embed workflow if/when one exists

If embedding lag becomes painful in practice, upgrade to Option B
(probably the lowest-friction long-term).

---

## UI flow

`/inventory` page gains:

1. **"Upload courses"** button in the header (admin-gated)
2. **"Download sample CSV"** secondary link next to it
3. Modal opens on click:

```
┌─────────────────────────────────────────────────────────────┐
│ Upload courses                                           ✕  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Required columns: name, category                            │
│ Optional: num, subcategory, link                            │
│                                                             │
│ [Download sample CSV]                                       │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐    │
│ │  Drop CSV here or [browse files]                    │    │
│ │  Max 5 MB · UTF-8 · header row required             │    │
│ └─────────────────────────────────────────────────────┘    │
│                                                             │
│ Preview after upload:                                       │
│   First 5 rows shown for sanity check                       │
│   Validation errors flagged inline                          │
│                                                             │
│                                  [Cancel] [Process upload]  │
└─────────────────────────────────────────────────────────────┘
```

4. After processing, result panel:

```
✓ Upload complete

  47 new courses added
  3 new categories auto-created (Sales Negotiation, ESG Risk, Quantum Cryptography)
  12 duplicates skipped (already in catalogue)
  1 conflict reported (num=2001 has different name in DB) — see details below

  ⚠ 47 courses now awaiting embedding.
    To make them visible to the agent's Rule 2 / Rule 9 checks:
    `uv --directory engine run embed_courses`
    Or set up the embed workflow on the Coolify VPS cron.

  Audit-logged as courses.bulk_upload (entry visible at /history).
```

---

## Files to be touched

| File | Change |
|---|---|
| `app/src/app/(app)/inventory/page.tsx` | Add Upload + Download-sample buttons in header |
| `app/src/components/inventory-upload-modal.tsx` | **NEW** client component: drag-drop, CSV parse, preview, submit |
| `app/src/app/(app)/inventory/actions.ts` | **NEW or extend** `bulkUploadCourses(rows)`, returns reconciliation summary. Audit-logs. |
| `app/src/lib/csv.ts` | **NEW** small CSV parser (use `papaparse` or write a minimal one — header row + quoted fields) |
| `app/src/app/api/internal/sample-courses-csv/route.ts` | **NEW** GET endpoint that returns the sample CSV as a download (set `Content-Disposition: attachment`) |
| `docs/runbook.md` | Add "Bulk-upload courses" section so admins find it later |

No schema migration needed — `courses` and `categories` tables already have all the columns we need.

Effort: ~2 hours of code + 30 min local verify + 15 min docs update.

---

## Open decisions for you

| # | Decision | My recommendation |
|---|---|---|
| 1 | Embedding handling: A (lag + script), B (Voyage in Vercel), C (webhook) | **A** for v1. Surface the banner. Upgrade to B if lag bothers anyone. |
| 2 | Duplicate detection key: `num` only, `name+category` only, or `num` → fallback to `name+category` | **`num` first, fallback to `name+category`**. Best of both — handles missing `num` gracefully without false-merging. |
| 3 | What to do on conflict (same `num`, different name) | **Skip + report**. Never overwrite. Admin investigates manually. |
| 4 | Should the modal also accept an Excel `.xlsx`? | **CSV only for v1**. Excel needs `xlsx` library (~300KB) and adds edge cases. Users can Save As CSV. |
| 5 | Max upload size | **5 MB / ~50K rows**. Edstellar has <2K courses today; gives ~25× headroom. |
| 6 | Should the result panel offer a "download all errors as CSV" button? | **Yes if conflicts ≥ 1**. Lets admin paste the rows back, fix, re-upload. |
| 7 | Should we also support a separate "upload categories" CSV (for batch metadata edits)? | **No for v1**. Auto-create from courses CSV is enough. Admin edits individual categories on `/categories` if needed. |
| 8 | Where the audit log entry lives | **`/history` → Decisions tab**, action label `courses.bulk_upload`. Matches the existing pattern. |
| 9 | Who can upload — admin only or any reviewer? | **Admin only**. Matches the rest of `/inventory` and `/categories` permissions; consistent with proxy.ts ADMIN_PATHS. |

If you accept all defaults, say **"go with all defaults on bulk-upload"** next time and I'll execute.

---

## What this doesn't solve (and what would come next)

These are deliberately out of scope for v1 but worth noting if/when they bite:

1. **Re-sync from production website** — automatic scraping of edstellar.com so you don't have to maintain the CSV. Would need: web scraper / sitemap parser / Edstellar internal API. Bigger project.
2. **Update existing courses** — if a course's link changes on production, this upload won't update it. Pure ingest-only. To update, run SQL directly OR rebuild this as an upsert with an explicit "overwrite" flag.
3. **Delete archived courses** — same: ingest-only. If Edstellar archives a course, the agent will still see it. Mitigation: add a `is_archived` column later.
4. **Reverse direction** — export `course-agent.courses` to a CSV for review. Easy add later.
5. **Auto-promote uploaded courses to "approved" suggestions** — none of this touches `suggestions`. The agent's flow is separate.

---

## Why we're solving it this way (vs alternatives)

| Approach | Verdict |
|---|---|
| Direct DB writes via SQL | Admins shouldn't need Studio access for routine course adds. |
| Edit Edstellar's CMS to write back to course-agent DB | Coupling the two systems is fragile. CSV import is loosely coupled. |
| Build a scraper that auto-syncs | High effort for a problem the CSV upload solves in 2 hours. |
| Have the agent itself scrape edstellar.com | Same — adds infrastructure for a non-core problem. |
| Single-row "Add course" form | Doesn't scale when adding 50 courses at once after a partnership import. |

CSV upload is the lightest-weight tool that solves the actual problem: keeping the agent's view of the catalogue current after multi-source updates.

---

## When you come back

1. Read the **Open decisions** table.
2. Reply with either **"go with all defaults on bulk-upload"** or "go with these changes: …".
3. I will:
   - Build the modal + server action + sample-CSV endpoint
   - Wire to `/inventory` page header
   - Verify end-to-end with a test CSV
   - Update `docs/runbook.md` with the new "How to add courses in bulk" section
   - Commit + push

Estimated session time: 2 hours including verify + docs.

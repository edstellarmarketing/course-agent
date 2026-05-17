# Phase 7 — Email + Slack Notifications

Sister-doc to `phase2.md`, `phase3.md`, `phase5.md`, `phase6.md`,
and `gas-email-relay.md`. The build plan says *what* Phase 7 ships;
this doc walks the work in the order it happens at a keyboard.

**Goal:** A finished agent run pings reviewers without anyone
opening a tab. Engine writes the `agent_runs` row, POSTs to a
shared-secret webhook on the Next.js app, the app renders the day's
pending suggestions as an HTML email and sends it via the GAS relay
that's been wired since Phase 2. Optional Slack ping fires from the
engine on the same beat.

**Duration:** ~1-2 focused days. The infrastructure (GAS relay,
session client, agent_runs table) already exists; Phase 7 is mostly
plumbing two pieces together and writing one HTML template.

**Acceptance — Phase 7 is done when:**

- `pnpm --dir app smoke` is **3/3 green** (the GAS unauthorized
  failure that's been carried since Phase 2 / 5 / 6 is fixed first
  as Step 1 — the digest path can't ship until the relay accepts
  our secret).
- Manually trigger `uv --directory engine run agent run --category
  "Risk Management" --top-k 1 --max-candidates 6`. Within **30
  seconds** of the run finishing, a digest email lands in the
  reviewer's inbox (`marketing@edstellar.com` by default) with:
  - Subject line including the run id's first 8 chars + run date.
  - One card per pending suggestion grouped by category.
  - A "Review now →" deep link to `/suggestions/today`.
  - The dashboard-tile metrics (pending count, 7d approval rate)
    in the header so the email is glanceable on a phone.
- Clicking the link signs the reviewer in (if needed via the
  existing Supabase Auth middleware) and lands on
  `/suggestions/today`.
- Triggering a run that produces **zero** persisted candidates
  sends a digest that says *"No new suggestions today — agent
  skipped saturated categories."* — not a broken empty card.
- If `SLACK_WEBHOOK_URL` is set in `engine/.env`, the same run
  fires a Slack message: *"Course agent run complete — N
  candidates pending review. <link>"*. If the var is unset, Slack
  silently skips (no error).
- `uv --directory engine run smoke` still 6/6 green.
- The engine→app webhook rejects calls without the correct
  `INTERNAL_WEBHOOK_SECRET` header (401), and accepts calls with
  it (200 → digest fires).

---

## Where exactly we are coming in

Snapshot at start of Phase 7 work:

| Layer | State |
|---|---|
| GAS email relay | ⚠️ Wired in Phase 2; smoke check #1 has been failing since then (`unexpected body: {"error":"unauthorized"}`). Either the script's `SHARED_SECRET` and the app's `GAS_EMAIL_SHARED_SECRET` env var disagree, OR the relay URL in `.env.local` is still pointing at the pre-hardening script. `gas-email-relay.md` § Troubleshooting has the full diagnostic flow — Phase 7 Step 1 walks it. |
| `agent_runs` table | ✅ Already has `started_at`, `finished_at`, `candidates_produced`, `candidates_persisted`. Phase 6 writes one row per run. The webhook payload reads from this table by `run_id`. |
| `suggestions` table | ✅ 14 pending rows in the queue right now (7 real Phase 6 + 7 remaining seed). |
| Phase 5 review UI | ✅ `/suggestions/today` reads live. The email's deep link goes straight there. |
| Engine CLI | ✅ `agent run` returns a real `run_id` from the persist node. Phase 7 adds a final HTTP POST step after persistence. |
| Supabase Auth | ✅ Magic-link login wired in Phase 3. Clicking the deep link from email lands on `/login` first if the reviewer's session is expired; the existing middleware redirects back to `/suggestions/today` after auth. |

Last known good commit on `main`: `5701ae4` ("docs/phase6.md:
actual outcomes + Phase 8 backlog").

### One-time housekeeping before Step 1

1. **Run both smokes to confirm baseline:**
   ```powershell
   pnpm --dir "C:\Users\Vijay\Downloads\Course-Agent\app" smoke
   uv  --directory "C:\Users\Vijay\Downloads\Course-Agent\engine" run smoke
   ```
   Expected: app 2/3 (GAS unauthorized — the thing Step 1 fixes),
   engine 6/6. If anything else is failing, fix it before Phase 7.

2. **Find the GAS Apps Script project** (`Course-Agent Email Relay`
   per `gas-email-relay.md`) at <https://script.google.com>.
   Confirm the project still exists and you can edit it. You'll
   need both the `/exec` URL and the `SHARED_SECRET` script property
   value in Step 1.

3. **Decide on a Slack channel** (optional). If you want Slack pings,
   create an incoming-webhook integration in the Edstellar workspace
   pointing at the channel you want. Grab the webhook URL. If you
   skip this, Phase 7 still ships — the Slack path no-ops.

---

## Pre-flight — decisions to make before opening the editor

| Decision | Recommendation | Why |
|---|---|---|
| Email rendering | **Plain TypeScript HTML-literal template** in `app/src/lib/email/digest-template.ts` | React Email is overkill for one template. A 100-line `function renderDigestHtml(props): string` is reviewable in diffs, has zero new deps, and renders deterministically. Phase 9 can graduate if multiple templates emerge. |
| Server Action location | **`app/src/lib/email/send-digest.ts`** (not under `(app)/`) | This is internal-only — never called from a Client Component, only from the API route in Step 3. Keeping it out of the `(app)` tree is a small clarity win. Marked `"use server"` so it can still be imported as a Server Action if Phase 8's `/learning` page wants a "send test digest" button. |
| Webhook auth | **Shared secret in the `x-internal-webhook-secret` header** + constant-time compare | Same pattern as the GAS relay. Two distinct secrets (`INTERNAL_WEBHOOK_SECRET` for engine→app; `GAS_EMAIL_SHARED_SECRET` for app→GAS) — never reuse. Generate with `openssl rand -hex 16`. |
| Webhook URL path | **`/api/internal/run-complete`** (App Router route handler) | `internal/` prefix signals "never call from browser"; the route handler returns 401 on missing/bad secret regardless of HTTP method. |
| Engine → webhook trigger | **In the engine's `persist` node, after the `agent_runs` row is written** — fire-and-forget POST with a 5s timeout | Avoids adding a separate "notify" node just for one HTTP call. Failure shouldn't kill a successful run; log + continue. |
| Slack | **Direct POST to `SLACK_WEBHOOK_URL` from the engine, gated on env var presence** | No SDK. The webhook URL is the auth. If unset, the engine emits one INFO log line and moves on. |
| Recipient list | **Hard-coded array in `app/src/lib/email/recipients.ts`** for Phase 7 — `["marketing@edstellar.com"]` to start | Phase 8's `/settings` page can move this to DB-backed. Keeping it static in Phase 7 sidesteps a roundtrip to the `reviewers` mock vs auth.users debate that Phase 5 deferred. |
| Empty-queue behaviour | **Still send the email, with copy that says "No new suggestions today"** | Silence is worse than a brief no-news email — reviewers count on the morning ping to know the agent ran. |
| Webhook idempotency | **Engine sends `run_id` in the payload; app's route handler uses it as the email's `Message-ID` header** | If the engine retries (which it doesn't today but might in Phase 9), Gmail's threading dedupes by Message-ID. |

If any of these change, the schema stays the same — only the code does.

---

## Step-by-step

Each step ends with a `verify:` line you can run before moving on.
Steps are deliberately small so they're easy to commit one at a
time.

### Step 1 — Fix the GAS smoke

This is the long-running blocker; see `gas-email-relay.md` §
Troubleshooting for the full flow. The likely cause is one of:

1. `app/.env.local` `GAS_EMAIL_WEBHOOK_URL` still points at the
   pre-hardening script.
2. The Apps Script Properties Service has the secret in **User
   Properties** instead of **Script Properties**.
3. `GAS_EMAIL_SHARED_SECRET` in `.env.local` doesn't match the
   value saved in Apps Script (whitespace, wrong rotation).

Walk:

1. Open the `Course-Agent Email Relay` project in script.google.com.
2. **Project Settings → Script properties.** Confirm `SHARED_SECRET`
   exists with the same value as `app/.env.local`'s
   `GAS_EMAIL_SHARED_SECRET`. If unsure, paste the
   `debugProps` helper from `gas-email-relay.md` § Troubleshooting,
   run it, read the length from logs, compare to your `.env.local`.
3. **Manage deployments.** Confirm the active deployment is the
   *hardened* one (the `Code.gs` listed in `gas-email-relay.md`).
   If there's a stale older deployment with a different `/exec`
   URL, that's what `.env.local` might be pointing at.
4. Update `app/.env.local` if needed; restart any running dev server
   so it re-reads env.

**verify:**
```powershell
pnpm --dir app smoke
# expect: 3/3 green. The "GAS email webhook accepts the shared secret"
# line is the one Step 1 turns green.
```

---

### Step 2 — Write the digest HTML template

Create `app/src/lib/email/digest-template.ts`:

```typescript
export interface DigestProps {
  runId: string;
  finishedAt: string;       // ISO timestamp
  modelUsed: string;
  categoriesTargeted: string[];
  candidatesPersisted: number;
  pendingTotal: number;     // includes seed + carried-over
  approvalRate7d: number;   // 0-1
  // Top 6 pending suggestions for the email body — full queue
  // sits behind the "Review now →" link.
  preview: Array<{
    id: string;
    title: string;
    category: string;
    suggestedPriceUsd: number;
    durationDays: number;
  }>;
  reviewerName: string;     // "Hi {name}," — fall back to "Hi there,"
  appUrl: string;           // e.g. "https://app.edstellar.com"
}

export function renderDigestHtml(p: DigestProps): string {
  // Single big HTML literal. Tested against Gmail + Outlook web by
  // sending to yourself once before Step 5 wires it in.
  // …
}

export function renderDigestSubject(p: DigestProps): string {
  return `Course Agent — ${p.candidatesPersisted} new suggestion${
    p.candidatesPersisted === 1 ? "" : "s"
  } [run ${p.runId.slice(0, 8)}]`;
}
```

Style notes:

- Inline styles only (Gmail strips `<style>`). Tailwind-style
  utility classes don't work — every CSS property goes on each tag.
- Single column, 600px max width, body text 16px, table-based
  layout for the suggestion cards. CSS-grid emails are still flaky
  in Outlook in 2026.
- Hard-coded colours: navy `#1a2540`, orange accent `#f97316`,
  off-white `#fafaf9`. These match the app's palette so the email
  reads as "from the same product".
- Test in Gmail by sending one to yourself before going further.

**verify:**
```powershell
# Tiny vitest spec — confirms the template returns non-empty HTML
# and the subject includes the run id prefix.
pnpm --dir app exec vitest run src/lib/email/digest-template.test.ts
```

---

### Step 3 — Write the route handler `/api/internal/run-complete`

Create `app/src/app/api/internal/run-complete/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { env } from "@/lib/env";
import { sendDigestForRun } from "@/lib/email/send-digest";

export async function POST(req: Request) {
  // Constant-time compare on the header secret. Same pattern as
  // the GAS relay's doPost.
  const h = await headers();
  const provided = h.get("x-internal-webhook-secret") ?? "";
  const expected = env().INTERNAL_WEBHOOK_SECRET;
  if (!provided || !constantTimeEquals(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const runId: string | undefined = body?.run_id;
  if (!runId) {
    return NextResponse.json(
      { error: "missing_field", field: "run_id" },
      { status: 400 },
    );
  }

  const result = await sendDigestForRun(runId);
  return NextResponse.json(result);
}
```

`sendDigestForRun(runId)` in `app/src/lib/email/send-digest.ts`:

1. Loads the `agent_runs` row by id.
2. Loads up to 6 pending `suggestions` for the email preview (full
   queue lives behind the deep link).
3. Loads the dashboard tile metrics — pending count, 7d approval
   rate — via the same query helpers Phase 5 already has.
4. Renders the HTML via Step 2's template.
5. POSTs to the GAS relay with `{to, subject, html, secret}`.
6. Returns `{ok: true, sent_to: [...], message_id: runId}`.

Add `INTERNAL_WEBHOOK_SECRET` to `app/src/lib/env.ts` as a required
server-only var.

**verify:**
```powershell
# With the dev server running:
$secret = (Get-Content app/.env.local | Select-String "INTERNAL_WEBHOOK_SECRET" | ForEach-Object { ($_ -split "=", 2)[1] })
# 401 path:
curl.exe -i -X POST http://localhost:3000/api/internal/run-complete -d "{}" -H "content-type: application/json"
# expect: HTTP/1.1 401 Unauthorized

# Pick a real run_id from `agent_runs` and trigger the digest:
curl.exe -i -X POST http://localhost:3000/api/internal/run-complete `
  -H "content-type: application/json" `
  -H "x-internal-webhook-secret: $secret" `
  -d '{"run_id":"<paste a run_id>"}'
# expect: HTTP/1.1 200 + {"ok":true,...}; email arrives in inbox.
```

---

### Step 4 — Engine fires the webhook on run completion

After the persist node finishes (`persist.run()` returns), POST to
the webhook URL. Two ways to wire it:

- **Inside persist.py** — simplest, no new node. Add a
  `_notify_app(run_id)` helper that fires a 5s-timeout POST and
  swallows any error with a warning log. Run failure should never
  cascade from a notification hiccup.
- **As an explicit `notify` node after persist** — closer to the
  architectural plan §4 step 8. More work for the same outcome;
  prefer the inline helper for Phase 7.

Add to `engine/src/engine/config.py`:

```python
internal_webhook_url: HttpUrl | None = Field(
    default=None, alias="INTERNAL_WEBHOOK_URL",
)
internal_webhook_secret: str | None = Field(
    default=None, alias="INTERNAL_WEBHOOK_SECRET", min_length=16,
)
slack_webhook_url: HttpUrl | None = Field(
    default=None, alias="SLACK_WEBHOOK_URL",
)
```

Both `internal_webhook_*` are optional — if either is missing the
engine skips the notify step with one log line (`notify skipped:
INTERNAL_WEBHOOK_URL unset`). Keeps local dev frictionless.

**verify:**
```powershell
# Set INTERNAL_WEBHOOK_URL=http://localhost:3000/api/internal/run-complete
# and INTERNAL_WEBHOOK_SECRET=<the same hex you put in app/.env.local>
# in engine/.env, then:
uv --directory engine run agent run --category "Risk Management" `
  --top-k 1 --max-candidates 6
# expect: run completes, engine logs "notify webhook=200", inbox has
# the digest within 30 seconds.
```

---

### Step 5 — Optional Slack ping from the engine

In the same `_notify_app` helper (or a sibling `_notify_slack`),
when `SLACK_WEBHOOK_URL` is set:

```python
httpx.post(
    str(cfg.slack_webhook_url),
    json={
        "text": (
            f":sparkles: *Course Agent run complete*\n"
            f"{persisted} new suggestion(s) pending review in "
            f"{', '.join(targeted) or 'no categories'}.\n"
            f"<{app_url}/suggestions/today|Review now →>"
        ),
    },
    timeout=5.0,
)
```

Slack incoming-webhook payload is documented at
<https://api.slack.com/messaging/webhooks>; the `<url|label>`
syntax renders as a hyperlink. Phase 9 may swap for Block Kit if
the digest grows.

**verify:** with `SLACK_WEBHOOK_URL` set in `engine/.env`, re-run
the same `agent run` command from Step 4. Slack channel gets a
message within seconds.

---

### Step 6 — End-to-end + the empty-queue path

Manual test:

1. With both `INTERNAL_WEBHOOK_URL` and `SLACK_WEBHOOK_URL` set,
   run a normal `agent run --category X --top-k 1`.
2. Confirm: agent_runs row inserted, suggestions persisted, digest
   email arrives, Slack pings.
3. Then deliberately tighten `max-candidates` to force a zero-
   persistence scenario:
   ```
   agent run --category "Quality Management" --top-k 1 --max-candidates 2
   ```
   With 2 raw candidates and Rule 7's strictness, this often
   produces 0 survivors. Verify the digest still sends — copy
   reads "No new suggestions today — agent skipped saturated
   categories."

**verify:** both flows produce an email; the empty-queue email is
visually distinct (no suggestion cards, prominent "agent skipped"
explanation) and the deep link still works.

---

## Acceptance verification

| Check | Method |
|---|---|
| `pnpm --dir app smoke` 3/3 green | smoke output |
| Digest email arrives within 30s of run end | timer + inbox |
| Subject includes run-id prefix + count | inbox |
| Deep link routes to `/suggestions/today` (via login if needed) | click manually |
| Empty-queue case sends "agent skipped" copy | force-trigger via tiny `max-candidates` |
| Slack message fires when `SLACK_WEBHOOK_URL` set | watch channel |
| Slack skip is silent when unset | unset the var, re-run, no error |
| Webhook 401s without secret | `curl` from Step 3 verify |
| Engine smoke `uv run smoke` still 6/6 green | smoke output |
| Phase 6 didn't regress | re-run `agent gap-analyze --top-k 5`, confirm pinned categories still on top |

---

## Gotchas worth knowing in advance

- **Gmail's daily quota.** Free Gmail: ~100 outgoing emails/day.
  Workspace: ~1,500/day. We're sending 1-3 reviewers × 1 digest
  per run × maybe 5 runs/day = 15. Plenty of headroom, but Phase 8
  may want to add multiple categories per run → still fine.

- **DKIM/SPF on the sender mailbox.** If you change which Google
  account `MailApp.sendEmail` runs as, the receiving inbox may
  start flagging the digest as spam until DKIM warms up. Sticking
  with the original Phase 2 sender account is the safe path.

- **Don't send digests from the dev environment to real reviewers.**
  In dev, set the `SMOKE_SINK_EMAIL` style override (e.g.
  `DIGEST_RECIPIENTS_OVERRIDE=marketing@edstellar.com`) so testing
  doesn't spam Priya at 2am.

- **The webhook secret must be ≥ 16 chars and never logged.** The
  Python config validator should enforce `min_length=16`. The route
  handler should never echo it back even in error responses.

- **Localhost ↔ Supabase auth interaction.** The deep link is
  `http://localhost:3000/suggestions/today` in dev. Clicking it
  from an email may not pick up an existing session cookie because
  the browser treats the email-client iframe + localhost as
  separate sites. Test by signing in first in the same browser,
  then clicking the link — works reliably.

- **HTML email rendering quirks.** Outlook desktop renders inline
  CSS but ignores margin between table rows; use `<tr><td
  height="N"></td></tr>` spacers, not `margin-bottom`. Test in
  Gmail + Outlook web at minimum before going live.

- **Empty `categories_targeted`.** If a future scheduler triggers
  a run with no targeted categories (shouldn't happen but…), the
  digest copy should handle it: "Agent ran but targeted no
  categories — likely a scheduling misconfiguration." That keeps
  the email informative instead of opaque.

- **Rate-limit the webhook.** A misbehaving engine retry loop could
  ping the route handler hundreds of times. Phase 7 doesn't add a
  rate limiter (assumed 1 run/day), but if Phase 9 introduces
  retries, add one (e.g. one digest per `run_id` per hour).

---

## What's deliberately not in Phase 7

- **DB-backed reviewer recipients.** Phase 8's `/settings` page
  will let admins manage the list; Phase 7 hard-codes
  `marketing@edstellar.com`.
- **Cron / scheduled trigger.** Phase 7 fires the digest *only*
  when the engine finishes a manual run. Phase 8 wires a daily
  cron (or Prefect) that triggers `agent run` at 03:00 UTC and the
  digest flows naturally from there.
- **Per-reviewer-personalized digest.** Today every recipient sees
  the same email. Phase 8 may add "assigned to you" filtering once
  `suggestions.assignee_id` lands.
- **Rich email analytics.** Open rates, click tracking — not in
  Phase 7. The GAS relay doesn't track them and we don't need them
  yet.
- **In-app notifications.** Bell icon + unread badge — Phase 9.
- **Sentry alerts on webhook 5xx.** Phase 9 — Sentry plumbing
  lands there.

---

## Done means

- [ ] `pnpm --dir app smoke` 3/3 green (Step 1 fix).
- [ ] `app/src/lib/email/digest-template.ts` returns valid HTML
      that renders correctly in Gmail + Outlook web.
- [ ] `app/src/lib/email/send-digest.ts` wires the GAS relay POST,
      handles the empty-queue path, returns `{ok:true,...}`.
- [ ] `app/src/app/api/internal/run-complete/route.ts` is up,
      constant-time-compares the secret, 401s without it.
- [ ] `engine/src/engine/agent/nodes/persist.py` POSTs to the
      webhook after writing agent_runs; failure is a warning, not
      a run-killer.
- [ ] Slack ping fires when `SLACK_WEBHOOK_URL` set; silently
      skipped when not.
- [ ] Manual `agent run` produces a digest email within 30s,
      end-to-end.
- [ ] Empty-queue copy verified by a force-zero run.
- [ ] Both smokes (`pnpm smoke`, `uv run smoke`) still green.
- [ ] Committed on `main` as "Phase 7: email digest + slack pings".

---

## When you resume — for Phase 8

1. Open `docs/phase8.md` (not written yet — Phase 6's backlog at
   the bottom of `phase6.md` is the seed material).
2. Run all three smokes to confirm Phases 4-7 didn't drift.
3. Phase 8 is the closed feedback loop: Rule 9 going live against
   real embedded rejections, few-shot injection per category,
   prompt-version A/B testing, and the `/learning` admin page.
   ~5-7 days. Bring your sample-size assumptions in writing — the
   architectural plan §3.8(b) calls out that two runs of 5
   candidates is not statistically meaningful, and the doc should
   say so out loud in the `/learning` UI.

Last known good commit on `main`: see `git log --oneline -7`.

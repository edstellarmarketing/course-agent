# GAS email relay — hardened `doPost`

Phase 2 of the build (see `phase2.md §5`) needs a Google Apps Script email webhook that requires a shared secret. The previous Edstellar GAS endpoint accepts any caller — anyone with the `/exec` URL can send mail through it.

> **Don't modify the existing script.** Create a **new Apps Script project** dedicated to course-agent.
>
> The existing script is in use by other projects whose callers don't send a `secret` field. Hardening the existing `doPost` would break them silently. Isolating the script for course-agent also means: per-project secret rotation, independent `/exec` URLs, and clean execution logs when something fails at 3am.
>
> The Gmail/Workspace daily-send quota is **per-account**, not per-script, so a new project doesn't get you more headroom — it gets you cleaner separation. Same sender, separate code.

## What to do

1. Go to <https://script.google.com> while signed in as the sender account.
2. **New project** → name it `Course-Agent Email Relay`.
3. Paste the code in **`Code.gs`** at the bottom of this doc, replacing the default `myFunction` stub.
4. Generate a 32-char secret:
   ```bash
   openssl rand -hex 16
   ```
5. In the project: **Project Settings → Script properties → Add property**
   - Key: `SHARED_SECRET`
   - Value: paste the secret you just generated.
6. **Deploy → New deployment → Web app.**
   - Execute as: *Me* (or whichever account owns the sender mailbox).
   - Who has access: *Anyone* (this URL is a secret + the body needs the shared secret).
   - **Click Authorise** when prompted — you're granting the new project permission to send mail on your behalf.
7. Copy the new `/exec` URL — this is your course-agent-only relay URL.
8. In `app/.env.local`:
   ```
   GAS_EMAIL_WEBHOOK_URL=<the new /exec URL>
   GAS_EMAIL_SHARED_SECRET=<the same secret you put in Script Properties>
   ```
9. Run `pnpm --dir app smoke` — both GAS checks should turn green.

> **Note on future redeploys:** every time you click *New deployment*, Apps Script issues a new `/exec` URL. Once you have a working URL in env, use *Manage deployments → Edit → New version → Deploy* to publish changes against the **same** URL.

## Why this matters

Without the secret check, a leaked URL becomes a free spam relay sending from your Workspace's Gmail — which would impact your domain's sender reputation across every recipient, not just course-agent traffic. The smoke test catches this regression every time it runs.

## What the script does

- Reads the JSON body.
- Compares `body.secret` against the `SHARED_SECRET` script property in **constant time** (timing-safe — defeats the rare side-channel attack that compares character by character).
- Sends via `MailApp.sendEmail` if everything matches.
- Returns `{ "ok": true }` on success, `{ "error": "..." }` with the right HTTP status otherwise.

The smoke test accepts both `{ok:true}` and `{success:true}` so either convention works.

## `Code.gs`

```javascript
/**
 * Course-Agent email relay — Phase 2 hardened doPost.
 *
 * Required POST body:
 *   {
 *     "to":      "recipient@edstellar.com",
 *     "subject": "Subject line",
 *     "html":    "<p>HTML body</p>",
 *     "secret":  "<must match Script Properties → SHARED_SECRET>"
 *   }
 *
 * Optional fields the Phase 7 digest job will start using:
 *   "cc", "bcc", "replyTo", "name" (sender display name)
 */
function doPost(e) {
  const SECRET = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!SECRET) {
    return jsonResponse({ error: 'server_misconfigured' });
  }

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (_err) {
    return jsonResponse({ error: 'invalid_json' });
  }

  // Timing-safe comparison so an attacker can't probe the secret one
  // character at a time.
  if (!body.secret || !constantTimeEquals(String(body.secret), SECRET)) {
    return jsonResponse({ error: 'unauthorized' });
  }

  // Validate the rest of the payload.
  if (!body.to || !body.subject || !body.html) {
    return jsonResponse({ error: 'missing_fields', need: ['to', 'subject', 'html'] });
  }

  try {
    MailApp.sendEmail({
      to: String(body.to),
      cc: body.cc ? String(body.cc) : undefined,
      bcc: body.bcc ? String(body.bcc) : undefined,
      replyTo: body.replyTo ? String(body.replyTo) : undefined,
      name: body.name ? String(body.name) : 'Edstellar Course Agent',
      subject: String(body.subject),
      htmlBody: String(body.html),
    });
  } catch (err) {
    return jsonResponse({ error: 'send_failed', detail: String(err) });
  }

  return jsonResponse({ ok: true });
}

/**
 * Returns a JSON response. Apps Script can't set HTTP status codes directly
 * on doPost responses, so callers should look at the body shape:
 *   - { ok: true }      → success
 *   - { error: "..." }  → failure (and HTTP 200, unfortunately)
 *
 * To make the smoke test work with this constraint, the wrapper detects
 * `{error: "unauthorized"}` and treats it as 401 client-side. See
 * app/scripts/smoke-test.ts.
 *
 * If you're not using the bundled smoke test and need real HTTP status codes,
 * front this script with a thin Cloudflare Worker that translates the body
 * shape to a status code. Not worth doing until Phase 7 needs it.
 */
function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Constant-time string comparison. Apps Script doesn't ship a built-in for
 * this, so we roll a tiny one — adequate for short, fixed-length secrets
 * compared against attacker-controlled input.
 */
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
```

# Phase 2 — Environment & API Key Wiring

Sister-doc to `edstellar_agent_build_plan.md`. The build plan describes *what* Phase 2 produces; this doc describes *exactly how to get there*, in the order it actually happens at a keyboard.

**Goal:** every external service the system depends on answers a smoke test from each app, before any business logic depends on it.

**Duration:** 1–2 focused days (one engineer). Most of the wall-clock time is account approvals and billing setup, not code.

**Acceptance — Phase 2 is done when:**

- `pnpm --dir app smoke` exits 0 with a ✓ for every required service.
- `uv --directory engine run smoke` exits 0 with a ✓ for every required service.
- A deliberately missing key (e.g. `unset OPENROUTER_API_KEY`) fails fast with a clear *“OPENROUTER_API_KEY is required”* error — not a cryptic null-pointer deep inside a vendor SDK.
- The GAS email webhook rejects requests without the shared secret.
- An OpenRouter spend cap is set on the key.

---

## Pre-flight — decisions to make before you sign up for anything

| Decision | Recommendation | Why |
|---|---|---|
| Self-hosted Supabase vs Supabase Cloud | **Self-hosted** (already running on Edstellar infra per §5.1) | We control the network, the pgvector version, and the `course-agent` schema lives next to existing data |
| OpenRouter model in production | **`anthropic/claude-sonnet-4.6`** for research; **`anthropic/claude-haiku-4-5-20251001`** for the Rule 10 LLM judge | Sonnet for reasoning quality, Haiku for cheap fast filtering — matches the cost shape in §6 of the architectural plan |
| Voyage model | **`voyage-3-large`**, `input_type="document"` for courses, `input_type="query"` for new candidates | 1024-dim default, matches the `vector(1024)` column |
| Search provider | **Serper** as primary, Tavily as fallback | Cheaper per call, used directly by ScrapeGraphAI's `SearchGraph` |
| Email transport | **Google Apps Script `doPost` webhook** sending from the existing edstellar Gmail | No SES/Resend account, no SPF/DKIM dance — leverages the workspace's existing sender reputation |
| Observability backend | **Langfuse Cloud** for now (toggleable to self-host later) | One less thing to operate during Phase 2 |
| Error reporting | **Sentry (free tier)** for both apps | Already integrated into most JS/Python SDKs |

If any of these change, the env vars stay the same — only the values do.

---

## Service-by-service setup

Order is optimised for *fewest blockers first*. You can run steps in parallel where the doc says “*parallel-safe*.”

### 1. Supabase — the schema and its keys *(do this first — everything else depends on it)*

The Supabase instance already exists on Edstellar infra. Phase 3 creates the schema; Phase 2 just needs to talk to the instance.

- [ ] **Confirm the Supabase URL and that you can hit `/rest/v1/`.** `curl $SUPABASE_URL/rest/v1/ -H "apikey: $ANON_KEY"` should return a 401 with a JSON body (not a connection error).
- [ ] **Grab three keys** from the Supabase Studio → Settings → API:
  - `SUPABASE_URL` — public URL of the project.
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-safe, gated by RLS.
  - `SUPABASE_SERVICE_ROLE_KEY` — server-only, bypasses RLS. Used by Server Actions that need it and by the Python agent for inserts.
- [ ] **Store the service-role key as if it were the database password it effectively is.** Never paste it into a client component, never echo it in logs.

### 2. OpenRouter — the LLM gateway *(needs billing — start the account approval early)*

- [ ] **Sign up** at <https://openrouter.ai> with `vijay@edstellar.com`.
- [ ] **Add a payment method** and **set a hard monthly cap**. Start conservative — $50/month is enough for Phase 2 smoke tests and a few Phase 6 dry runs.
- [ ] **Create one API key per environment** (`course-agent-dev`, `course-agent-prod`). Don't share keys across environments — one runaway dev loop should not exhaust the prod budget.
- [ ] **Verify the production-shape model is reachable from the key:**
  ```bash
  curl https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"anthropic/claude-haiku-4-5-20251001","messages":[{"role":"user","content":"ping"}],"max_tokens":5}'
  ```
  Expect a 200 with a `choices[0].message.content` field. A 402 means the wallet is empty; a 403 usually means the key has model restrictions.

### 3. Voyage AI — embeddings *(parallel-safe with step 2)*

- [ ] **Sign up** at <https://www.voyageai.com>. The free tier covers Phase 2's smoke test and the initial 1,623-course backfill in Phase 4 with room to spare.
- [ ] **Generate a key**, name it `course-agent-dev`.
- [ ] **Verify the model and vector dimensions:**
  ```bash
  curl https://api.voyageai.com/v1/embeddings \
    -H "Authorization: Bearer $VOYAGE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"input":"ping","model":"voyage-3-large","input_type":"document"}'
  ```
  Expect `data[0].embedding.length === 1024`. If it's 2048 or 1536, you have the wrong model.

### 4. Serper — web search *(parallel-safe)*

- [ ] **Sign up** at <https://serper.dev> and copy the API key from the dashboard.
- [ ] **Confirm a search returns results:**
  ```bash
  curl -X POST https://google.serper.dev/search \
    -H "X-API-KEY: $SERPER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"q":"corporate training"}'
  ```
  Expect `organic[]` with at least 10 entries.

### 5. Google Apps Script — the email relay *(important security step)*

The existing GAS `doPost` accepts anything posted to it — which is fine for an internal tool until the URL leaks. Phase 2 locks it down.

- [ ] **Open the existing script** in the Edstellar Google Apps Script project.
- [ ] **Add a shared-secret check at the top of `doPost`:**
  ```javascript
  function doPost(e) {
    const SECRET = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    let body;
    try { body = JSON.parse(e.postData.contents); }
    catch { return jsonResponse(400, { error: 'invalid_json' }); }
    if (body.secret !== SECRET) return jsonResponse(401, { error: 'unauthorized' });

    // ... existing send-email logic, but use body.to / body.subject / body.html ...

    return jsonResponse(200, { ok: true });
  }
  function jsonResponse(code, payload) {
    return ContentService.createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  }
  ```
- [ ] **Set the secret** in *Project Settings → Script properties* → key `SHARED_SECRET`, value = a 32-char random string (`openssl rand -hex 16`).
- [ ] **Re-deploy as Web App**, executing as the script owner, accessible to *Anyone*. Copy the new `/exec` URL — that's `GAS_EMAIL_WEBHOOK_URL`.
- [ ] **Smoke-send to a sink address you own**, not a real reviewer:
  ```bash
  curl -X POST "$GAS_EMAIL_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d '{"to":"you+phase2@edstellar.com","subject":"Phase 2 smoke","html":"<b>ok</b>","secret":"'"$GAS_EMAIL_SHARED_SECRET"'"}'
  ```
  Expect `{"ok":true}`. Then drop the secret field — should get `{"error":"unauthorized"}`.

### 6. Slack — run-complete pings *(optional, parallel-safe, ~5 min)*

- [ ] **Create an Incoming Webhook** in the workspace, scoped to `#course-agent-runs` (or whatever channel you want).
- [ ] **Verify:** `curl -X POST -H 'Content-type: application/json' --data '{"text":"phase 2 smoke"}' $SLACK_WEBHOOK_URL` — message should appear in the channel within seconds.

### 7. Sentry — error reporting *(optional, parallel-safe)*

- [ ] Two Sentry projects: `edstellar-course-agent-app` (JavaScript/Next.js platform) and `edstellar-course-agent-engine` (Python platform). Copy each DSN into the respective env file.

### 8. Langfuse — agent-run tracing *(optional, parallel-safe)*

- [ ] **Sign up at <https://cloud.langfuse.com>**, create a project named `course-agent`.
- [ ] Copy the public key, secret key, and host into the engine `.env`.

---

## Env files — what goes where

After step 8 you should have collected ~13 variables. Two files, both gitignored:

**`app/.env.local`** *(Next.js dashboard)*
```env
SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GAS_EMAIL_WEBHOOK_URL=
GAS_EMAIL_SHARED_SECRET=
SLACK_WEBHOOK_URL=        # optional
SENTRY_DSN=               # optional
```

**`engine/.env`** *(Python agent)*
```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENROUTER_API_KEY=
VOYAGE_API_KEY=
SERPER_API_KEY=
LANGFUSE_PUBLIC_KEY=      # optional
LANGFUSE_SECRET_KEY=      # optional
LANGFUSE_HOST=            # optional
SENTRY_DSN=               # optional
```

The `.env.example` templates in both `app/` and `engine/` already list these — committed in Phase 0. Update them if any keys change name.

---

## Env validation — fail loud at startup

### Next.js side — Zod

Create `app/src/lib/env.ts`:

```typescript
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  GAS_EMAIL_WEBHOOK_URL: z.string().url(),
  GAS_EMAIL_SHARED_SECRET: z.string().min(16),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(40),
});

const parsed = {
  ...serverEnvSchema.safeParse(process.env),
  ...clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }),
};

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables — see error above.");
}

export const env = parsed.data;
```

Import this from `app/src/app/layout.tsx` so the check runs on every server boot.

### Python side — Pydantic Settings

Create `engine/src/engine/config.py`:

```python
from functools import lru_cache
from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

class EngineSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: HttpUrl = Field(..., alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(..., min_length=40, alias="SUPABASE_SERVICE_ROLE_KEY")
    openrouter_api_key: str = Field(..., min_length=20, alias="OPENROUTER_API_KEY")
    voyage_api_key: str = Field(..., min_length=20, alias="VOYAGE_API_KEY")
    serper_api_key: str = Field(..., min_length=20, alias="SERPER_API_KEY")

    langfuse_public_key: str | None = Field(default=None, alias="LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key: str | None = Field(default=None, alias="LANGFUSE_SECRET_KEY")
    langfuse_host: HttpUrl | None = Field(default=None, alias="LANGFUSE_HOST")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")

@lru_cache
def settings() -> EngineSettings:
    return EngineSettings()  # raises ValidationError on missing/invalid
```

Add the deps with `uv add pydantic pydantic-settings`.

---

## Smoke test scripts — the "wires plugged in" proof

### `app/scripts/smoke-test.ts`

Run with `pnpm --dir app smoke`. Add to `app/package.json`:

```json
"scripts": {
  "smoke": "tsx scripts/smoke-test.ts"
}
```

(`uv add` `tsx` as a dev dep first: `pnpm add -D tsx`.)

The script hits each service from the Next.js side and prints a ✓ or ✗ per service:

```typescript
import { env } from "../src/lib/env";

type Check = { name: string; run: () => Promise<void> };

const checks: Check[] = [
  {
    name: "Supabase reachable",
    async run() {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      });
      if (!res.ok && res.status !== 401) throw new Error(`HTTP ${res.status}`);
    },
  },
  {
    name: "GAS email webhook accepts secret",
    async run() {
      const res = await fetch(env.GAS_EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "smoke-sink@edstellar.com",
          subject: "phase 2 smoke",
          html: "<b>ok</b>",
          secret: env.GAS_EMAIL_SHARED_SECRET,
        }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(JSON.stringify(body));
    },
  },
  {
    name: "GAS email webhook rejects bad secret",
    async run() {
      const res = await fetch(env.GAS_EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "smoke-sink@edstellar.com",
          subject: "should not arrive",
          html: "x",
          secret: "wrong",
        }),
      });
      if (res.status !== 401) {
        throw new Error(`expected 401, got ${res.status}`);
      }
    },
  },
  ...(env.SLACK_WEBHOOK_URL
    ? [{
        name: "Slack webhook",
        async run() {
          const res = await fetch(env.SLACK_WEBHOOK_URL!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "phase 2 smoke" }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        },
      }]
    : []),
];

let failed = 0;
for (const c of checks) {
  try {
    await c.run();
    console.log(`✓ ${c.name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${c.name}: ${(err as Error).message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
```

### `engine/scripts/smoke_test.py`

Run with `uv --directory engine run smoke`. Add the entry point to `engine/pyproject.toml`:

```toml
[project.scripts]
engine = "engine:main"
smoke = "engine.scripts.smoke_test:main"
```

The script:

```python
import sys
import httpx
from engine.config import settings

def check(name: str, fn) -> bool:
    try:
        fn()
        print(f"✓ {name}")
        return True
    except Exception as e:
        print(f"✗ {name}: {e}", file=sys.stderr)
        return False

def main() -> None:
    cfg = settings()
    ok = True

    def supabase():
        r = httpx.get(f"{cfg.supabase_url}/rest/v1/", headers={"apikey": cfg.supabase_service_role_key})
        # 401 means we reached it but the path isn't world-readable — counts as success
        if r.status_code not in (200, 401):
            raise RuntimeError(f"HTTP {r.status_code}")

    def openrouter():
        r = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {cfg.openrouter_api_key}"},
            json={
                "model": "anthropic/claude-haiku-4-5-20251001",
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 5,
            },
            timeout=30.0,
        )
        r.raise_for_status()
        if not r.json()["choices"][0]["message"]["content"]:
            raise RuntimeError("empty completion")

    def voyage():
        r = httpx.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {cfg.voyage_api_key}"},
            json={"input": "ping", "model": "voyage-3-large", "input_type": "document"},
            timeout=30.0,
        )
        r.raise_for_status()
        dim = len(r.json()["data"][0]["embedding"])
        if dim != 1024:
            raise RuntimeError(f"expected 1024 dims, got {dim}")

    def serper():
        r = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": cfg.serper_api_key},
            json={"q": "corporate training"},
            timeout=30.0,
        )
        r.raise_for_status()
        if not r.json().get("organic"):
            raise RuntimeError("no organic results")

    ok &= check("Supabase reachable",  supabase)
    ok &= check("OpenRouter completion", openrouter)
    ok &= check("Voyage AI embedding (1024-dim)", voyage)
    ok &= check("Serper search", serper)

    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
```

Add `uv add httpx`.

---

## Run order on the day

1. **Start the env validators failing.** With both `.env.local` and `.env` empty, both apps should refuse to boot — verify the error message names the missing var.
2. **Fill the env files** one service at a time as you finish the steps above.
3. **Run smoke tests after each variable lands.** Don't wait until everything is in — incremental verification catches typos at the moment of the typo.
4. **Final pass:** `pnpm --dir app smoke && uv --directory engine run smoke`. Both should print only ✓ lines and exit 0.

---

## Gotchas worth knowing about up front

- **OpenRouter routes models to specific providers in specific regions.** A model that works for the Haiku ping may be unavailable for the Sonnet call if the regional provider is down. Pin the exact model slug (with date suffix) for production runs in `prompt_versions.model_slug`.
- **Voyage rate-limits embeddings to ~300 RPM on the free tier.** The 1,623-course Phase 4 backfill needs batching (128/request) and ~30s of total throughput. Plan accordingly.
- **Google Apps Script `/exec` URLs change every re-deploy.** Bind a version (the dropdown in the deploy dialog) and re-use that deployment ID rather than re-deploying — otherwise the env var goes stale.
- **`SUPABASE_SERVICE_ROLE_KEY` in `app/`** is for Server Actions only. If you find yourself importing it from a Client Component, stop — that key would ship to every browser. Use the anon key on the client, the service-role key only in `lib/supabase/server.ts`.
- **Sentry can swallow Zod / Pydantic validation errors silently** if it's initialised before the env validator runs. Initialise Sentry *after* `env` is imported in `app/`, and *after* `settings()` returns in `engine/`.

---

## What's deliberately not in Phase 2

- Schema creation (Phase 3).
- Auth flow (Phase 3).
- Any agent business logic (Phase 6).
- Any reviewer dashboard changes (those exist already from Phase 1).
- Production deploy of either app — Phase 2 is local-machine smoke-test only.

---

## Done means

- [ ] Both smoke scripts green.
- [ ] Both apps refuse to start when an env var is missing.
- [ ] GAS webhook 401s without the secret.
- [ ] OpenRouter monthly cap set, both dev and prod keys created.
- [ ] `.env.example` updated if any var name changed during setup.
- [ ] Phase 2 commit on `main`, branch protection still happy.

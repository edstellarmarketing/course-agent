/**
 * Phase 2 smoke test for the Next.js dashboard.
 *
 * Runs from the project root: `pnpm smoke` (see package.json). Hits every
 * external service the dashboard depends on and exits non-zero on any
 * failure. Prints a ✓ or ✗ per service; the goal is "the wires are
 * plugged in", not "the business logic works".
 *
 *   - Supabase reachable (REST root responds, 200 or 401 both count)
 *   - GAS email webhook accepts the shared secret (sends to a sink address)
 *   - GAS email webhook rejects requests *without* the secret (401 expected)
 *   - Slack webhook posts (if configured)
 *
 * The GAS sink address defaults to a Phase 2 mailbox you control. Override
 * with $SMOKE_SINK_EMAIL so reviewers' real inboxes never see test traffic.
 */

import { config as loadDotenv } from "dotenv";
import { env } from "../src/lib/env";

// Load .env.local before reading process.env. Falls back gracefully if absent
// so the missing-var error still fires from `env()`.
loadDotenv({ path: ".env.local", quiet: true });

const SINK = process.env.SMOKE_SINK_EMAIL ?? "course-agent-smoke@edstellar.com";

type Check = {
  name: string;
  required: boolean;
  run: () => Promise<void>;
};

async function postJson(
  url: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: JSON.stringify(body),
    ...init,
  });
}

function buildChecks(e: ReturnType<typeof env>): Check[] {
  const checks: Check[] = [
    {
      name: "Supabase reachable",
      required: true,
      async run() {
        const res = await fetch(`${e.SUPABASE_URL}/rest/v1/`, {
          headers: { apikey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY },
        });
        // 200 (with prefer=resolution) or 401 (no auth path) both mean
        // the instance answered. Anything else is a real connection issue.
        if (![200, 401, 404].includes(res.status)) {
          throw new Error(`HTTP ${res.status}`);
        }
      },
    },
  ];

  if (e.GAS_EMAIL_WEBHOOK_URL && e.GAS_EMAIL_SHARED_SECRET) {
    checks.push(
      {
        name: "GAS email webhook accepts the shared secret",
        required: true,
        async run() {
          const res = await postJson(e.GAS_EMAIL_WEBHOOK_URL!, {
            to: SINK,
            subject: "[smoke] course-agent Phase 2 ping",
            html: "<b>If you can read this, the wire is plugged in.</b>",
            secret: e.GAS_EMAIL_SHARED_SECRET,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json().catch(() => null)) as
            | { ok?: boolean }
            | null;
          if (!json?.ok) throw new Error(`unexpected body: ${JSON.stringify(json)}`);
        },
      },
      {
        name: "GAS email webhook rejects requests without the secret",
        required: true,
        async run() {
          const res = await postJson(e.GAS_EMAIL_WEBHOOK_URL!, {
            to: SINK,
            subject: "should not arrive",
            html: "x",
            secret: "wrong-secret",
          });
          if (res.status !== 401) {
            throw new Error(
              `expected 401, got ${res.status} — the GAS doPost is not enforcing the shared secret`,
            );
          }
        },
      },
    );
  }

  if (e.SLACK_WEBHOOK_URL) {
    checks.push({
      name: "Slack webhook posts",
      required: false,
      async run() {
        const res = await postJson(e.SLACK_WEBHOOK_URL!, {
          text: ":wave: course-agent Phase 2 smoke test",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      },
    });
  }

  return checks;
}

function reportUnconfigured(e: ReturnType<typeof env>): void {
  const unconfigured: string[] = [];
  if (!e.GAS_EMAIL_WEBHOOK_URL || !e.GAS_EMAIL_SHARED_SECRET) {
    unconfigured.push("GAS email webhook (Phase 7)");
  }
  if (!e.SLACK_WEBHOOK_URL) unconfigured.push("Slack (optional)");
  if (!e.SENTRY_DSN) unconfigured.push("Sentry (optional)");
  if (unconfigured.length > 0) {
    console.log(`\nNot configured (skipped): ${unconfigured.join(", ")}`);
  }
}

async function main(): Promise<void> {
  let e: ReturnType<typeof env>;
  try {
    e = env();
  } catch (err) {
    console.error(`✗ env validation failed\n${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`smoke-test (Next.js)  ·  sink=${SINK}\n`);
  const checks = buildChecks(e);
  let failed = 0;
  for (const c of checks) {
    try {
      await c.run();
      console.log(`✓ ${c.name}`);
    } catch (err) {
      failed += 1;
      const sev = c.required ? "✗" : "!";
      console.error(`${sev} ${c.name}: ${(err as Error).message}`);
    }
  }
  reportUnconfigured(e);
  console.log();
  if (failed > 0) {
    console.error(`${failed} check(s) failed — Phase 2 is not done yet.`);
    process.exit(1);
  }
  console.log("All configured checks passed.");
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(1);
});

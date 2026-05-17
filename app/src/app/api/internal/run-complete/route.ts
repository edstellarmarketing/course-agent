/**
 * POST /api/internal/run-complete — engine → app webhook.
 *
 * Auth: `x-internal-webhook-secret` header must match the
 * INTERNAL_WEBHOOK_SECRET env var (constant-time compare). No
 * session cookie required — this is a server-to-server call.
 *
 * Body: { "run_id": "<agent_runs.id>" }
 *
 * Behaviour: loads the run, renders today's digest email, POSTs
 * to the GAS relay. Returns the result envelope from
 * sendDigestForRun(). All failures return 200 with `{ok:false}`
 * EXCEPT auth/validation failures which return 401/400 so the
 * engine can distinguish "I'm misconfigured" from "the send failed
 * downstream".
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { sendDigestForRun } from "@/lib/email/send-digest";

// Auth check is cheap, the actual digest send takes a couple
// seconds because of the GAS round-trip. Don't let Vercel's
// route-handler cache anything from this endpoint.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // ── Auth (constant-time secret check) ───────────────────────
  const e = env();
  const expected = e.INTERNAL_WEBHOOK_SECRET ?? "";
  const provided = (await headers()).get("x-internal-webhook-secret") ?? "";
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_WEBHOOK_SECRET not configured on server" },
      { status: 500 },
    );
  }
  if (!constantTimeEquals(provided, expected)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // ── Body parsing ────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  const runId =
    typeof body === "object" &&
    body !== null &&
    "run_id" in body &&
    typeof (body as Record<string, unknown>).run_id === "string"
      ? ((body as Record<string, string>).run_id as string)
      : null;
  if (!runId) {
    return NextResponse.json(
      { ok: false, error: "missing_field", field: "run_id" },
      { status: 400 },
    );
  }

  // ── Send ────────────────────────────────────────────────────
  // Always 200 — `{ok:false}` here means the engine's call was
  // valid but the downstream send failed (relay down, recipient
  // bounced, etc.). Engine should log and continue.
  const result = await sendDigestForRun(runId);
  return NextResponse.json(result);
}

/**
 * Constant-time string comparison. The route handler runs on the
 * server, but defending against side-channel timing attacks even
 * for internal endpoints is cheap insurance.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

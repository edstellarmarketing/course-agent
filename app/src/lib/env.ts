import { z } from "zod";

/**
 * Environment-variable validator for the Next.js dashboard.
 *
 * - Validation runs **lazily** the first time `env()` is called. Pages that
 *   don't actually touch external services (the Phase 1 mock-data screens)
 *   can boot without a `.env.local`; anything that calls `env()` — Server
 *   Actions, the smoke test — fails loud if a required var is missing or
 *   malformed.
 * - The client schema only covers `NEXT_PUBLIC_*` vars (which Next.js
 *   inlines into the browser bundle). Everything else is server-only.
 *
 * Phase 4 adds the Supabase callers that will exercise this validator on
 * every real request.
 */

const serverSchema = z.object({
  SUPABASE_URL: z.string().url("must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(40, "service-role keys are at least 40 chars"),

  // GAS email relay — required by the Phase 7 digest job. Optional here so
  // Phase 2 can pass before the doPost-with-shared-secret hardening lands.
  GAS_EMAIL_WEBHOOK_URL: z
    .string()
    .url("must be a valid URL")
    .optional()
    .or(z.literal("")),
  GAS_EMAIL_SHARED_SECRET: z
    .string()
    .min(16, "use at least 16 chars — `openssl rand -hex 16` is fine")
    .optional()
    .or(z.literal("")),

  SLACK_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  SENTRY_DSN: z.string().url().optional().or(z.literal("")),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(40, "anon keys are at least 40 chars"),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;
export type Env = ServerEnv & ClientEnv;

let cached: Env | undefined;

/**
 * Returns the validated env. Throws a single, clear error listing every
 * missing or malformed variable — never a cryptic null-pointer deep
 * inside a Supabase / Slack / Sentry SDK.
 */
export function env(): Env {
  if (cached) return cached;

  const serverResult = serverSchema.safeParse(process.env);
  const clientResult = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!serverResult.success || !clientResult.success) {
    const issues = [
      ...(!serverResult.success
        ? serverResult.error.issues.map((i) => formatIssue(i, "server"))
        : []),
      ...(!clientResult.success
        ? clientResult.error.issues.map((i) => formatIssue(i, "client"))
        : []),
    ];
    throw new Error(
      `Invalid environment variables — fix .env.local and try again:\n  - ${issues.join("\n  - ")}`,
    );
  }

  cached = { ...serverResult.data, ...clientResult.data };
  return cached;
}

function formatIssue(
  issue: z.core.$ZodIssue,
  side: "server" | "client",
): string {
  const key = issue.path.join(".");
  return `${key} (${side}): ${issue.message}`;
}

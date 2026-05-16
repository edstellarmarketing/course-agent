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
  // Optional so server-only tooling (the smoke test) doesn't require
  // it. Browser bundles, however, MUST set this var in .env.local — the
  // browser Supabase client throws "Invalid URL" if it's missing at
  // runtime. On server-side, `env()` falls back to `SUPABASE_URL`.
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("must be a valid URL")
    .optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(40, "anon keys are at least 40 chars"),
});

export type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnvParsed = z.infer<typeof clientSchema>;

/**
 * Consumer-facing client env. `NEXT_PUBLIC_SUPABASE_URL` is presented
 * as `string` (not `string | undefined`) because `env()` fills it in
 * from `SUPABASE_URL` on the server. Browser callers that hit this
 * type when the user hasn't set the var will see a runtime "Invalid
 * URL" from createBrowserClient — clear enough.
 */
export type ClientEnv = Omit<ClientEnvParsed, "NEXT_PUBLIC_SUPABASE_URL"> & {
  NEXT_PUBLIC_SUPABASE_URL: string;
};
export type Env = ServerEnv & ClientEnv;

let cached: Env | undefined;

/**
 * Returns the validated env. Throws a single, clear error listing every
 * missing or malformed variable — never a cryptic null-pointer deep
 * inside a Supabase / Slack / Sentry SDK.
 *
 * Server vars are only validated server-side; in a browser bundle they
 * aren't present (and shouldn't be), so we skip them. The TypeScript
 * type still includes server fields, but accessing one from a Client
 * Component returns `undefined` — write a runtime guard if that matters.
 */
export function env(): Env {
  if (cached) return cached;

  const isServer = typeof window === "undefined";

  const serverResult = isServer
    ? serverSchema.safeParse(process.env)
    : ({ success: true as const, data: {} as ServerEnv });
  const clientResult = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
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

  const merged = { ...serverResult.data, ...clientResult.data };
  // Server-side fallback: SUPABASE_URL doubles as NEXT_PUBLIC_SUPABASE_URL
  // when the user hasn't set the public alias. Browser bundles can't use
  // this fallback (server vars aren't shipped), so they still need the
  // explicit NEXT_PUBLIC_SUPABASE_URL.
  if (!merged.NEXT_PUBLIC_SUPABASE_URL && merged.SUPABASE_URL) {
    merged.NEXT_PUBLIC_SUPABASE_URL = merged.SUPABASE_URL;
  }
  cached = merged as Env;
  return cached;
}

function formatIssue(
  issue: z.core.$ZodIssue,
  side: "server" | "client",
): string {
  const key = issue.path.join(".");
  return `${key} (${side}): ${issue.message}`;
}

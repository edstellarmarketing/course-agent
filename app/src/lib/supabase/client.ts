import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

/**
 * Browser-side Supabase client. Uses the anon key and respects RLS.
 * Bound to the `course-agent` Postgres schema so all queries go to our
 * schema by default; cross-schema reads (e.g. `auth.users`) need the
 * explicit `.schema()` override.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` (not `SUPABASE_URL`) because the
 * server-only var is stripped out of the browser bundle by Next.js.
 */
export function createClient() {
  const e = env();
  return createBrowserClient(
    e.NEXT_PUBLIC_SUPABASE_URL,
    e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: "course-agent" },
    },
  );
}

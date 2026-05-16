import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * Allowed callers:
 *   - Server Actions that legitimately aggregate across all users
 *     (audit log roll-ups, daily-digest counts).
 *   - The engine's webhook receiver, when it lands.
 *
 * Forbidden callers:
 *   - Any Client Component (the service-role key would ship to the
 *     browser → instant database breach).
 *   - Any route handler whose body is returned verbatim to the
 *     browser (same risk).
 *
 * If you need reviewer-scoped reads, use `createSessionClient()` from
 * `./server-with-session.ts` — it respects RLS.
 */
export function createAdminClient() {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "course-agent" },
  });
}

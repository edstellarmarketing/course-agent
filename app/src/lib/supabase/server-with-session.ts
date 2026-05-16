import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Server-side Supabase client bound to the current request's auth
 * cookies. Uses the anon key, so RLS applies — every query the caller
 * makes is evaluated as the signed-in reviewer.
 *
 * Use this from Server Components and Server Actions that render or
 * mutate reviewer-scoped data. For cross-tenant aggregation (audit
 * logs, daily-digest counts) use `createAdminClient()` from
 * `./server.ts` instead — it bypasses RLS.
 *
 * Cookies are async in Next.js 16 (`await cookies()`). The `setAll`
 * trap throws when called from a Server Component, which is why it's
 * wrapped in try/catch — the middleware will refresh the session
 * cookie on the next request.
 */
export async function createSessionClient() {
  const cookieStore = await cookies();
  const e = env();
  return createServerClient(
    e.SUPABASE_URL,
    e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: "course-agent" },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Set from a Server Component — middleware refreshes it.
          }
        },
      },
    },
  );
}

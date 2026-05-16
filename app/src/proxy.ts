import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Session gate + admin-route guard. Next.js 16 renamed the
 * `middleware` file convention to `proxy` — same Edge-runtime
 * function, same matcher config, new name.
 *
 *   - `PUBLIC_PATHS` boot without a session (login + OAuth callback).
 *   - Every other route requires a signed-in user; otherwise we
 *     bounce to `/login`.
 *   - `ADMIN_PATHS` additionally require `app_metadata.role === "admin"`
 *     in the user's JWT; non-admins land on `/403`.
 *
 * The `app_metadata.role` field is server-set (service-role only) and
 * therefore trustworthy — never read role from `user_metadata`, which
 * a user can edit via the standard Auth API.
 *
 * Cookie handling: `supabase.auth.getUser()` may rotate the session
 * cookie; the `setAll` adapter rebuilds the response each time so
 * the refreshed cookie rides back to the browser when we return.
 */

const PUBLIC_PATHS = ["/login", "/auth/callback"];
const ADMIN_PATHS = ["/learning", "/settings"];

export async function proxy(req: NextRequest) {
  const e = env();
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    e.SUPABASE_URL,
    e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: "course-agent" },
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            req.cookies.set(name, value);
          }
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (user && ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    // App-scoped role so we don't collide with sibling apps that share
    // this Supabase (Marketing-PM-Tool, eggdrop, trainerportal). Each
    // app namespaces its own admin flag in app_metadata.
    const appMeta = user.app_metadata as
      | { course_agent_role?: string }
      | undefined;
    if (appMeta?.course_agent_role !== "admin") {
      return NextResponse.redirect(new URL("/403", req.url));
    }
  }

  return res;
}

export const config = {
  // Skip static assets and Next internals. Everything else (including
  // page routes and API routes) flows through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

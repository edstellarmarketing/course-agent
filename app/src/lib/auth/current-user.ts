import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { ReviewerProfile } from "@/lib/types";

/**
 * Server-side helper: returns the signed-in reviewer for the current
 * request, or `null` if there isn't one.
 *
 * Middleware already redirects anonymous traffic to `/login`, so any
 * page inside the `(app)` group can safely assume this returns a
 * profile. The `null` return is for layout-level code paths that
 * straddle public and protected routes (e.g. the root `/`).
 *
 * Role is read from `auth.users.app_metadata.course_agent_role`,
 * which only the service-role can write. The key is app-scoped
 * because this Supabase is shared across multiple apps that have
 * their own admin flags — `course_agent_role` keeps ours from
 * colliding. `user_metadata` is user-editable and must never be
 * trusted for authorization.
 */
export async function getCurrentReviewer(): Promise<ReviewerProfile | null> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    name?: string;
  };
  const appMeta = (user.app_metadata ?? {}) as { course_agent_role?: string };
  const role = appMeta.course_agent_role === "admin" ? "admin" : "reviewer";
  const name = meta.full_name ?? meta.name ?? user.email ?? "Reviewer";

  return {
    id: user.id,
    name,
    email: user.email ?? "",
    role,
  };
}

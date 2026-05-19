"use server";

import { revalidatePath } from "next/cache";

import { getCurrentReviewer } from "@/lib/auth/current-user";
import { logAdminAction } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/server";

/** Same loose RFC check used elsewhere — good enough for admin entry. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserRole = "admin" | "reviewer";

export type UserActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Send a magic-link invite to a new user and stamp their
 * `app_metadata.course_agent_role` so the proxy/admin gates
 * recognise them on first sign-in.
 *
 * If the email already maps to an existing auth.users row, Supabase
 * returns a "user already registered" error — we surface that as a
 * friendly message so the admin can update the existing row's role
 * via `updateUserRole` instead.
 */
export async function inviteUser(input: {
  email: string;
  role: UserRole;
}): Promise<UserActionResult> {
  const me = await getCurrentReviewer();
  if (!me) return { ok: false, error: "Not signed in." };
  if (me.role !== "admin") {
    return { ok: false, error: "Admin role required." };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (input.role !== "admin" && input.role !== "reviewer") {
    return { ok: false, error: "Role must be 'admin' or 'reviewer'." };
  }

  const admin = createAdminClient();

  // Invite via magic link; redirectTo lands at the same callback the
  // /login flow uses, so first sign-in flows the same way.
  const redirectTo = `${deriveAppUrl()}/auth/callback`;
  const { data: invited, error: inviteErr } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      // `data` lands in user_metadata — useful for the welcome name,
      // but it's NOT the role (role lives in app_metadata, set below).
      data: { invited_by: me.email },
    });

  if (inviteErr) {
    const msg = inviteErr.message ?? "Invite failed.";
    // Friendlier wording for the common "already exists" case.
    if (
      /already registered/i.test(msg) ||
      /already exists/i.test(msg) ||
      inviteErr.status === 422
    ) {
      return {
        ok: false,
        error:
          "That email is already a user. Use the role dropdown on the existing row to change their role.",
      };
    }
    return { ok: false, error: msg };
  }
  if (!invited.user) {
    return { ok: false, error: "Supabase returned no user record." };
  }

  // Set the role separately — inviteUserByEmail can't set app_metadata
  // directly. If this fails the invite still went out; surface the
  // problem so the admin can retry the role-set without re-inviting.
  const { error: roleErr } = await admin.auth.admin.updateUserById(
    invited.user.id,
    { app_metadata: { course_agent_role: input.role } },
  );
  if (roleErr) {
    return {
      ok: false,
      error: `Invite sent, but couldn't stamp the role: ${roleErr.message}. Retry from the user row.`,
    };
  }

  await logAdminAction({
    action: "user.invite",
    targetType: "auth.users",
    targetId: invited.user.id,
    payload: { email, role: input.role },
  });

  revalidatePath("/users");
  return { ok: true };
}

/**
 * Promote/demote a user's role. Server-side admin check + audit log.
 * The change is a JWT app_metadata edit, so it takes effect on the
 * affected user's next request (Supabase re-issues a token).
 */
export async function updateUserRole(input: {
  userId: string;
  role: UserRole;
}): Promise<UserActionResult> {
  const me = await getCurrentReviewer();
  if (!me) return { ok: false, error: "Not signed in." };
  if (me.role !== "admin") {
    return { ok: false, error: "Admin role required." };
  }
  if (input.userId === me.id && input.role !== "admin") {
    // Guard against an admin accidentally locking themselves out.
    return {
      ok: false,
      error: "You can't demote your own account — ask another admin to do it.",
    };
  }
  if (input.role !== "admin" && input.role !== "reviewer") {
    return { ok: false, error: "Role must be 'admin' or 'reviewer'." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    app_metadata: { course_agent_role: input.role },
  });
  if (error) return { ok: false, error: error.message };

  await logAdminAction({
    action: "user.role_change",
    targetType: "auth.users",
    targetId: input.userId,
    payload: { role: input.role },
  });

  revalidatePath("/users");
  return { ok: true };
}

/**
 * Hard-delete a user from auth.users.
 *
 * Used when a reviewer leaves the team — preferable to leaving a
 * stale account that still has a valid Supabase session. Audit-logged.
 */
export async function removeUser(userId: string): Promise<UserActionResult> {
  const me = await getCurrentReviewer();
  if (!me) return { ok: false, error: "Not signed in." };
  if (me.role !== "admin") {
    return { ok: false, error: "Admin role required." };
  }
  if (userId === me.id) {
    return {
      ok: false,
      error: "You can't remove your own account from here.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };

  await logAdminAction({
    action: "user.remove",
    targetType: "auth.users",
    targetId: userId,
    payload: {},
  });

  revalidatePath("/users");
  return { ok: true };
}

/** Same fallback the suggestion-email action uses. */
function deriveAppUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit && /^https?:\/\//.test(explicit)) {
    return explicit.replace(/\/$/, "");
  }
  return "https://course-agent-nine.vercel.app";
}

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { UsersManager, type ManagedUser } from "@/components/users-manager";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Users · Course Agent",
};

// Role changes mutate JWT app_metadata — never serve a cached render.
export const dynamic = "force-dynamic";

interface UserMetaShape {
  full_name?: string;
  name?: string;
}

interface AppMetaShape {
  course_agent_role?: string;
}

export default async function UsersPage() {
  const profile = await getCurrentReviewer();
  // Middleware already enforces /users in ADMIN_PATHS, but the server
  // component checks too in case the proxy changes — defense in depth.
  if (!profile || profile.role !== "admin") redirect("/403");

  const admin = createAdminClient();
  // Default page size (50) is well above the team's headcount; if it
  // ever exceeds that, we'll switch to paginated rendering.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) {
    console.error("[users] listUsers failed:", error);
  }

  const users: ManagedUser[] = (data?.users ?? [])
    .map((u) => {
      const meta = (u.user_metadata ?? {}) as UserMetaShape;
      const appMeta = (u.app_metadata ?? {}) as AppMetaShape;
      const role =
        appMeta.course_agent_role === "admin" ? "admin" : "reviewer";
      const name = meta.full_name ?? meta.name ?? null;
      return {
        id: u.id,
        email: u.email ?? "",
        name,
        role: role as ManagedUser["role"],
        createdAt: u.created_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      };
    })
    // Sort: admins first, then by email
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
      return a.email.localeCompare(b.email);
    });

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description="Who can sign in to the Course Agent dashboard. Invite by email; the recipient gets a one-click magic link and lands in the dashboard with the role you pick here."
      />

      <div className="flex-1 px-8 py-8">
        <UsersManager users={users} currentUserId={profile.id} />

        <section className="mt-6 rounded-lg border border-gray-100 bg-white">
          <header className="border-b border-gray-100 px-6 py-4">
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
              How access works
            </div>
            <h2 className="font-display text-lg font-semibold text-navy-deep">
              Reviewer vs admin
            </h2>
          </header>
          <div className="space-y-2 px-6 py-5 text-sm text-gray-700">
            <p>
              <strong>Reviewer</strong> — approves, rejects, or needs-revisions
              suggestions; sees the full queue. Cannot bulk-upload courses,
              manage categories, edit email recipients, change roles, or
              promote prompt versions.
            </p>
            <p>
              <strong>Admin</strong> — everything a reviewer can do, plus the
              admin-gated pages: Learning, Settings, Email Settings, Course
              Inventory upload, and this Users page. Role is stored at{" "}
              <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">
                auth.users.app_metadata.course_agent_role
              </code>{" "}
              — server-set only, never trusted from user_metadata.
            </p>
            <p className="text-xs text-gray-500">
              Removing a user here deletes the auth.users row entirely; their
              session ends immediately and they&apos;d need a fresh invite to
              come back.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

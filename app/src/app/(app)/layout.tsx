import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { getCurrentReviewer } from "@/lib/auth/current-user";

export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware already gates this layout — a missing session means
  // the request was redirected to /login before reaching here. The
  // `redirect()` fallback is belt-and-braces for the edge case where
  // a Supabase session cookie exists but the user record was deleted.
  const profile = await getCurrentReviewer();
  if (!profile) redirect("/login");

  return (
    <div className="flex min-h-screen flex-1 bg-off-white">
      <AppNav profile={profile} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

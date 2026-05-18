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
    // h-screen + overflow-hidden on the wrapper turns the window
    // into a fixed-height viewport. The aside (h-screen w-64)
    // stays put because the wrapper never scrolls; only <main>
    // scrolls (its own overflow-y-auto). Without this, both the
    // sidebar and main share the document-level scroll, and the
    // sidebar drifts upward as the user scrolls a long page.
    <div className="flex h-screen flex-1 overflow-hidden bg-off-white">
      <AppNav profile={profile} />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

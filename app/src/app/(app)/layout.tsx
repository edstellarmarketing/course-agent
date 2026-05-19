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
    // The AppNav is `position: fixed` (inset-y-0 left-0 w-64), so the
    // sidebar is glued to the viewport regardless of how far <main>
    // scrolls. We use the document's natural scroll for main — a
    // single scrollbar, no nested overflow surprises. `ml-64` offsets
    // <main> past the sidebar's width.
    <div className="min-h-screen bg-off-white">
      <AppNav profile={profile} />
      <main className="ml-64 flex min-h-screen min-w-0 flex-col">
        {children}
      </main>
    </div>
  );
}

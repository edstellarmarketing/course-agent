import Link from "next/link";

export const metadata = {
  title: "Forbidden · Course Agent",
};

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-off-white px-6 py-12">
      <div className="w-full max-w-md rounded-lg border border-gray-100 bg-white p-8 text-center">
        <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
          403 · Admin only
        </div>
        <h1 className="mt-3 font-display text-2xl font-semibold text-navy-deep">
          You don&apos;t have access to this page
        </h1>
        <p className="mt-3 text-sm text-gray-500">
          This area is restricted to admin reviewers. If you think this is a
          mistake, ask an admin to update your role in Settings.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-md bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}

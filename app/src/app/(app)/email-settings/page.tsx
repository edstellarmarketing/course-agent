import { PageHeader } from "@/components/page-header";
import { EmailRecipientsManager } from "@/components/email-recipients-manager";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { createSessionClient } from "@/lib/supabase/server-with-session";

export const metadata = {
  title: "Email Settings · Course Agent",
};

// Every admin action mutates digest_recipients; never serve stale.
export const dynamic = "force-dynamic";

interface DigestRecipientRow {
  id: string;
  email: string;
  is_active: boolean;
  assigned_categories: string[] | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface CategoryRow {
  name: string;
}

export default async function EmailSettingsPage() {
  const [profile, supabase] = await Promise.all([
    getCurrentReviewer(),
    createSessionClient(),
  ]);
  const isAdmin = profile?.role === "admin";

  const [recipientsRes, categoriesRes] = await Promise.all([
    supabase
      .from("digest_recipients")
      .select(
        "id,email,is_active,assigned_categories,notes,created_at,updated_at",
      )
      .order("email", { ascending: true }),
    supabase.from("categories").select("name").order("name"),
  ]);

  const recipients = (recipientsRes.data ?? []) as DigestRecipientRow[];
  const categories = ((categoriesRes.data ?? []) as CategoryRow[]).map(
    (c) => c.name,
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Email Settings"
        description="Recipients of the daily course-suggestion digest. The digest is sent automatically after each agent run, formatted with the latest suggestions."
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        {!isAdmin && (
          <div className="rounded-md border border-amber-200 bg-amber-soft px-4 py-3 text-sm text-amber-900">
            <span className="font-display text-[11px] font-semibold uppercase tracking-widest">
              Admin only ·
            </span>{" "}
            You can view but not edit. Promote / Delete actions are gated on{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[10px]">
              app_metadata.course_agent_role === &quot;admin&quot;
            </code>
            .
          </div>
        )}

        <EmailRecipientsManager
          recipients={recipients.map((r) => ({
            id: r.id,
            email: r.email,
            isActive: r.is_active,
            assignedCategories: r.assigned_categories,
            notes: r.notes,
            updatedAt: r.updated_at,
          }))}
          categoryNames={categories}
          canEdit={isAdmin}
        />

        <section className="rounded-lg border border-gray-100 bg-white">
          <header className="border-b border-gray-100 px-6 py-4">
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
              About the digest
            </div>
            <h2 className="font-display text-lg font-semibold text-navy-deep">
              What recipients receive
            </h2>
          </header>
          <div className="px-6 py-5 text-sm text-gray-700">
            <p>
              When an agent run completes, the engine pings the app&apos;s
              internal webhook. The app builds an HTML digest from the most
              recent run&apos;s suggestions and forwards it through the
              Google Apps Script email relay to every recipient on this list
              whose <strong>Active</strong> toggle is on.
            </p>
            <p className="mt-3">
              The HTML template (see{" "}
              <code className="rounded bg-gray-100 px-1 font-mono text-[12px]">
                app/src/lib/email/digest-template.ts
              </code>
              ) renders the run summary, the latest 6 pending suggestions
              with title / category / price / duration cards, and links back
              to <code className="font-mono text-[12px]">/suggestions/today</code> for
              the full queue. Recipients with an{" "}
              <strong>Assigned categories</strong> filter set only get
              emails for runs that targeted at least one of those
              categories; recipients with no filter set get every digest.
            </p>
            <p className="mt-3 text-xs text-gray-500">
              To override the recipient list temporarily (e.g. during a
              staging test), set{" "}
              <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">
                DIGEST_RECIPIENTS_OVERRIDE=alex@you.com,sam@you.com
              </code>{" "}
              in the environment — it short-circuits this table.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

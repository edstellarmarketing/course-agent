import Link from "next/link";
import { notFound } from "next/navigation";

import { DecisionPanel } from "@/components/decision-panel";
import { PageHeader } from "@/components/page-header";
import { SuggestionCard } from "@/components/suggestion-card";
import { mockFeedback } from "@/lib/mock/feedback";
import { mockRejectionTaxonomy } from "@/lib/mock/rejection-taxonomy";
import { mockAllSuggestions } from "@/lib/mock/suggestions";

interface SuggestionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function SuggestionDetailPage({
  params,
}: SuggestionDetailPageProps) {
  const { id } = await params;
  const suggestion = mockAllSuggestions.find((s) => s.id === id);
  if (!suggestion) notFound();

  const trail = mockFeedback
    .filter((f) => f.suggestionId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const isPending = suggestion.status === "pending_review";

  return (
    <>
      <PageHeader
        eyebrow="Suggestion detail"
        title={suggestion.title}
        description={`${suggestion.category} · candidate ${suggestion.id}`}
        actions={
          <Link
            href="/suggestions/today"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Back to queue
          </Link>
        }
      />

      <div className="flex-1 space-y-6 px-8 py-8">
        <SuggestionCard suggestion={suggestion} />

        {isPending ? (
          <DecisionPanel suggestion={suggestion} tags={mockRejectionTaxonomy} />
        ) : (
          <div className="rounded-md border border-gray-100 bg-white p-5 text-sm text-gray-600">
            Status: <StatusPill status={suggestion.status} />
            <span className="ml-2">This candidate has already been actioned.</span>
          </div>
        )}

        <section className="rounded-lg border border-gray-100 bg-white">
          <header className="border-b border-gray-100 px-6 py-4">
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
              Audit trail
            </div>
            <h2 className="font-display text-lg font-semibold text-navy-deep">
              {trail.length === 0
                ? "No feedback yet"
                : `${trail.length} entr${trail.length === 1 ? "y" : "ies"}`}
            </h2>
          </header>
          {trail.length === 0 ? (
            <p className="px-6 py-6 text-sm text-gray-500">
              This candidate hasn&apos;t been actioned. The first feedback row
              will appear here as soon as a reviewer decides.
            </p>
          ) : (
            <ol className="divide-y divide-gray-100">
              {trail.map((f) => (
                <li key={f.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={f.decision} />
                      <span className="text-sm font-medium text-gray-800">
                        {f.reviewerName}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-gray-500">
                      {new Date(f.createdAt).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  {f.reasonTags.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {f.reasonTags.map((tag) => {
                        const label =
                          mockRejectionTaxonomy.find((t) => t.key === tag)?.label ??
                          tag;
                        return (
                          <li
                            key={tag}
                            className="rounded-full bg-red-soft px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-red-700"
                          >
                            {label}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {f.reasonText && (
                    <p className="mt-2 text-sm text-gray-600">{f.reasonText}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

function StatusPill({
  status,
}: {
  status: "pending_review" | "approved" | "rejected" | "needs_revision";
}) {
  const map = {
    pending_review: "bg-gray-100 text-gray-700",
    approved: "bg-green-soft text-green-700",
    rejected: "bg-red-soft text-red-700",
    needs_revision: "bg-amber-soft text-amber-700",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

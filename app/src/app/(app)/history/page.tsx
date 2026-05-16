import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { mockFeedback } from "@/lib/mock/feedback";
import { mockRejectionTaxonomy } from "@/lib/mock/rejection-taxonomy";
import { mockReviewers } from "@/lib/mock/reviewers";
import { mockAllSuggestions } from "@/lib/mock/suggestions";
import type { FeedbackDecision } from "@/lib/types";

export const metadata = {
  title: "History · Course Agent",
};

interface HistoryPageProps {
  searchParams: Promise<{
    q?: string;
    decision?: FeedbackDecision | "all";
    reviewer?: string;
  }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const {
    q = "",
    decision = "all",
    reviewer = "all",
  } = await searchParams;
  const needle = q.trim().toLowerCase();

  const rows = mockFeedback
    .map((f) => ({
      ...f,
      suggestion: mockAllSuggestions.find((s) => s.id === f.suggestionId),
    }))
    .filter((row) => {
      if (decision !== "all" && row.decision !== decision) return false;
      if (reviewer !== "all" && row.reviewerId !== reviewer) return false;
      if (!needle) return true;
      const haystack = `${row.suggestion?.title ?? ""} ${row.suggestion?.category ?? ""} ${row.reasonText ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title="History"
        description="Every reviewer decision the system has recorded. Phase 5 will source these from the feedback table directly."
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-4">
          <div className="flex-1 min-w-[240px]">
            <label
              htmlFor="q"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Search
            </label>
            <input
              id="q"
              name="q"
              type="text"
              defaultValue={q}
              placeholder="Title, category, or reason text"
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
          </div>

          <div className="min-w-[180px]">
            <label
              htmlFor="decision"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Decision
            </label>
            <select
              id="decision"
              name="decision"
              defaultValue={decision}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            >
              <option value="all">All decisions</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="needs_revision">Needs revision</option>
            </select>
          </div>

          <div className="min-w-[200px]">
            <label
              htmlFor="reviewer"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Reviewer
            </label>
            <select
              id="reviewer"
              name="reviewer"
              defaultValue={reviewer}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            >
              <option value="all">All reviewers</option>
              {mockReviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
          >
            Filter
          </button>
          {(q || decision !== "all" || reviewer !== "all") && (
            <Link
              href="/history"
              className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="rounded-lg border border-gray-100 bg-white">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 text-sm text-gray-500">
            <span>
              <span className="font-display text-base font-semibold text-navy-deep">
                {rows.length}
              </span>{" "}
              entr{rows.length === 1 ? "y" : "ies"}
            </span>
          </header>
          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-gray-500">
              No history matches these filters.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li key={row.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <DecisionPill decision={row.decision} />
                        <span className="font-mono text-[11px] text-gray-500">
                          {row.reviewerName} ·{" "}
                          {new Date(row.createdAt).toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                      {row.suggestion ? (
                        <Link
                          href={`/suggestions/${row.suggestion.id}`}
                          className="mt-1 block text-sm font-medium text-navy-deep hover:text-navy"
                        >
                          {row.suggestion.title}
                        </Link>
                      ) : (
                        <span className="mt-1 block text-sm text-gray-500">
                          Suggestion {row.suggestionId} (removed)
                        </span>
                      )}
                      {row.suggestion?.category && (
                        <div className="text-[11px] uppercase tracking-widest text-gray-400">
                          {row.suggestion.category}
                        </div>
                      )}
                    </div>
                  </div>

                  {row.reasonTags.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {row.reasonTags.map((tag) => {
                        const label =
                          mockRejectionTaxonomy.find((t) => t.key === tag)?.label ?? tag;
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

                  {row.reasonText && (
                    <p className="mt-2 text-sm text-gray-600">{row.reasonText}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function DecisionPill({ decision }: { decision: FeedbackDecision }) {
  const map = {
    approved: "bg-green-soft text-green-700",
    rejected: "bg-red-soft text-red-700",
    needs_revision: "bg-amber-soft text-amber-700",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[decision]}`}
    >
      {decision.replace("_", " ")}
    </span>
  );
}

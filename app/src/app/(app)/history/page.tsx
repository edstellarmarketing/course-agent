import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { FeedbackDecision } from "@/lib/types";

export const metadata = {
  title: "History · Course Agent",
};

// Reads change every time a reviewer acts; never serve a cached render.
export const dynamic = "force-dynamic";

interface HistoryPageProps {
  searchParams: Promise<{
    q?: string;
    decision?: FeedbackDecision | "all";
    reviewer?: string;
  }>;
}

// PostgREST embedding with a single-FK relationship (feedback.suggestion_id
// references suggestions.id) returns the joined row as a single object
// at runtime, but supabase-js's TS generics conservatively type it as
// an array. We type to match the runtime and cast through `unknown` at
// the query site to bypass the generic.
interface FeedbackRow {
  id: string;
  suggestion_id: string;
  decision: FeedbackDecision;
  reason_tags: string[];
  reason_text: string | null;
  reviewer_id: string;
  created_at: string;
  suggestions: { title: string | null; category: string | null } | null;
}

interface RejectionTaxonomyRow {
  key: string;
  label: string;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const {
    q = "",
    decision = "all",
    reviewer = "all",
  } = await searchParams;
  const needle = q.trim().toLowerCase();

  const supabase = await createSessionClient();

  // Build the base query — PostgREST embedding lets us join the
  // suggestions row in a single round-trip.
  let query = supabase
    .from("feedback")
    .select(
      "id,suggestion_id,decision,reason_tags,reason_text,reviewer_id,created_at,suggestions(title,category)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (decision !== "all") {
    query = query.eq("decision", decision);
  }
  if (reviewer !== "all") {
    query = query.eq("reviewer_id", reviewer);
  }

  // Fan out everything we need for the page in one round-trip:
  // the filtered feedback list, the rejection taxonomy for tag labels,
  // a distinct-reviewer source for the dropdown, and the current
  // user's id so we can label their own rows as "You".
  const [feedbackResult, taxonomyResult, reviewerSourceResult, userResult] =
    await Promise.all([
      query,
      supabase.from("rejection_taxonomy").select("key,label"),
      // The reviewer dropdown shows every reviewer who has at least one
      // feedback row. With ≤200 rows in scope this is fine; if the
      // table grows past a few thousand we'll move this to a view.
      supabase
        .from("feedback")
        .select("reviewer_id")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.auth.getUser(),
    ]);

  if (feedbackResult.error) {
    console.error("[history] feedback query failed:", feedbackResult.error);
  }

  const rawRows = (feedbackResult.data ?? []) as unknown as FeedbackRow[];
  const taxonomy = (taxonomyResult.data ?? []) as RejectionTaxonomyRow[];
  const tagLabelByKey = new Map(taxonomy.map((t) => [t.key, t.label]));
  const currentUserId = userResult.data.user?.id ?? null;

  // Distinct reviewer_ids, preserving most-recent-first order for the
  // dropdown so active reviewers float to the top.
  const reviewerIds: string[] = [];
  const seen = new Set<string>();
  for (const row of (reviewerSourceResult.data ?? []) as { reviewer_id: string }[]) {
    if (seen.has(row.reviewer_id)) continue;
    seen.add(row.reviewer_id);
    reviewerIds.push(row.reviewer_id);
  }

  const rows = needle
    ? rawRows.filter((row) => {
        const haystack = `${row.suggestions?.title ?? ""} ${row.suggestions?.category ?? ""} ${row.reason_text ?? ""}`.toLowerCase();
        return haystack.includes(needle);
      })
    : rawRows;

  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title="History"
        description="Every reviewer decision the system has recorded, drawn live from the feedback table."
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-4"
        >
          <div className="min-w-[240px] flex-1">
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
              {reviewerIds.map((rid) => (
                <option key={rid} value={rid}>
                  {reviewerLabel(rid, currentUserId)}
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
              {rawRows.length === 200 && (
                <span className="ml-2 text-[11px] text-gray-400">
                  (showing latest 200)
                </span>
              )}
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
                          {reviewerLabel(row.reviewer_id, currentUserId)} ·{" "}
                          {new Date(row.created_at).toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                      {row.suggestions?.title ? (
                        <Link
                          href={`/suggestions/${row.suggestion_id}`}
                          className="mt-1 block text-sm font-medium text-navy-deep hover:text-navy"
                        >
                          {row.suggestions?.title}
                        </Link>
                      ) : (
                        <span className="mt-1 block text-sm text-gray-500">
                          Suggestion {row.suggestion_id} (removed)
                        </span>
                      )}
                      {row.suggestions?.category && (
                        <div className="text-[11px] uppercase tracking-widest text-gray-400">
                          {row.suggestions?.category}
                        </div>
                      )}
                    </div>
                  </div>

                  {row.reason_tags.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {row.reason_tags.map((tag) => {
                        const label = tagLabelByKey.get(tag) ?? tag;
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

                  {row.reason_text && (
                    <p className="mt-2 text-sm text-gray-600">{row.reason_text}</p>
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

function reviewerLabel(
  reviewerId: string,
  currentUserId: string | null,
): string {
  if (currentUserId && reviewerId === currentUserId) return "You";
  return `Reviewer ${reviewerId.slice(0, 8)}`;
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

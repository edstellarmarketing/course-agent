import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { FeedbackDecision } from "@/lib/types";

export const metadata = {
  title: "History · Course Agent",
};

// Reads change every time a reviewer acts; never serve a cached render.
export const dynamic = "force-dynamic";

type SuggestionStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "needs_revision";

type HistoryView = "suggestions" | "decisions";

interface HistoryPageProps {
  searchParams: Promise<{
    view?: HistoryView;
    // Decisions tab
    q?: string;
    decision?: FeedbackDecision | "all";
    reviewer?: string;
    // Suggestions tab
    from?: string;       // ISO date YYYY-MM-DD
    to?: string;         // ISO date YYYY-MM-DD
    category?: string;
    status?: SuggestionStatus | "all";
  }>;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const view: HistoryView = params.view === "decisions" ? "decisions" : "suggestions";

  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title="History"
        description={
          view === "suggestions"
            ? "Every course the agent has suggested, with current reviewer status."
            : "Every reviewer decision the system has recorded, drawn live from the feedback table."
        }
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        <nav className="flex gap-1 border-b border-gray-100">
          <TabLink href="/history?view=suggestions" active={view === "suggestions"}>
            Suggestions
          </TabLink>
          <TabLink href="/history?view=decisions" active={view === "decisions"}>
            Decisions
          </TabLink>
        </nav>

        {view === "suggestions" ? (
          <SuggestionsView params={params} />
        ) : (
          <DecisionsView params={params} />
        )}
      </div>
    </>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2 font-display text-sm font-medium tracking-wide transition-colors ${
        active
          ? "border-orange text-navy-deep"
          : "border-transparent text-gray-500 hover:text-navy-deep"
      }`}
    >
      {children}
    </Link>
  );
}

// ─── Suggestions tab ────────────────────────────────────────────

async function SuggestionsView({
  params,
}: {
  params: Awaited<HistoryPageProps["searchParams"]>;
}) {
  const supabase = await createSessionClient();

  const from = (params.from ?? "").trim();
  const to = (params.to ?? "").trim();
  const category = (params.category ?? "all").trim();
  const status = params.status ?? "all";

  let query = supabase
    .from("suggestions")
    .select("id,title,category,status,created_at,run_id")
    .order("created_at", { ascending: false })
    .limit(500);

  if (from) {
    // `from` is YYYY-MM-DD; treat as UTC midnight so the filter
    // matches the date the user picked, not their local offset.
    query = query.gte("created_at", `${from}T00:00:00Z`);
  }
  if (to) {
    // Inclusive end-of-day in UTC.
    query = query.lte("created_at", `${to}T23:59:59.999Z`);
  }
  if (category !== "all") {
    query = query.eq("category", category);
  }
  if (status !== "all") {
    query = query.eq("status", status);
  }

  // Fetch the rows + the canonical categories list for the
  // dropdown in one round-trip. The categories table has the
  // pinned/curated list; pulling distinct values from suggestions
  // would miss categories that haven't received suggestions yet.
  const [rowsResult, categoriesResult] = await Promise.all([
    query,
    supabase.from("categories").select("name").order("name", { ascending: true }),
  ]);

  if (rowsResult.error) {
    console.error("[history/suggestions] query failed:", rowsResult.error);
  }

  const rows = (rowsResult.data ?? []) as {
    id: string;
    title: string | null;
    category: string | null;
    status: SuggestionStatus;
    created_at: string;
    run_id: string;
  }[];
  const categories = (categoriesResult.data ?? []) as { name: string }[];

  return (
    <>
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-4"
      >
        {/* Tab state must survive form submit. */}
        <input type="hidden" name="view" value="suggestions" />

        <div>
          <label
            htmlFor="from"
            className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
          >
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="mt-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          />
        </div>

        <div>
          <label
            htmlFor="to"
            className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
          >
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="mt-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          />
        </div>

        <div className="min-w-[200px]">
          <label
            htmlFor="category"
            className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
          >
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={category}
            className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[180px]">
          <label
            htmlFor="status"
            className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
          >
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          >
            <option value="all">All statuses</option>
            <option value="pending_review">Pending review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="needs_revision">Needs revision</option>
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
        >
          Filter
        </button>
        {(from || to || category !== "all" || status !== "all") && (
          <Link
            href="/history?view=suggestions"
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
            suggestion{rows.length === 1 ? "" : "s"}
            {rows.length === 500 && (
              <span className="ml-2 text-[11px] text-gray-400">
                (showing latest 500 — narrow the date range to see older)
              </span>
            )}
          </span>
        </header>
        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500">
            No suggestions match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-off-white text-left text-[10px] uppercase tracking-widest text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-display font-semibold">Title</th>
                  <th className="px-6 py-3 font-display font-semibold">Category</th>
                  <th className="px-6 py-3 font-display font-semibold">Status</th>
                  <th className="px-6 py-3 font-display font-semibold whitespace-nowrap">
                    Suggested date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-off-white">
                    <td className="px-6 py-3">
                      <Link
                        href={`/suggestions/${row.id}`}
                        className="font-medium text-navy-deep hover:text-navy"
                      >
                        {row.title ?? <em className="text-gray-400">untitled</em>}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {row.category ?? "—"}
                    </td>
                    <td className="px-6 py-3">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                      {fmtDate(row.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function StatusPill({ status }: { status: SuggestionStatus }) {
  const map = {
    pending_review: "bg-amber-soft text-amber-700",
    approved: "bg-green-soft text-green-700",
    rejected: "bg-red-soft text-red-700",
    needs_revision: "bg-navy-soft text-navy-deep",
  } as const;
  const label = status.replace("_", " ");
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {label}
    </span>
  );
}

// ─── Decisions tab (unchanged from prior /history) ──────────────

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

async function DecisionsView({
  params,
}: {
  params: Awaited<HistoryPageProps["searchParams"]>;
}) {
  const q = params.q ?? "";
  const decision = params.decision ?? "all";
  const reviewer = params.reviewer ?? "all";
  const needle = q.trim().toLowerCase();

  const supabase = await createSessionClient();

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

  const [feedbackResult, taxonomyResult, reviewerSourceResult, userResult] =
    await Promise.all([
      query,
      supabase.from("rejection_taxonomy").select("key,label"),
      supabase
        .from("feedback")
        .select("reviewer_id")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.auth.getUser(),
    ]);

  if (feedbackResult.error) {
    console.error("[history/decisions] feedback query failed:", feedbackResult.error);
  }

  const rawRows = (feedbackResult.data ?? []) as unknown as FeedbackRow[];
  const taxonomy = (taxonomyResult.data ?? []) as RejectionTaxonomyRow[];
  const tagLabelByKey = new Map(taxonomy.map((t) => [t.key, t.label]));
  const currentUserId = userResult.data.user?.id ?? null;

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
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-4"
      >
        <input type="hidden" name="view" value="decisions" />

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
            href="/history?view=decisions"
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

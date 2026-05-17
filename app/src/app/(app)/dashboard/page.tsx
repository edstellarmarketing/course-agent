import Link from "next/link";

import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { FeedbackDecision } from "@/lib/types";

export const metadata = {
  title: "Dashboard · Course Agent",
};

// Approve/reject/needs-revision actions revalidatePath("/dashboard"),
// but only if we opt out of static caching. Every visit re-runs the
// queries.
export const dynamic = "force-dynamic";

const dollarsUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const pct = (n: number) => `${Math.round(n * 100)}%`;

interface AgentRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  model_used: string;
  categories_targeted: string[];
  candidates_produced: number | null;
}

interface PendingSuggestionRow {
  id: string;
  title: string;
  category: string;
  duration_days: number | null;
  suggested_price_usd: number;
  delivery_format: string;
}

// PostgREST embedding with a single-FK relationship returns the joined
// row as a single object at runtime, but supabase-js's TS generics
// conservatively type it as an array. We type to match runtime and
// cast through `unknown` at the call site.
interface FeedbackRow {
  id: string;
  decision: FeedbackDecision;
  reason_tags: string[];
  reviewer_id: string;
  created_at: string;
  suggestion_id: string;
  suggestions: { title: string | null } | null;
}

interface CategoryRow {
  name: string;
  course_count: number | null;
  target_count: number | null;
  is_pinned: boolean | null;
}

interface RejectionTaxonomyRow {
  key: string;
  label: string;
}

export default async function DashboardPage() {
  const supabase = await createSessionClient();

  // Window cutoffs computed once on the server. Postgres will see an
  // ISO string parameter and filter by `created_at >= cutoff`.
  const now = new Date();
  const cutoff30 = new Date(now);
  cutoff30.setDate(cutoff30.getDate() - 30);
  const cutoff30Iso = cutoff30.toISOString();

  const [
    pendingCountResult,
    courseCountResult,
    latestRunResult,
    queueSnapshotResult,
    recentFeedbackResult,
    last30dFeedbackResult,
    categoriesResult,
    taxonomyResult,
    userResult,
  ] = await Promise.all([
    supabase
      .from("suggestions")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_review"),
    supabase
      .from("courses")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("agent_runs")
      .select(
        "id,started_at,finished_at,model_used,categories_targeted,candidates_produced",
      )
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("suggestions")
      .select(
        "id,title,category,duration_days,suggested_price_usd,delivery_format",
      )
      .eq("status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("feedback")
      .select(
        "id,decision,reason_tags,reviewer_id,created_at,suggestion_id,suggestions(title)",
      )
      .order("created_at", { ascending: false })
      .limit(8),
    // 30-day window powers both the 7d and 30d approval-rate tiles
    // plus the top-rejection-tag counter. One query, two windows
    // computed in JS — cheaper than three separate filtered queries.
    supabase
      .from("feedback")
      .select("decision,reason_tags,created_at")
      .gte("created_at", cutoff30Iso)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("categories_with_counts")
      .select("name,course_count,target_count,is_pinned")
      .order("name"),
    supabase.from("rejection_taxonomy").select("key,label"),
    supabase.auth.getUser(),
  ]);

  const pendingCount = pendingCountResult.count ?? 0;
  const courseCount = courseCountResult.count ?? 0;
  const latestRun = (latestRunResult.data ?? null) as AgentRunRow | null;
  const queueSnapshot = (queueSnapshotResult.data ?? []) as PendingSuggestionRow[];
  const recentFeedback = (recentFeedbackResult.data ?? []) as unknown as FeedbackRow[];
  const last30dFeedback = (last30dFeedbackResult.data ?? []) as Array<{
    decision: FeedbackDecision;
    reason_tags: string[];
    created_at: string;
  }>;
  const categories = (categoriesResult.data ?? []) as CategoryRow[];
  const taxonomy = (taxonomyResult.data ?? []) as RejectionTaxonomyRow[];
  const tagLabelByKey = new Map(taxonomy.map((t) => [t.key, t.label]));
  const currentUserId = userResult.data.user?.id ?? null;

  const seven = approvalRate(last30dFeedback, 7, now);
  const thirty = approvalRate(last30dFeedback, 30, now);
  const sevenDelta = seven - thirty;
  const topTag = topRejectionTagThisWeek(last30dFeedback, now);
  const topTagLabel = topTag
    ? tagLabelByKey.get(topTag.tag) ?? topTag.tag
    : "—";

  const pinnedCategoriesCount = categories.filter((c) => c.is_pinned).length;
  const categoryByName = new Map(categories.map((c) => [c.name, c]));

  const finishedAtLabel = latestRun?.finished_at
    ? new Date(latestRun.finished_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Morning overview"
        title="Dashboard"
        description={
          latestRun
            ? `Latest agent run ${finishedAtLabel ? `finished at ${finishedAtLabel} UTC` : "is still running"}. ${pendingCount} candidate${pendingCount === 1 ? "" : "s"} await${pendingCount === 1 ? "s" : ""} review.`
            : `No agent runs yet. ${pendingCount} candidate${pendingCount === 1 ? "" : "s"} pending review.`
        }
        actions={
          <Link
            href="/suggestions/today"
            className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
          >
            Open today&rsquo;s queue →
          </Link>
        }
      />

      <div className="flex-1 space-y-8 px-8 py-8">
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
          <KpiCard
            label="Pending review"
            value={pendingCount}
            caption={
              latestRun
                ? `from ${latestRun.categories_targeted.length} categories targeted`
                : "awaiting first agent run"
            }
            accent="orange"
          />
          <KpiCard
            label="Catalogue size"
            value={courseCount.toLocaleString()}
            caption="courses in the inventory"
            accent="navy"
          />
          <KpiCard
            label="7d approval rate"
            value={pct(seven)}
            delta={{
              direction:
                sevenDelta > 0.01 ? "up" : sevenDelta < -0.01 ? "down" : "flat",
              label: `${sevenDelta >= 0 ? "+" : ""}${Math.round(sevenDelta * 100)} vs 30d`,
            }}
            accent="green"
          />
          <KpiCard
            label="30d approval rate"
            value={pct(thirty)}
            caption="trailing window"
            accent="neutral"
          />
          <KpiCard
            label="Top rejection reason"
            value={topTagLabel}
            caption={topTag ? `${topTag.count} this week` : "no rejections this week"}
            accent="orange"
          />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
          <div className="rounded-lg border border-gray-100 bg-white">
            <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                  Today&rsquo;s queue snapshot
                </div>
                <h2 className="font-display text-lg font-semibold text-navy-deep">
                  {pendingCount} candidate{pendingCount === 1 ? "" : "s"} pending
                  {latestRun
                    ? ` from ${latestRun.categories_targeted.length} categories`
                    : ""}
                </h2>
              </div>
              <Link
                href="/suggestions/today"
                className="font-display text-xs font-medium text-navy hover:text-navy-deep"
              >
                Review all →
              </Link>
            </header>
            {queueSnapshot.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">
                No pending suggestions. The next agent run will populate this
                feed.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {queueSnapshot.map((s) => (
                  <li key={s.id} className="px-6 py-4">
                    <Link href={`/suggestions/${s.id}`} className="group block">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                            {s.category}
                          </div>
                          <div className="mt-1 text-sm font-medium text-gray-800 group-hover:text-navy">
                            {s.title}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-sm font-semibold text-navy-deep">
                            {dollarsUsd(Number(s.suggested_price_usd))}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {s.duration_days ?? "—"}d · {s.delivery_format}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-gray-100 bg-white">
            <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                  Recent activity
                </div>
                <h2 className="font-display text-lg font-semibold text-navy-deep">
                  Reviewer decisions
                </h2>
              </div>
              <Link
                href="/history"
                className="font-display text-xs font-medium text-navy hover:text-navy-deep"
              >
                Full history →
              </Link>
            </header>
            {recentFeedback.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">
                No decisions yet — the first approve / reject / needs-revision
                will land here.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentFeedback.map((f) => (
                  <li key={f.id} className="flex items-start gap-3 px-6 py-3">
                    <DecisionDot decision={f.decision} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-800">
                        {f.suggestions?.title ?? "—"}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {reviewerLabel(f.reviewer_id, currentUserId)} ·{" "}
                        {new Date(f.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {latestRun && (
          <section className="rounded-lg border border-gray-100 bg-white">
            <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                  Targeting today
                </div>
                <h2 className="font-display text-lg font-semibold text-navy-deep">
                  Categories the agent worked on today
                </h2>
              </div>
              <div className="text-[11px] text-gray-500">
                {pinnedCategoriesCount} category
                {pinnedCategoriesCount === 1 ? "" : "ies"} pinned by admins
              </div>
            </header>
            <div className="grid grid-cols-1 gap-2 px-6 py-4 sm:grid-cols-2 lg:grid-cols-3">
              {latestRun.categories_targeted.map((name) => {
                const cat = categoryByName.get(name);
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-sm"
                  >
                    <span className="truncate font-medium text-gray-800">
                      {name}
                    </span>
                    <span className="font-mono text-[11px] text-gray-500">
                      {cat?.course_count ?? 0}/{cat?.target_count ?? "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function approvalRate(
  rows: Array<{ decision: FeedbackDecision; created_at: string }>,
  days: number,
  now: Date,
): number {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const inWindow = rows.filter((r) => new Date(r.created_at) >= cutoff);
  if (inWindow.length === 0) return 0;
  const approved = inWindow.filter((r) => r.decision === "approved").length;
  return approved / inWindow.length;
}

function topRejectionTagThisWeek(
  rows: Array<{
    decision: FeedbackDecision;
    reason_tags: string[];
    created_at: string;
  }>,
  now: Date,
): { tag: string; count: number } | null {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const counts = new Map<string, number>();
  for (const f of rows) {
    if (f.decision !== "rejected") continue;
    if (new Date(f.created_at) < cutoff) continue;
    for (const tag of f.reason_tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  let best: { tag: string; count: number } | null = null;
  for (const [tag, count] of counts) {
    if (!best || count > best.count) best = { tag, count };
  }
  return best;
}

function reviewerLabel(
  reviewerId: string,
  currentUserId: string | null,
): string {
  if (currentUserId && reviewerId === currentUserId) return "You";
  return `Reviewer ${reviewerId.slice(0, 8)}`;
}

function DecisionDot({
  decision,
}: {
  decision: "approved" | "rejected" | "needs_revision";
}) {
  const map = {
    approved: "bg-green-500",
    rejected: "bg-red-500",
    needs_revision: "bg-amber-500",
  } as const;
  return (
    <span
      aria-label={decision}
      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${map[decision]}`}
    />
  );
}


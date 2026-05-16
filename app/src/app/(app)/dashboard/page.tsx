import Link from "next/link";

import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { mockCategories } from "@/lib/mock/categories";
import { mockCourseCount } from "@/lib/mock/courses";
import {
  approvalRate,
  mockFeedback,
  topRejectionTagsThisWeek,
} from "@/lib/mock/feedback";
import { mockRejectionTaxonomy } from "@/lib/mock/rejection-taxonomy";
import {
  mockAllSuggestions,
  mockTodaysRun,
  mockTodaysSuggestions,
} from "@/lib/mock/suggestions";

export const metadata = {
  title: "Dashboard · Course Agent",
};

const dollarsUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function DashboardPage() {
  const pendingCount = mockTodaysSuggestions.filter(
    (s) => s.status === "pending_review",
  ).length;
  const seven = approvalRate("7d");
  const thirty = approvalRate("30d");
  const sevenDelta = seven - thirty;
  const topTags = topRejectionTagsThisWeek();
  const topTagLabel = topTags[0]
    ? mockRejectionTaxonomy.find((t) => t.key === topTags[0].tag)?.label ??
      topTags[0].tag
    : "—";
  const pinnedCategories = mockCategories.filter((c) => c.isPinned).length;

  // Recent activity = latest 8 feedback rows, joined to suggestion title
  const recent = [...mockFeedback]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
    .map((f) => ({
      ...f,
      suggestion: mockAllSuggestions.find((s) => s.id === f.suggestionId),
    }));

  return (
    <>
      <PageHeader
        eyebrow="Morning overview"
        title="Dashboard"
        description={`Today's agent run finished at ${new Date(mockTodaysRun.finishedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC. ${pendingCount} candidate${pendingCount === 1 ? "" : "s"} await${pendingCount === 1 ? "s" : ""} review.`}
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
            caption={`from ${mockTodaysRun.categoriesTargeted.length} categories targeted`}
            accent="orange"
          />
          <KpiCard
            label="Catalogue size"
            value={mockCourseCount.toLocaleString()}
            caption="courses in the inventory"
            accent="navy"
          />
          <KpiCard
            label="7d approval rate"
            value={pct(seven)}
            delta={{
              direction: sevenDelta > 0.01 ? "up" : sevenDelta < -0.01 ? "down" : "flat",
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
            caption={topTags[0] ? `${topTags[0].count} this week` : "no rejections this week"}
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
                  {mockTodaysSuggestions.length} candidates from {mockTodaysRun.categoriesTargeted.length} categories
                </h2>
              </div>
              <Link
                href="/suggestions/today"
                className="font-display text-xs font-medium text-navy hover:text-navy-deep"
              >
                Review all →
              </Link>
            </header>
            <ul className="divide-y divide-gray-100">
              {mockTodaysSuggestions.slice(0, 4).map((s) => (
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
                          {dollarsUsd(s.suggestedPriceUsd)}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {s.durationDays}d · {s.deliveryFormat}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
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
            <ul className="divide-y divide-gray-100">
              {recent.map((f) => (
                <li key={f.id} className="flex items-start gap-3 px-6 py-3">
                  <DecisionDot decision={f.decision} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-800">
                      {f.suggestion?.title ?? "—"}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {f.reviewerName} ·{" "}
                      {new Date(f.createdAt).toLocaleString([], {
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
          </div>
        </section>

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
              {pinnedCategories} category{pinnedCategories === 1 ? "" : "ies"} pinned by admins
            </div>
          </header>
          <div className="grid grid-cols-1 gap-2 px-6 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {mockTodaysRun.categoriesTargeted.map((name) => {
              const cat = mockCategories.find((c) => c.name === name);
              return (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-sm"
                >
                  <span className="truncate font-medium text-gray-800">{name}</span>
                  <span className="font-mono text-[11px] text-gray-500">
                    {cat?.courseCount ?? 0}/{cat?.targetCount ?? "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function DecisionDot({ decision }: { decision: "approved" | "rejected" | "needs_revision" }) {
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

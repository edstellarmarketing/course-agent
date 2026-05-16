import { PageHeader } from "@/components/page-header";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { mockFeedback } from "@/lib/mock/feedback";
import { mockPromptVersions } from "@/lib/mock/prompt-versions";
import { mockRejectionTaxonomy } from "@/lib/mock/rejection-taxonomy";

export const metadata = {
  title: "Learning Admin · Course Agent",
};

// Hand-crafted 8-week approval-rate trend — Phase 1 illustration only.
// Phase 8 will compute this from `agent_runs` + `feedback`.
const APPROVAL_TREND = [
  { week: "Mar 24", rate: 0.41 },
  { week: "Mar 31", rate: 0.46 },
  { week: "Apr 07", rate: 0.49 },
  { week: "Apr 14", rate: 0.52 },
  { week: "Apr 21", rate: 0.58 },
  { week: "Apr 28", rate: 0.6 },
  { week: "May 05", rate: 0.63 },
  { week: "May 12", rate: 0.64 },
];

export default async function LearningPage() {
  const profile = await getCurrentReviewer();
  const isAdmin = profile?.role === "admin";

  // Rejection-reason distribution across the full feedback window.
  const tagCounts = new Map<string, number>();
  for (const f of mockFeedback) {
    if (f.decision !== "rejected") continue;
    for (const tag of f.reasonTags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const ranked = [...tagCounts.entries()]
    .map(([key, count]) => ({
      key,
      label:
        mockRejectionTaxonomy.find((t) => t.key === key)?.label ?? key,
      count,
    }))
    .sort((a, b) => b.count - a.count);
  const maxCount = ranked[0]?.count ?? 1;

  const maxRate = Math.max(...APPROVAL_TREND.map((p) => p.rate));
  const minRate = Math.min(...APPROVAL_TREND.map((p) => p.rate));

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Learning"
        description="Inspect what the agent is learning from reviewer feedback. Trends, rejection patterns, prompt evolution."
      />

      <div className="flex-1 space-y-6 px-8 py-8">
        {!isAdmin && (
          <div className="rounded-md border border-amber-200 bg-amber-soft px-4 py-3 text-sm text-amber-900">
            <span className="font-display text-[11px] font-semibold uppercase tracking-widest">
              Admin only ·
            </span>{" "}
            Real role-based gating comes in Phase 3. This view is visible to
            you in Phase 1 demos.
          </div>
        )}

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div className="rounded-lg border border-gray-100 bg-white">
            <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                  Approval-rate trend
                </div>
                <h2 className="font-display text-lg font-semibold text-navy-deep">
                  Last 8 weeks
                </h2>
              </div>
              <span className="font-mono text-xs text-gray-500">
                Range {Math.round(minRate * 100)}% → {Math.round(maxRate * 100)}%
              </span>
            </header>
            <div className="px-6 py-6">
              <ApprovalTrendChart points={APPROVAL_TREND} />
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-white">
            <header className="border-b border-gray-100 px-6 py-4">
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                Rejection-reason mix
              </div>
              <h2 className="font-display text-lg font-semibold text-navy-deep">
                What the agent is getting wrong
              </h2>
            </header>
            {ranked.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">
                No rejections in the current window.
              </p>
            ) : (
              <ul className="space-y-2 px-6 py-5">
                {ranked.map((r) => (
                  <li key={r.key}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-gray-700">{r.label}</span>
                      <span className="font-mono text-xs text-gray-500">
                        {r.count}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-orange"
                        style={{ width: `${(r.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-gray-100 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
            <div>
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                Prompt versions
              </div>
              <h2 className="font-display text-lg font-semibold text-navy-deep">
                Active, candidate, and retired prompts
              </h2>
            </div>
            <button
              type="button"
              disabled={!isAdmin}
              className="rounded-md bg-orange px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              Regenerate from feedback
            </button>
          </header>
          <ul className="divide-y divide-gray-100">
            {mockPromptVersions.map((pv) => (
              <li key={pv.id} className="grid grid-cols-1 gap-3 px-6 py-4 sm:grid-cols-[auto_1fr_auto]">
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-navy-soft px-2 py-1 font-display text-xs font-semibold text-navy-deep">
                    v{pv.version}
                  </span>
                  <StatusPill status={pv.status} />
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-xs text-gray-500">{pv.modelSlug}</div>
                  {pv.notes && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">
                      {pv.notes}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm">
                  <div className="font-mono font-semibold text-navy-deep">
                    {pv.approvalRate == null
                      ? "—"
                      : `${Math.round(pv.approvalRate * 100)}%`}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {pv.runsObserved} run{pv.runsObserved === 1 ? "" : "s"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function ApprovalTrendChart({
  points,
}: {
  points: { week: string; rate: number }[];
}) {
  if (points.length === 0) return null;
  const width = 720;
  const height = 180;
  const padX = 32;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = innerW / (points.length - 1);
  const x = (i: number) => padX + i * stepX;
  const y = (rate: number) => padY + innerH * (1 - rate);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.rate)}`)
    .join(" ");
  const area = `${path} L ${x(points.length - 1)} ${padY + innerH} L ${x(0)} ${padY + innerH} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Weekly approval rate trend"
      className="w-full"
    >
      <defs>
        <linearGradient id="approval-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1A3C6E" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#1A3C6E" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <line
          key={r}
          x1={padX}
          x2={padX + innerW}
          y1={y(r)}
          y2={y(r)}
          stroke="#E4E8F0"
          strokeWidth={1}
        />
      ))}
      <path d={area} fill="url(#approval-fill)" />
      <path d={path} fill="none" stroke="#1A3C6E" strokeWidth={2} />
      {points.map((p, i) => (
        <g key={p.week}>
          <circle cx={x(i)} cy={y(p.rate)} r={3} fill="#F47920" />
          <text
            x={x(i)}
            y={padY + innerH + 14}
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize={10}
            fill="#8896B0"
          >
            {p.week}
          </text>
          <text
            x={x(i)}
            y={y(p.rate) - 8}
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize={10}
            fontWeight={600}
            fill="#0F2447"
          >
            {Math.round(p.rate * 100)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

function StatusPill({ status }: { status: "active" | "candidate" | "retired" }) {
  const map = {
    active: "bg-green-soft text-green-700",
    candidate: "bg-orange-pale text-orange",
    retired: "bg-gray-100 text-gray-500",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {status}
    </span>
  );
}

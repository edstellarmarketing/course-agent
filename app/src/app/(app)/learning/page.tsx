import { PageHeader } from "@/components/page-header";
import { PromptVersionRow } from "@/components/prompt-version-row";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { FeedbackDecision } from "@/lib/types";

export const metadata = {
  title: "Learning Admin · Course Agent",
};

// Re-render on every visit — promote/retire actions need to be
// immediately visible after a Server Action.
export const dynamic = "force-dynamic";

// 28 days of feedback feeds the approval-rate trend (4 weekly buckets).
// 60 days powers the "this month vs last month" deltas on the
// rejection-tag distribution.
const TREND_DAYS = 28;
const DELTA_TOTAL_DAYS = 60;
const MIN_FOR_STATS = 20;

interface FeedbackTrendRow {
  decision: FeedbackDecision;
  reason_tags: string[];
  created_at: string;
}

interface PromptVersionRowRaw {
  id: string;
  version: number;
  status: "active" | "candidate" | "retired";
  model_slug: string;
  notes: string | null;
  approval_rate: number | null;
  runs_observed: number | null;
}

interface RejectionTaxonomyRow {
  key: string;
  label: string;
}

interface AgentRunRowMini {
  prompt_version_id: string | null;
  approval_rate: number | null;
}

export default async function LearningPage() {
  const [profile, supabase] = await Promise.all([
    getCurrentReviewer(),
    createSessionClient(),
  ]);
  const isAdmin = profile?.role === "admin";

  const now = new Date();
  const cutoff60 = new Date(now);
  cutoff60.setDate(cutoff60.getDate() - DELTA_TOTAL_DAYS);
  const cutoff60Iso = cutoff60.toISOString();

  // Single 60-day pull serves the 28-day trend + 30/30 delta. The
  // rejection-tag distribution view groups in JS — feedback volume
  // for the foreseeable future stays under a few hundred rows.
  const [feedbackRes, taxonomyRes, promptRes, runsRes] = await Promise.all([
    supabase
      .from("feedback")
      .select("decision,reason_tags,created_at")
      .gte("created_at", cutoff60Iso)
      .order("created_at", { ascending: true }),
    supabase.from("rejection_taxonomy").select("key,label"),
    supabase
      .from("prompt_versions")
      .select(
        "id,version,status,model_slug,notes,approval_rate,runs_observed",
      )
      .order("version", { ascending: false }),
    // For per-prompt-version live win-rate, we recompute from
    // agent_runs.approval_rate rather than rely on the
    // prompt_versions.approval_rate column (which Phase 8 doesn't
    // update yet — Phase 9's auto-promote will).
    supabase
      .from("agent_runs")
      .select("prompt_version_id,approval_rate")
      .neq("model_used", "seed-data"),
  ]);

  const feedback = (feedbackRes.data ?? []) as FeedbackTrendRow[];
  const taxonomy = (taxonomyRes.data ?? []) as RejectionTaxonomyRow[];
  const promptVersions = (promptRes.data ?? []) as PromptVersionRowRaw[];
  const runs = (runsRes.data ?? []) as AgentRunRowMini[];
  const tagLabelByKey = new Map(taxonomy.map((t) => [t.key, t.label]));

  // ── 28-day weekly approval-rate trend ─────────────────────────
  const trend = buildWeeklyTrend(feedback, now, TREND_DAYS / 7);

  // ── Rejection-tag distribution + 30/30 delta ──────────────────
  const split = splitByHalf(feedback, now, DELTA_TOTAL_DAYS / 2);
  const ranked = rankRejectionTags(split.recent, split.prior, tagLabelByKey);

  // ── Win-rate per prompt version from agent_runs ───────────────
  const winRateByPromptId = computeWinRates(runs);

  const trendCount = feedback.filter((f) => decisionInTrendWindow(f, now, TREND_DAYS)).length;

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Learning"
        description="What the agent is learning from reviewer feedback. Trend, rejection patterns, prompt evolution."
      />

      <div className="flex-1 space-y-6 px-8 py-8">
        {!isAdmin && (
          <div className="rounded-md border border-amber-200 bg-amber-soft px-4 py-3 text-sm text-amber-900">
            <span className="font-display text-[11px] font-semibold uppercase tracking-widest">
              Admin only ·
            </span>{" "}
            You can view this page but Promote / Retire actions are gated
            on <code className="rounded bg-amber-100 px-1 font-mono text-[10px]">app_metadata.course_agent_role === &quot;admin&quot;</code>.
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
                  Last {TREND_DAYS / 7} weeks
                </h2>
              </div>
              <span className="font-mono text-xs text-gray-500">
                {trend.length === 0
                  ? "—"
                  : `Range ${Math.round(trend.reduce((m, p) => Math.min(m, p.rate), 1) * 100)}% → ${Math.round(trend.reduce((m, p) => Math.max(m, p.rate), 0) * 100)}%`}
              </span>
            </header>
            <div className="px-6 py-6">
              {trendCount < MIN_FOR_STATS ? (
                <NotEnoughData
                  observed={trendCount}
                  threshold={MIN_FOR_STATS}
                  message={`Only ${trendCount} decision${trendCount === 1 ? "" : "s"} in the last ${TREND_DAYS} days — trend isn't meaningful yet.`}
                />
              ) : (
                <ApprovalTrendChart points={trend} />
              )}
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
                No rejections in the last 30 days.
              </p>
            ) : (
              <ul className="space-y-2 px-6 py-5">
                {ranked.map((r) => (
                  <li key={r.key}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-gray-700">{r.label}</span>
                      <span className="flex items-center gap-2 font-mono text-xs">
                        <DeltaPill delta={r.delta} />
                        <span className="text-gray-500">{r.count}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-orange"
                        style={{
                          width: `${(r.count / Math.max(1, ranked[0].count)) * 100}%`,
                        }}
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
            <div className="text-right">
              <details className="group">
                <summary className="cursor-pointer rounded-md bg-orange px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-light">
                  Regenerate from feedback
                </summary>
                <div className="mt-2 max-w-md rounded-md border border-gray-200 bg-white p-3 text-left text-xs text-gray-600">
                  Run the regenerate script from your terminal — it pulls the
                  active prompt + last 7 days of rejections and asks DeepSeek
                  to propose an improved version. The result is inserted as a
                  candidate row you can Promote here.
                  <pre className="mt-2 overflow-x-auto rounded bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-800">
                    uv --directory engine run regenerate_prompt
                  </pre>
                </div>
              </details>
            </div>
          </header>
          {promptVersions.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-500">
              No prompt versions yet — run any agent_run and the engine will
              seed v1 automatically.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {promptVersions.map((pv) => {
                const live = winRateByPromptId.get(pv.id);
                const approvalRate =
                  live && live.runs >= 2
                    ? live.average
                    : pv.approval_rate;
                const runsObserved =
                  live?.runs ?? (pv.runs_observed ?? 0);
                const needsMoreData =
                  pv.status !== "retired" && runsObserved < 2;
                return (
                  <PromptVersionRow
                    key={pv.id}
                    id={pv.id}
                    version={pv.version}
                    status={pv.status}
                    modelSlug={pv.model_slug}
                    notes={
                      needsMoreData
                        ? `${pv.notes ?? ""}${pv.notes ? " · " : ""}Needs more data (n=${runsObserved})`.trim()
                        : pv.notes
                    }
                    approvalRate={approvalRate}
                    runsObserved={runsObserved}
                  />
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function decisionInTrendWindow(
  f: { created_at: string },
  now: Date,
  days: number,
): boolean {
  const t = new Date(f.created_at).getTime();
  return t >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function buildWeeklyTrend(
  feedback: FeedbackTrendRow[],
  now: Date,
  weeks: number,
): { week: string; rate: number; n: number }[] {
  const buckets: { week: string; approved: number; total: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    buckets.push({
      week: end.toLocaleDateString([], { month: "short", day: "2-digit" }),
      approved: 0,
      total: 0,
    });
    const bucket = buckets[buckets.length - 1];
    for (const f of feedback) {
      const t = new Date(f.created_at).getTime();
      if (t < start.getTime() || t >= end.getTime()) continue;
      bucket.total += 1;
      if (f.decision === "approved") bucket.approved += 1;
    }
  }
  return buckets.map((b) => ({
    week: b.week,
    rate: b.total === 0 ? 0 : b.approved / b.total,
    n: b.total,
  }));
}

function splitByHalf(
  feedback: FeedbackTrendRow[],
  now: Date,
  halfDays: number,
): { recent: FeedbackTrendRow[]; prior: FeedbackTrendRow[] } {
  const recentCutoff = now.getTime() - halfDays * 24 * 60 * 60 * 1000;
  const priorCutoff = now.getTime() - 2 * halfDays * 24 * 60 * 60 * 1000;
  const recent: FeedbackTrendRow[] = [];
  const prior: FeedbackTrendRow[] = [];
  for (const f of feedback) {
    if (f.decision !== "rejected") continue;
    const t = new Date(f.created_at).getTime();
    if (t >= recentCutoff) recent.push(f);
    else if (t >= priorCutoff) prior.push(f);
  }
  return { recent, prior };
}

function rankRejectionTags(
  recent: FeedbackTrendRow[],
  prior: FeedbackTrendRow[],
  tagLabelByKey: Map<string, string>,
): { key: string; label: string; count: number; delta: number }[] {
  const recentCounts = countTags(recent);
  const priorCounts = countTags(prior);
  const keys = new Set([...recentCounts.keys(), ...priorCounts.keys()]);
  const rows = [...keys].map((key) => {
    const count = recentCounts.get(key) ?? 0;
    const priorCount = priorCounts.get(key) ?? 0;
    return {
      key,
      label: tagLabelByKey.get(key) ?? key,
      count,
      delta: count - priorCount,
    };
  });
  return rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

function countTags(rows: FeedbackTrendRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const tag of r.reason_tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

function computeWinRates(
  runs: AgentRunRowMini[],
): Map<string, { average: number; runs: number }> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of runs) {
    if (!r.prompt_version_id) continue;
    if (r.approval_rate == null) continue;
    const prev = acc.get(r.prompt_version_id) ?? { sum: 0, n: 0 };
    prev.sum += r.approval_rate;
    prev.n += 1;
    acc.set(r.prompt_version_id, prev);
  }
  const out = new Map<string, { average: number; runs: number }>();
  for (const [pid, { sum, n }] of acc) {
    out.set(pid, { average: sum / n, runs: n });
  }
  return out;
}

// ── Mini SVG chart (kept from Phase 1 — re-used as-is) ──────────

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
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;
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

function NotEnoughData({
  observed,
  threshold,
  message,
}: {
  observed: number;
  threshold: number;
  message: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-gray-200 bg-off-white px-4 py-6 text-center">
      <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
        Needs more data
      </div>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      <p className="mt-1 text-[11px] text-gray-500">
        Trend renders once we have at least {threshold} decisions in the window.
        Currently: {observed}.
      </p>
    </div>
  );
}

function DeltaPill({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-400">
        =
      </span>
    );
  }
  const tone =
    delta > 0
      ? "bg-red-soft text-red-700"
      : "bg-green-soft text-green-700";
  const sign = delta > 0 ? "+" : "";
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 font-display text-[10px] font-semibold tracking-wider ${tone}`}
    >
      {sign}
      {delta}
    </span>
  );
}

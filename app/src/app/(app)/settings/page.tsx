import { PageHeader } from "@/components/page-header";
import { mockReviewers } from "@/lib/mock/reviewers";
import type { UserRole } from "@/lib/types";

export const metadata = {
  title: "Settings · Course Agent",
};

// Service connection state — Phase 2 wires this to real smoke-test results.
const INTEGRATIONS = [
  { name: "Supabase", purpose: "Database, Auth, RLS", status: "pending" as const, phase: "Phase 3" },
  { name: "OpenRouter", purpose: "LLM gateway (Claude, GPT, Gemini)", status: "pending" as const, phase: "Phase 6" },
  { name: "Voyage AI", purpose: "Embeddings for dedup + negative memory", status: "pending" as const, phase: "Phase 4" },
  { name: "Serper", purpose: "Web search backbone for ScrapeGraphAI", status: "pending" as const, phase: "Phase 6" },
  { name: "Google Apps Script email", purpose: "Daily reviewer digest", status: "pending" as const, phase: "Phase 7" },
  { name: "Slack", purpose: "Run-complete pings (optional)", status: "pending" as const, phase: "Phase 7" },
  { name: "Langfuse", purpose: "Per-node tracing of agent runs", status: "pending" as const, phase: "Phase 9" },
  { name: "Sentry", purpose: "Error reporting in both apps", status: "pending" as const, phase: "Phase 9" },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Reviewer roster, agent schedule, and integration status. Phase 1 ships the shell; Phases 2–9 fill in the wires."
      />

      <div className="flex-1 space-y-6 px-8 py-8">
        <section className="rounded-lg border border-gray-100 bg-white">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                Reviewers
              </div>
              <h2 className="font-display text-lg font-semibold text-navy-deep">
                Who can act on the queue
              </h2>
            </div>
            <button
              type="button"
              disabled
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
              title="Invite flow lands in Phase 3"
            >
              Invite reviewer
            </button>
          </header>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500">
                <th className="px-6 py-3 font-display font-semibold">Name</th>
                <th className="px-6 py-3 font-display font-semibold">Email</th>
                <th className="px-6 py-3 font-display font-semibold">Role</th>
              </tr>
            </thead>
            <tbody>
              {mockReviewers.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-6 py-3 font-medium text-navy-deep">{r.name}</td>
                  <td className="px-6 py-3 font-mono text-xs text-gray-700">{r.email}</td>
                  <td className="px-6 py-3">
                    <RoleBadge role={r.role} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-gray-100 bg-white">
            <header className="border-b border-gray-100 px-6 py-4">
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                Agent schedule
              </div>
              <h2 className="font-display text-lg font-semibold text-navy-deep">
                When the pipeline runs
              </h2>
            </header>
            <dl className="divide-y divide-gray-100 text-sm">
              <SettingRow
                label="Daily run"
                value="00:05 UTC"
                hint="Finishes before 06:00 across our reviewer time zones"
              />
              <SettingRow
                label="Reviewer digest email"
                value="06:00 local time"
                hint="Sent via the Google Apps Script relay"
              />
              <SettingRow
                label="Categories per run"
                value="5–7 (auto)"
                hint="Picked by gap-analysis × demand × admin pin overrides"
              />
              <SettingRow
                label="Candidates per category"
                value="5–10"
                hint="After all 10 rules apply"
              />
            </dl>
          </section>

          <section className="rounded-lg border border-gray-100 bg-white">
            <header className="border-b border-gray-100 px-6 py-4">
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
                Notifications
              </div>
              <h2 className="font-display text-lg font-semibold text-navy-deep">
                Where the agent talks to you
              </h2>
            </header>
            <dl className="divide-y divide-gray-100 text-sm">
              <SettingRow label="Daily digest email" value="On" hint="Per reviewer" />
              <SettingRow label="Slack run-complete ping" value="Pending" hint="Wired in Phase 7" />
              <SettingRow label="Spike alerts" value="Pending" hint="Approval rate drop > 10pp" />
            </dl>
          </section>
        </div>

        <section className="rounded-lg border border-gray-100 bg-white">
          <header className="border-b border-gray-100 px-6 py-4">
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
              Integrations
            </div>
            <h2 className="font-display text-lg font-semibold text-navy-deep">
              External services
            </h2>
          </header>
          <ul className="divide-y divide-gray-100">
            {INTEGRATIONS.map((it) => (
              <li
                key={it.name}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-navy-deep">{it.name}</div>
                  <div className="text-xs text-gray-500">{it.purpose}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-gray-500">{it.phase}</span>
                  <ConnectionPill status={it.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function SettingRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 px-6 py-3">
      <div>
        <dt className="text-sm text-gray-700">{label}</dt>
        {hint && <dd className="text-[11px] text-gray-500">{hint}</dd>}
      </div>
      <dd className="font-mono text-sm font-semibold text-navy-deep">{value}</dd>
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const map = {
    admin: "bg-orange-pale text-orange",
    reviewer: "bg-navy-soft text-navy-deep",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[role]}`}
    >
      {role}
    </span>
  );
}

function ConnectionPill({
  status,
}: {
  status: "connected" | "pending" | "error";
}) {
  const map = {
    connected: "bg-green-soft text-green-700",
    pending: "bg-gray-100 text-gray-600",
    error: "bg-red-soft text-red-700",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {status}
    </span>
  );
}

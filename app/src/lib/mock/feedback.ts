import type { Feedback } from "@/lib/types";

/**
 * Recent reviewer actions. Drives the Dashboard recent-activity feed and the
 * History view. Phase 5 will read these from the `feedback` table joined
 * to `auth.users`.
 */
export const mockFeedback: Feedback[] = [
  {
    id: "fb-001",
    suggestionId: "sg-2026-05-15-001",
    decision: "approved",
    reasonTags: [],
    reasonText: null,
    reviewerId: "11111111-1111-1111-1111-111111111111",
    reviewerName: "Priya Menon",
    createdAt: "2026-05-15T08:14:00.000Z",
  },
  {
    id: "fb-002",
    suggestionId: "sg-2026-05-14-002",
    decision: "rejected",
    reasonTags: ["certification_name_used"],
    reasonText:
      "Title uses 'CIPP/E' — that's an IAPP-issued credential we can't market. Propose a neutral GDPR-focused title.",
    reviewerId: "11111111-1111-1111-1111-111111111111",
    reviewerName: "Priya Menon",
    createdAt: "2026-05-14T08:42:00.000Z",
  },
  {
    id: "fb-003",
    suggestionId: "sg-2026-05-13-003",
    decision: "rejected",
    reasonTags: ["too_niche", "not_corporate_relevant"],
    reasonText: "Audience is genuinely tiny outside research labs.",
    reviewerId: "22222222-2222-2222-2222-222222222222",
    reviewerName: "Daniel Cho",
    createdAt: "2026-05-13T09:08:00.000Z",
  },
  {
    id: "fb-004",
    suggestionId: "sg-2026-05-12-004",
    decision: "needs_revision",
    reasonTags: [],
    reasonText: "Good idea, pitch it at senior procurement, not generalists.",
    reviewerId: "33333333-3333-3333-3333-333333333333",
    reviewerName: "Aisha Rahman",
    createdAt: "2026-05-12T08:51:00.000Z",
  },
  {
    id: "fb-005",
    suggestionId: "sg-2026-05-11-005",
    decision: "approved",
    reasonTags: [],
    reasonText: null,
    reviewerId: "22222222-2222-2222-2222-222222222222",
    reviewerName: "Daniel Cho",
    createdAt: "2026-05-11T08:33:00.000Z",
  },
  {
    id: "fb-006",
    suggestionId: "sg-2026-05-10-006",
    decision: "rejected",
    reasonTags: ["price_unrealistic"],
    reasonText: "Two reference programs are at $1,800 — can't defend $3,400 here.",
    reviewerId: "11111111-1111-1111-1111-111111111111",
    reviewerName: "Priya Menon",
    createdAt: "2026-05-10T09:01:00.000Z",
  },
  {
    id: "fb-007",
    suggestionId: "sg-2026-05-09-007",
    decision: "rejected",
    reasonTags: ["already_exists"],
    reasonText: "We've offered 'Leading Hybrid Teams' since 2024.",
    reviewerId: "33333333-3333-3333-3333-333333333333",
    reviewerName: "Aisha Rahman",
    createdAt: "2026-05-09T08:22:00.000Z",
  },
  {
    id: "fb-008",
    suggestionId: "sg-2026-05-08-008",
    decision: "approved",
    reasonTags: [],
    reasonText: null,
    reviewerId: "11111111-1111-1111-1111-111111111111",
    reviewerName: "Priya Menon",
    createdAt: "2026-05-08T08:40:00.000Z",
  },
  {
    id: "fb-009",
    suggestionId: "sg-2026-05-07-009",
    decision: "rejected",
    reasonTags: ["topic_outdated"],
    reasonText: "Blockchain training demand has cooled — not a Q3 priority.",
    reviewerId: "22222222-2222-2222-2222-222222222222",
    reviewerName: "Daniel Cho",
    createdAt: "2026-05-07T09:11:00.000Z",
  },
  {
    id: "fb-010",
    suggestionId: "sg-2026-05-06-010",
    decision: "approved",
    reasonTags: [],
    reasonText: null,
    reviewerId: "33333333-3333-3333-3333-333333333333",
    reviewerName: "Aisha Rahman",
    createdAt: "2026-05-06T08:56:00.000Z",
  },
  {
    id: "fb-011",
    suggestionId: "sg-2026-05-05-011",
    decision: "rejected",
    reasonTags: ["weak_references"],
    reasonText: "Two of three references are vendor marketing pages, not training programs.",
    reviewerId: "11111111-1111-1111-1111-111111111111",
    reviewerName: "Priya Menon",
    createdAt: "2026-05-05T08:18:00.000Z",
  },
  {
    id: "fb-012",
    suggestionId: "sg-2026-05-04-012",
    decision: "approved",
    reasonTags: [],
    reasonText: null,
    reviewerId: "22222222-2222-2222-2222-222222222222",
    reviewerName: "Daniel Cho",
    createdAt: "2026-05-04T08:29:00.000Z",
  },
];

/** KPI helpers used by /dashboard. */
export function approvalRate(window: "7d" | "30d", now = new Date()): number {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (window === "7d" ? 7 : 30));
  const inWindow = mockFeedback.filter((f) => new Date(f.createdAt) >= cutoff);
  if (inWindow.length === 0) return 0;
  const approved = inWindow.filter((f) => f.decision === "approved").length;
  return approved / inWindow.length;
}

export function topRejectionTagsThisWeek(): Array<{ tag: string; count: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const counts = new Map<string, number>();
  for (const f of mockFeedback) {
    if (f.decision !== "rejected") continue;
    if (new Date(f.createdAt) < cutoff) continue;
    for (const tag of f.reasonTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

import type { ReviewerProfile } from "@/lib/types";

/**
 * Stand-in reviewer roster used by `/settings` (the team table) and
 * the `/history` reviewer filter dropdown. Phase 4 will replace this
 * with a real query against `auth.users` joined with a per-reviewer
 * profile table.
 *
 * `mockCurrentReviewer` was removed in Phase 3 Step 12 — the active
 * reviewer now comes from the Supabase session via
 * `getCurrentReviewer()` in `@/lib/auth/current-user`.
 */
export const mockReviewers: ReviewerProfile[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Priya Menon",
    email: "priya@edstellar.com",
    role: "admin",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Daniel Cho",
    email: "daniel@edstellar.com",
    role: "reviewer",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Aisha Rahman",
    email: "aisha@edstellar.com",
    role: "reviewer",
  },
];

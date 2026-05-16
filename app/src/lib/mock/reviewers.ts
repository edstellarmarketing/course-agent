import type { ReviewerProfile } from "@/lib/types";

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

/** The reviewer the dashboard is "logged in as" during Phase 1 demos. */
export const mockCurrentReviewer = mockReviewers[0];

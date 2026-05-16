import type { RejectionTag } from "@/lib/types";

/**
 * The 11 rows seeded into `course-agent.rejection_taxonomy` (Phase 3).
 * Phase 1 reads this fixture; Phase 5 swaps it for the live table.
 */
export const mockRejectionTaxonomy: RejectionTag[] = [
  {
    key: "already_exists",
    label: "Already exists",
    description: "Duplicate of a course we already offer.",
  },
  {
    key: "near_duplicate_within_batch",
    label: "Near duplicate in batch",
    description: "Too similar to another suggestion in today's batch.",
  },
  {
    key: "not_instructor_led_market",
    label: "Not instructor-led in market",
    description: "Topic only exists as e-learning / self-paced in the real world.",
  },
  {
    key: "price_unrealistic",
    label: "Price unrealistic",
    description: "Proposed price isn't defensible by the market evidence.",
  },
  {
    key: "topic_outdated",
    label: "Topic outdated",
    description: "Once-popular topic now declining; weak forward demand.",
  },
  {
    key: "too_niche",
    label: "Too niche",
    description: "Audience too small to be a viable B2B program.",
  },
  {
    key: "wrong_category",
    label: "Wrong category",
    description: "Category mapping is incorrect.",
  },
  {
    key: "weak_references",
    label: "Weak references",
    description: "Citations are low-quality, off-topic, or unverifiable.",
  },
  {
    key: "not_corporate_relevant",
    label: "Not corporate-relevant",
    description: "Consumer or hobbyist topic, not enterprise training.",
  },
  {
    key: "certification_name_used",
    label: "Certification name used",
    description: "Title references a specific credential or certifying body.",
    rare: true,
  },
  {
    key: "other",
    label: "Other",
    description: "Requires a free-text explanation below.",
    rare: true,
  },
];

/**
 * TypeScript shapes for the `course-agent` Postgres schema (see
 * docs/edstellar_course_discovery_agent_plan.md §3.1).
 *
 * These match what Supabase will return once Phase 4 swaps mock fixtures for
 * real queries. Vector columns (`embedding`) are server-side only and not
 * exposed here.
 */

export type Uuid = string;
export type IsoTimestamp = string;

/** Lifecycle of a single agent-produced suggestion. */
export type SuggestionStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "needs_revision";

/** Reviewer decision recorded in the `feedback` table. */
export type FeedbackDecision = "approved" | "rejected" | "needs_revision";

/**
 * Edstellar role for the course-agent app. Stored at
 * `auth.users.app_metadata.course_agent_role` (server-set; namespaced
 * because this Supabase is shared with sibling apps).
 */
export type UserRole = "admin" | "reviewer";

/**
 * `rejection_taxonomy` tags — must match the 11 rows seeded in Phase 3.
 * The reject modal renders these as multi-select chips; reviewers must pick
 * at least one before they can submit.
 */
export type RejectionTagKey =
  | "already_exists"
  | "near_duplicate_within_batch"
  | "not_instructor_led_market"
  | "price_unrealistic"
  | "topic_outdated"
  | "too_niche"
  | "wrong_category"
  | "weak_references"
  | "not_corporate_relevant"
  | "certification_name_used"
  | "other";

export interface RejectionTag {
  key: RejectionTagKey;
  label: string;
  description: string;
  /** Tags rarely chosen but kept for completeness; shown below the fold. */
  rare?: boolean;
}

/** `courses` — managed by Edstellar; the agent treats this as read-only. */
export interface Course {
  id: Uuid;
  num: number;
  name: string;
  category: string;
  subcategory: string | null;
  link: string | null;
  lastSeenAt: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** `categories` — curated taxonomy with demand and pinning. */
export interface Category {
  id: Uuid;
  name: string;
  courseCount: number;
  targetCount: number | null;
  demandScore: number | null;
  isPinned: boolean;
  notes: string | null;
}

/** Single research reference cited by a suggestion. */
export interface SuggestionReference {
  name: string;
  url: string;
  accessedAt?: IsoTimestamp;
}

/** One module entry in a suggestion's content_outline. */
export interface ContentOutlineModule {
  module: string;
  topics: string[];
}

/** Edstellar package the agent recommends for a candidate course. */
export type EdstellarPackage = "Starter" | "Growth" | "Enterprise" | "Custom";

export interface PackageFit {
  licensesPerBatchOf10: number;
  licenseMath: string;
  primaryPackage: EdstellarPackage;
  packageRationale: string;
}

/** What tech / accounts / tools the provider must stand up to deliver labs. */
export interface LabRequirements {
  required: boolean;
  platforms: string[];
  tools: string[];
  notes: string;
}

/** `suggestions` — written by the agent, reviewed by humans. */
export interface Suggestion {
  id: Uuid;
  runId: Uuid;
  title: string;
  rationale: string;
  category: string;
  proposedSubcategory: string | null;
  targetAudience: string;
  /** Legacy day count. Null on rows produced by prompt v7+ (which uses hours range). */
  durationDays: number | null;
  /** Phase 9 reviewer-feedback: lower/upper bound of an hours range (e.g. 16-24 Hrs). */
  durationHoursMin?: number | null;
  durationHoursMax?: number | null;
  /** Always "instructor-led" — enforced by a CHECK constraint at the DB. */
  deliveryFormat: "instructor-led";
  /** USD, > 2500 enforced by CHECK. */
  suggestedPriceUsd: number;
  priceBasis: string;
  /** Phase 9 reviewer-feedback: structured curriculum. Null/undefined on legacy rows. */
  contentOutline?: ContentOutlineModule[] | null;
  /** Phase 9 reviewer-feedback: Edstellar package recommendation. Null/undefined on legacy rows. */
  packageFit?: PackageFit | null;
  /** Phase 9 reviewer-feedback: lab requirements. Null/undefined on legacy rows. */
  labRequirements?: LabRequirements | null;
  /** Phase 9 reviewer-feedback: Edstellar-POV business case. Empty on legacy rows. */
  edstellarPitch?: string;
  references: SuggestionReference[];
  status: SuggestionStatus;
  createdAt: IsoTimestamp;
  /** Hydrated client-side for the side-rail diff on /suggestions/today. */
  closestExistingCourse?: ClosestCourseMatch | null;
}

/** Result of the cosine-similarity lookup against `courses.embedding`. */
export interface ClosestCourseMatch {
  course: Course;
  /** 0..1 cosine similarity; > 0.85 would have been rejected by Rule 2. */
  similarity: number;
}

/** `feedback` — one row per reviewer action. */
export interface Feedback {
  id: Uuid;
  suggestionId: Uuid;
  decision: FeedbackDecision;
  reasonTags: RejectionTagKey[];
  reasonText: string | null;
  reviewerId: Uuid;
  reviewerName: string;
  createdAt: IsoTimestamp;
}

/** `agent_runs` — one row per nightly pipeline execution. */
export interface AgentRun {
  id: Uuid;
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp | null;
  modelUsed: string;
  promptVersionId: Uuid;
  categoriesTargeted: string[];
  candidatesProduced: number;
  candidatesPersisted: number;
  /** Approval rate at the time the run completed, 0..1. Null until reviewers act. */
  approvalRate: number | null;
}

/** `prompt_versions` — tracks evolving system prompts and which model each was tested on. */
export interface PromptVersion {
  id: Uuid;
  version: number;
  modelSlug: string;
  systemPrompt: string;
  status: "active" | "candidate" | "retired";
  approvalRate: number | null;
  runsObserved: number;
  createdAt: IsoTimestamp;
  notes: string | null;
}

/** Light-weight reviewer profile, used everywhere a reviewer name appears. */
export interface ReviewerProfile {
  id: Uuid;
  name: string;
  email: string;
  role: UserRole;
}

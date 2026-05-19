import { PageHeader } from "@/components/page-header";
import type { CategoryContext } from "@/components/suggestion-card";
import { SuggestionQueue } from "@/components/suggestion-queue";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type {
  ContentOutlineModule,
  LabRequirements,
  PackageFit,
  RejectionTag,
  RejectionTagKey,
  Suggestion,
  SuggestionReference,
} from "@/lib/types";

export const metadata = {
  title: "Today's Suggestions · Course Agent",
};

// Reviewer actions mutate `suggestions.status` and trigger
// `revalidatePath("/suggestions/today")`; opting out of any cached
// render guarantees the next visit reflects the action immediately.
export const dynamic = "force-dynamic";

interface SuggestionRow {
  id: string;
  run_id: string;
  title: string;
  rationale: string | null;
  category: string;
  proposed_subcategory: string | null;
  target_audience: string | null;
  duration_days: number | null;
  delivery_format: string;
  suggested_price_usd: number;
  price_basis: string | null;
  references: SuggestionReference[];
  status: "pending_review" | "approved" | "rejected" | "needs_revision";
  created_at: string;
  // Phase 9 reviewer-feedback: six new columns (migration 0014).
  // Nullable on legacy rows — the UI handles the absence gracefully.
  duration_hours_min: number | null;
  duration_hours_max: number | null;
  content_outline: ContentOutlineModule[] | null;
  package_fit: PackageFit | null;
  lab_requirements: LabRequirements | null;
  edstellar_pitch: string | null;
}

interface AgentRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  model_used: string;
  categories_targeted: string[];
  candidates_produced: number | null;
  candidates_persisted: number | null;
}

interface RejectionTaxonomyRow {
  key: string;
  label: string;
  description: string;
  rare: boolean | null;
}

function rowToSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    runId: row.run_id,
    title: row.title,
    rationale: row.rationale ?? "",
    category: row.category,
    proposedSubcategory: row.proposed_subcategory,
    targetAudience: row.target_audience ?? "",
    durationDays: row.duration_days,
    durationHoursMin: row.duration_hours_min,
    durationHoursMax: row.duration_hours_max,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: Number(row.suggested_price_usd),
    priceBasis: row.price_basis ?? "",
    contentOutline: row.content_outline,
    packageFit: row.package_fit,
    labRequirements: row.lab_requirements,
    edstellarPitch: row.edstellar_pitch ?? "",
    references: row.references ?? [],
    status: row.status,
    createdAt: row.created_at,
    // `closestExistingCourse` is hydrated by Phase 6's cosine probe.
    closestExistingCourse: null,
  };
}

export default async function SuggestionsTodayPage() {
  const [profile, supabase] = await Promise.all([
    getCurrentReviewer(),
    createSessionClient(),
  ]);
  const isAdmin = profile?.role === "admin";
  const userId = profile?.id ?? null;

  // Phase 8 Step 10: reviewers see only suggestions assigned to
  // them OR unassigned ones. Admins see everything. The RLS policy
  // on suggestions_reviewer_update is the backstop on writes (a
  // reviewer who somehow saw a row not assigned to them can't act
  // on it anyway); filtering here keeps the queue UI honest.
  let queueQuery = supabase
    .from("suggestions")
    .select(
      "id,run_id,title,rationale,category,proposed_subcategory,target_audience,duration_days,duration_hours_min,duration_hours_max,delivery_format,suggested_price_usd,price_basis,references,status,created_at,assignee_id,content_outline,package_fit,lab_requirements,edstellar_pitch",
    )
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(50);
  if (!isAdmin && userId) {
    queueQuery = queueQuery.or(`assignee_id.is.null,assignee_id.eq.${userId}`);
  }

  // Four independent reads — fire them in parallel.
  // 1. The pending queue itself (filtered by assignee for reviewers).
  // 2. The most-recent agent_run for the header banner.
  // 3. The rejection taxonomy for the Reject modal.
  // 4. categories_with_counts → drives the "Category fit" block on
  //    each card (does this category exist? how many courses already?).
  const [queueResult, runResult, taxonomyResult, categoriesResult] =
    await Promise.all([
      queueQuery,
      supabase
        .from("agent_runs")
        .select(
          "id,started_at,finished_at,model_used,categories_targeted,candidates_produced,candidates_persisted",
        )
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("rejection_taxonomy")
        .select("key,label,description,rare")
        .order("sort_order"),
      supabase
        .from("categories_with_counts")
        .select("name,course_count"),
    ]);

  if (queueResult.error) {
    console.error("[suggestions/today] queue query failed:", queueResult.error);
  }
  if (runResult.error) {
    console.error("[suggestions/today] agent_run query failed:", runResult.error);
  }
  if (taxonomyResult.error) {
    console.error(
      "[suggestions/today] rejection_taxonomy query failed:",
      taxonomyResult.error,
    );
  }
  if (categoriesResult.error) {
    console.error(
      "[suggestions/today] categories_with_counts query failed:",
      categoriesResult.error,
    );
  }

  const queue = (queueResult.data ?? []) as SuggestionRow[];
  const pending: Suggestion[] = queue.map(rowToSuggestion);

  // ── Category-fit context ────────────────────────────────────────
  // For every category that appears in the pending queue, look up
  // whether it's in `categories_with_counts` and how many other
  // pending cards share it. The card uses this to render either
  // "filed under existing category (N courses)" or "new category —
  // M others share this, consider creating it".
  const existingCategoryCounts = new Map<string, number>(
    ((categoriesResult.data ?? []) as {
      name: string;
      course_count: number;
    }[]).map((c) => [c.name, c.course_count]),
  );
  const pendingByCategory = new Map<string, number>();
  for (const s of pending) {
    pendingByCategory.set(
      s.category,
      (pendingByCategory.get(s.category) ?? 0) + 1,
    );
  }
  const categoryContext: Record<string, CategoryContext> = {};
  for (const [category, pendingCount] of pendingByCategory) {
    categoryContext[category] = {
      exists: existingCategoryCounts.has(category),
      existingCourseCount: existingCategoryCounts.get(category) ?? 0,
      pendingInCategory: pendingCount,
    };
  }

  const run = (runResult.data ?? null) as AgentRunRow | null;
  const tags: RejectionTag[] = (
    (taxonomyResult.data ?? []) as RejectionTaxonomyRow[]
  ).map((t) => ({
    key: t.key as RejectionTagKey,
    label: t.label,
    description: t.description,
    rare: t.rare ?? false,
  }));

  const runDate = run
    ? new Date(run.started_at).toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Daily review queue"
        title="Today's Suggestions"
        description={
          run
            ? `Agent run ${run.id} — ${runDate}. ${run.candidates_produced ?? 0} candidates produced, ${pending.length} survived all 10 rules.`
            : `No agent run has produced suggestions yet. The Phase 6 engine writes the first real row.`
        }
      />

      <div className="flex-1 px-8 py-8">
        {run && (
          <div className="mb-5 rounded-md border border-navy-soft bg-navy-soft/40 px-4 py-3 text-sm text-navy-deep">
            <span className="font-display font-semibold uppercase tracking-wider text-[10px] text-orange">
              Model
            </span>{" "}
            <span className="font-mono text-xs">{run.model_used}</span>
            <span className="mx-3 text-gray-300">·</span>
            <span className="font-display font-semibold uppercase tracking-wider text-[10px] text-orange">
              Categories targeted
            </span>{" "}
            <span className="text-sm">
              {run.categories_targeted.join(", ")}
            </span>
          </div>
        )}

        <SuggestionQueue
          suggestions={pending}
          tags={tags}
          categoryContext={categoryContext}
        />
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { DecisionPanel } from "@/components/decision-panel";
import { PageHeader } from "@/components/page-header";
import {
  SuggestionCard,
  type CategoryContext,
} from "@/components/suggestion-card";
import { findRelatedCategories } from "@/lib/category-similarity";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type {
  ClosestCourseMatch,
  Course,
  FeedbackDecision,
  RejectionTag,
  RejectionTagKey,
  Suggestion,
  SuggestionReference,
  SuggestionStatus,
} from "@/lib/types";

interface SuggestionDetailPageProps {
  params: Promise<{ id: string }>;
}

// Reviewer actions on this page mutate suggestions.status + insert a
// feedback row, then revalidatePath() fires for this exact path. Stale
// renders would show the buttons after a decision; force-dynamic
// avoids that race.
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
  status: SuggestionStatus;
  created_at: string;
  // Phase 9 reviewer-feedback round (migration 0014).
  duration_hours_min: number | null;
  duration_hours_max: number | null;
  content_outline: import("@/lib/types").ContentOutlineModule[] | null;
  package_fit: import("@/lib/types").PackageFit | null;
  lab_requirements: import("@/lib/types").LabRequirements | null;
  edstellar_pitch: string | null;
}

interface FeedbackRow {
  id: string;
  suggestion_id: string;
  decision: FeedbackDecision;
  reason_tags: string[];
  reason_text: string | null;
  reviewer_id: string;
  created_at: string;
}

interface RejectionTaxonomyRow {
  key: string;
  label: string;
  description: string;
  rare: boolean | null;
}

function rowToSuggestion(
  row: SuggestionRow,
  closest: ClosestCourseMatch[],
): Suggestion {
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
    closestExistingCourses: closest,
  };
}

export default async function SuggestionDetailPage({
  params,
}: SuggestionDetailPageProps) {
  const { id } = await params;
  const supabase = await createSessionClient();

  // Fan out: suggestion, feedback trail, rejection taxonomy (for the
  // modal AND for resolving stored reason_tags to human labels), and
  // the current reviewer's id so the audit trail can say "you" for
  // their own decisions. RLS on auth.users blocks cross-user joins;
  // Phase 8 introduces a proper profiles table.
  const [
    suggestionResult,
    feedbackResult,
    taxonomyResult,
    userResult,
    categoriesResult,
  ] = await Promise.all([
    supabase
      .from("suggestions")
      .select(
        "id,run_id,title,rationale,category,proposed_subcategory,target_audience,duration_days,duration_hours_min,duration_hours_max,delivery_format,suggested_price_usd,price_basis,references,status,created_at,content_outline,package_fit,lab_requirements,edstellar_pitch",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("feedback")
      .select(
        "id,suggestion_id,decision,reason_tags,reason_text,reviewer_id,created_at",
      )
      .eq("suggestion_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("rejection_taxonomy")
      .select("key,label,description,rare")
      .order("sort_order"),
    supabase.auth.getUser(),
    supabase.from("categories_with_counts").select("name,course_count"),
  ]);

  if (suggestionResult.error) {
    console.error(
      "[suggestions/:id] suggestion query failed:",
      suggestionResult.error,
    );
  }
  if (feedbackResult.error) {
    console.error(
      "[suggestions/:id] feedback query failed:",
      feedbackResult.error,
    );
  }

  const suggestionRow = suggestionResult.data as SuggestionRow | null;
  if (!suggestionRow) notFound();

  // Top-N closest existing courses via pgvector cosine (RPC declared
  // in migration 0016). Empty if the suggestion's embedding is NULL
  // or every course in the catalogue lacks one — card then falls back
  // to "No close match in the catalogue".
  const closest: ClosestCourseMatch[] = [];
  const { data: closestData, error: closestErr } = await supabase.rpc(
    "closest_courses_for_suggestions",
    { suggestion_ids: [suggestionRow.id], match_limit: 3 },
  );
  if (closestErr) {
    console.error(
      "[suggestions/:id] closest_courses_for_suggestions failed:",
      closestErr,
    );
  }
  for (const r of (closestData ?? []) as {
    course_id: string;
    course_num: number | null;
    course_name: string;
    course_category: string;
    course_subcategory: string | null;
    course_link: string | null;
    similarity: number;
  }[]) {
    const course: Course = {
      id: r.course_id,
      num: r.course_num ?? 0,
      name: r.course_name,
      category: r.course_category,
      subcategory: r.course_subcategory,
      link: r.course_link,
      lastSeenAt: "",
      createdAt: "",
      updatedAt: "",
    };
    closest.push({ course, similarity: r.similarity });
  }

  const suggestion = rowToSuggestion(suggestionRow, closest);
  const trail = (feedbackResult.data ?? []) as FeedbackRow[];
  const taxonomy = (taxonomyResult.data ?? []) as RejectionTaxonomyRow[];
  const tagLabelByKey = new Map(taxonomy.map((t) => [t.key, t.label]));
  const tags: RejectionTag[] = taxonomy.map((t) => ({
    key: t.key as RejectionTagKey,
    label: t.label,
    description: t.description,
    rare: t.rare ?? false,
  }));
  const currentUserId = userResult.data.user?.id ?? null;

  // ── Category-fit context ────────────────────────────────────────
  // Look up this suggestion's category in the curated table + count
  // OTHER pending suggestions sharing it. The same `CategoryFit`
  // block the queue uses then renders here.
  const categoriesRows = (categoriesResult.data ?? []) as {
    name: string;
    course_count: number;
  }[];
  const categoryRow = categoriesRows.find(
    (c) => c.name === suggestion.category,
  );
  const { count: pendingInCategory } = await supabase
    .from("suggestions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review")
    .eq("category", suggestion.category);
  const categoryContext: CategoryContext = {
    exists: !!categoryRow,
    existingCourseCount: categoryRow?.course_count ?? 0,
    pendingInCategory: pendingInCategory ?? 0,
    relatedCategories: findRelatedCategories(
      suggestion.category,
      categoriesRows.map((c) => ({
        name: c.name,
        courseCount: c.course_count,
      })),
      { limit: 3 },
    ),
  };

  const isPending = suggestion.status === "pending_review";

  return (
    <>
      <PageHeader
        eyebrow="Suggestion detail"
        title={suggestion.title}
        description={`${suggestion.category} · candidate ${suggestion.id}`}
        actions={
          <Link
            href="/suggestions/today"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Back to queue
          </Link>
        }
      />

      <div className="flex-1 space-y-6 px-8 py-8">
        <SuggestionCard
          suggestion={suggestion}
          categoryContext={categoryContext}
        />

        {isPending ? (
          <DecisionPanel suggestion={suggestion} tags={tags} />
        ) : (
          <div className="rounded-md border border-gray-100 bg-white p-5 text-sm text-gray-600">
            Status: <StatusPill status={suggestion.status} />
            <span className="ml-2">This candidate has already been actioned.</span>
          </div>
        )}

        <section className="rounded-lg border border-gray-100 bg-white">
          <header className="border-b border-gray-100 px-6 py-4">
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
              Audit trail
            </div>
            <h2 className="font-display text-lg font-semibold text-navy-deep">
              {trail.length === 0
                ? "No feedback yet"
                : `${trail.length} entr${trail.length === 1 ? "y" : "ies"}`}
            </h2>
          </header>
          {trail.length === 0 ? (
            <p className="px-6 py-6 text-sm text-gray-500">
              This candidate hasn&apos;t been actioned. The first feedback row
              will appear here as soon as a reviewer decides.
            </p>
          ) : (
            <ol className="divide-y divide-gray-100">
              {trail.map((f) => (
                <li key={f.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={f.decision} />
                      <span className="text-sm font-medium text-gray-800">
                        {reviewerLabel(f.reviewer_id, currentUserId)}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-gray-500">
                      {new Date(f.created_at).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  {f.reason_tags.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {f.reason_tags.map((tag) => {
                        const label = tagLabelByKey.get(tag) ?? tag;
                        return (
                          <li
                            key={tag}
                            className="rounded-full bg-red-soft px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-red-700"
                          >
                            {label}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {f.reason_text && (
                    <p className="mt-2 text-sm text-gray-600">{f.reason_text}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * Phase 5 doesn't have a profiles table, and RLS on `auth.users`
 * blocks cross-user joins from the session client. So we show "you"
 * for the current reviewer's rows and a truncated UUID for others.
 * Phase 8 swaps this for a proper profile join.
 */
function reviewerLabel(
  reviewerId: string,
  currentUserId: string | null,
): string {
  if (currentUserId && reviewerId === currentUserId) return "You";
  return `Reviewer ${reviewerId.slice(0, 8)}`;
}

function StatusPill({
  status,
}: {
  status: "pending_review" | "approved" | "rejected" | "needs_revision";
}) {
  const map = {
    pending_review: "bg-gray-100 text-gray-700",
    approved: "bg-green-soft text-green-700",
    rejected: "bg-red-soft text-red-700",
    needs_revision: "bg-amber-soft text-amber-700",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

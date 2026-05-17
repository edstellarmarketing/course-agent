import { PageHeader } from "@/components/page-header";
import { SuggestionQueue } from "@/components/suggestion-queue";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type {
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
    durationDays: row.duration_days ?? 0,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: Number(row.suggested_price_usd),
    priceBasis: row.price_basis ?? "",
    references: row.references ?? [],
    status: row.status,
    createdAt: row.created_at,
    // `closestExistingCourse` is hydrated by Phase 6's cosine probe.
    closestExistingCourse: null,
  };
}

export default async function SuggestionsTodayPage() {
  const supabase = await createSessionClient();

  // Three independent reads — fire them in parallel.
  // 1. The pending queue itself.
  // 2. The most-recent agent_run for the header banner (model used,
  //    categories targeted). Seed migration 0006 inserts one row; the
  //    real engine in Phase 6 will start producing more.
  // 3. The rejection taxonomy for the Reject modal.
  const [queueResult, runResult, taxonomyResult] = await Promise.all([
    supabase
      .from("suggestions")
      .select(
        "id,run_id,title,rationale,category,proposed_subcategory,target_audience,duration_days,delivery_format,suggested_price_usd,price_basis,references,status,created_at",
      )
      .eq("status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(50),
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

  const queue = (queueResult.data ?? []) as SuggestionRow[];
  const pending: Suggestion[] = queue.map(rowToSuggestion);

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

        <SuggestionQueue suggestions={pending} tags={tags} />
      </div>
    </>
  );
}

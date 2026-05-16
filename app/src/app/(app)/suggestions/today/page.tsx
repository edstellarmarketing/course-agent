import { PageHeader } from "@/components/page-header";
import { SuggestionQueue } from "@/components/suggestion-queue";
import { mockRejectionTaxonomy } from "@/lib/mock/rejection-taxonomy";
import {
  mockTodaysRun,
  mockTodaysSuggestions,
} from "@/lib/mock/suggestions";

export const metadata = {
  title: "Today's Suggestions · Course Agent",
};

export default function SuggestionsTodayPage() {
  const pending = mockTodaysSuggestions.filter(
    (s) => s.status === "pending_review",
  );

  const runDate = new Date(mockTodaysRun.startedAt).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <PageHeader
        eyebrow="Daily review queue"
        title="Today's Suggestions"
        description={`Agent run ${mockTodaysRun.id} — ${runDate}. ${mockTodaysRun.candidatesProduced} candidates produced, ${pending.length} survived all 10 rules.`}
      />

      <div className="flex-1 px-8 py-8">
        <div className="mb-5 rounded-md border border-navy-soft bg-navy-soft/40 px-4 py-3 text-sm text-navy-deep">
          <span className="font-display font-semibold uppercase tracking-wider text-[10px] text-orange">
            Model
          </span>{" "}
          <span className="font-mono text-xs">{mockTodaysRun.modelUsed}</span>
          <span className="mx-3 text-gray-300">·</span>
          <span className="font-display font-semibold uppercase tracking-wider text-[10px] text-orange">
            Categories targeted
          </span>{" "}
          <span className="text-sm">
            {mockTodaysRun.categoriesTargeted.join(", ")}
          </span>
        </div>

        <SuggestionQueue suggestions={pending} tags={mockRejectionTaxonomy} />
      </div>
    </>
  );
}

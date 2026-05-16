"use client";

import { useState } from "react";

import { RejectModal } from "@/components/reject-modal";
import { SuggestionCard } from "@/components/suggestion-card";
import type {
  RejectionTag,
  Suggestion,
} from "@/lib/types";

interface SuggestionQueueProps {
  suggestions: Suggestion[];
  tags: RejectionTag[];
}

export function SuggestionQueue({ suggestions, tags }: SuggestionQueueProps) {
  const [rejecting, setRejecting] = useState<Suggestion | null>(null);
  /** Suggestions the reviewer has acted on in-session — purely visual until Phase 5. */
  const [acted, setActed] = useState<
    Record<string, "approved" | "rejected" | "needs_revision">
  >({});

  const stageDecision = (
    id: string,
    decision: "approved" | "rejected" | "needs_revision",
  ) => {
    setActed((prev) => ({ ...prev, [id]: decision }));
  };

  const visible = suggestions.filter((s) => !(s.id in acted));

  return (
    <>
      {visible.length === 0 ? (
        <EmptyState totalActed={Object.keys(acted).length} />
      ) : (
        <ul className="space-y-5">
          {visible.map((s) => (
            <li key={s.id}>
              <SuggestionCard
                suggestion={s}
                actions={
                  <CardActions
                    onApprove={() => stageDecision(s.id, "approved")}
                    onReject={() => setRejecting(s)}
                    onNeedsRevision={() => stageDecision(s.id, "needs_revision")}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}

      <RejectModal
        open={rejecting != null}
        onClose={() => setRejecting(null)}
        suggestionTitle={rejecting?.title ?? ""}
        tags={tags}
        onSubmit={(payload) => {
          if (!rejecting) return;
          stageDecision(rejecting.id, "rejected");
          // Phase 5 will pass this to a Server Action that writes to `feedback`.
          console.info("would reject", rejecting.id, payload);
        }}
      />
    </>
  );
}

function CardActions({
  onApprove,
  onReject,
  onNeedsRevision,
}: {
  onApprove: () => void;
  onReject: () => void;
  onNeedsRevision: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onApprove}
        className="rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={onNeedsRevision}
        className="rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-800 transition-colors hover:border-amber-500 hover:bg-amber-100"
      >
        Needs revision
      </button>
      <button
        type="button"
        onClick={onReject}
        className="rounded-md border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-500 hover:bg-red-soft"
      >
        Reject
      </button>
    </>
  );
}

function EmptyState({ totalActed }: { totalActed: number }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
      <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
        Queue cleared
      </div>
      <h2 className="mt-2 font-display text-xl font-semibold text-navy-deep">
        {totalActed > 0
          ? `${totalActed} decision${totalActed === 1 ? "" : "s"} staged.`
          : "Nothing to review today."}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        Phase 5 wires these decisions into the <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">feedback</code> table.
        Refresh the page to bring the queue back.
      </p>
    </div>
  );
}

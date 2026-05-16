"use client";

import { useState } from "react";

import { RejectModal } from "@/components/reject-modal";
import type {
  FeedbackDecision,
  RejectionTag,
  RejectionTagKey,
  Suggestion,
} from "@/lib/types";

interface DecisionPanelProps {
  suggestion: Suggestion;
  tags: RejectionTag[];
}

/**
 * The three-button decision strip shown on /suggestions/[id]. Same wiring as
 * the queue version, but standalone so it can sit next to the audit trail.
 */
export function DecisionPanel({ suggestion, tags }: DecisionPanelProps) {
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<FeedbackDecision | null>(null);

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
        Your decision
      </div>
      <h3 className="mt-1 font-display text-lg font-semibold text-navy-deep">
        How should the catalogue respond?
      </h3>

      {staged ? (
        <StagedBanner decision={staged} onUndo={() => setStaged(null)} />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStaged("approved")}
            className="rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setStaged("needs_revision")}
            className="rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-800 transition-colors hover:border-amber-500 hover:bg-amber-100"
          >
            Needs revision
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-500 hover:bg-red-soft"
          >
            Reject…
          </button>
        </div>
      )}

      <p className="mt-3 text-[11px] text-gray-500">
        Phase 5 wires this into a Server Action that writes to the{" "}
        <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">feedback</code>{" "}
        table.
      </p>

      <RejectModal
        open={open}
        onClose={() => setOpen(false)}
        suggestionTitle={suggestion.title}
        tags={tags}
        onSubmit={(payload: { tags: RejectionTagKey[]; reasonText: string }) => {
          setStaged("rejected");
          console.info("would reject", suggestion.id, payload);
        }}
      />
    </div>
  );
}

function StagedBanner({
  decision,
  onUndo,
}: {
  decision: FeedbackDecision;
  onUndo: () => void;
}) {
  const map = {
    approved: { label: "Approved", tone: "bg-green-soft text-green-700" },
    rejected: { label: "Rejected", tone: "bg-red-soft text-red-700" },
    needs_revision: { label: "Marked for revision", tone: "bg-amber-soft text-amber-700" },
  } as const;
  return (
    <div className={`mt-4 flex items-center justify-between rounded-md px-3 py-2 text-sm ${map[decision].tone}`}>
      <span className="font-medium">{map[decision].label} (staged)</span>
      <button
        type="button"
        onClick={onUndo}
        className="font-display text-[11px] font-semibold uppercase tracking-widest text-current hover:underline"
      >
        Undo
      </button>
    </div>
  );
}

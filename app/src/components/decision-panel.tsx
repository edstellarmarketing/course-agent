"use client";

import { useState, useTransition } from "react";

import { NeedsRevisionModal } from "@/components/needs-revision-modal";
import { RejectModal } from "@/components/reject-modal";
import {
  approveSuggestion,
  rejectSuggestion,
  requestRevision,
} from "@/app/(app)/suggestions/actions";
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
 * The three-button decision strip shown on /suggestions/[id]. Same
 * Server-Action wiring as the queue version, but rendered standalone
 * so it can sit next to the audit trail.
 *
 * After a successful action revalidatePath() fires from the server and
 * Next re-renders this page; the parent then takes over showing the
 * "already actioned" banner. Until that happens we keep the staged
 * decision in local state for an instant visual confirmation.
 */
export function DecisionPanel({ suggestion, tags }: DecisionPanelProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [staged, setStaged] = useState<FeedbackDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleApprove = () => {
    setError(null);
    startTransition(async () => {
      const result = await approveSuggestion(suggestion.id);
      if (result.ok) {
        setStaged("approved");
      } else {
        setError(result.error);
      }
    });
  };

  const handleReject = (payload: {
    tags: RejectionTagKey[];
    reasonText: string;
  }) => {
    setError(null);
    startTransition(async () => {
      const result = await rejectSuggestion(
        suggestion.id,
        payload.tags,
        payload.reasonText.length > 0 ? payload.reasonText : null,
      );
      if (result.ok) {
        setStaged("rejected");
      } else {
        setError(result.error);
      }
    });
  };

  const handleNeedsRevision = (note: string) => {
    setError(null);
    startTransition(async () => {
      const result = await requestRevision(suggestion.id, note);
      if (result.ok) {
        setStaged("needs_revision");
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
        Your decision
      </div>
      <h3 className="mt-1 font-display text-lg font-semibold text-navy-deep">
        How should the catalogue respond?
      </h3>

      {staged ? (
        <StagedBanner decision={staged} />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={handleApprove}
            className="rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRevisionOpen(true)}
            className="rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-800 transition-colors hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Needs revision
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejectOpen(true)}
            className="rounded-md border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-500 hover:bg-red-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reject…
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      <p className="mt-3 text-[11px] text-gray-500">
        Your action writes one row to the{" "}
        <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">
          feedback
        </code>{" "}
        table and flips this candidate&rsquo;s status. Refreshing this page
        replaces the buttons with the audit-trail row below.
      </p>

      <RejectModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        suggestionTitle={suggestion.title}
        tags={tags}
        onSubmit={handleReject}
      />

      <NeedsRevisionModal
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        suggestionTitle={suggestion.title}
        onSubmit={handleNeedsRevision}
      />
    </div>
  );
}

function StagedBanner({ decision }: { decision: FeedbackDecision }) {
  const map = {
    approved: { label: "Approved · saved", tone: "bg-green-soft text-green-700" },
    rejected: { label: "Rejected · saved", tone: "bg-red-soft text-red-700" },
    needs_revision: {
      label: "Sent back for revision · saved",
      tone: "bg-amber-soft text-amber-700",
    },
  } as const;
  return (
    <div
      className={`mt-4 rounded-md px-3 py-2 text-sm font-medium ${map[decision].tone}`}
    >
      {map[decision].label}
    </div>
  );
}

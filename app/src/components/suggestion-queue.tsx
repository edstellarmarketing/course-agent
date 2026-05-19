"use client";

import { useState, useTransition } from "react";

import { NeedsRevisionModal } from "@/components/needs-revision-modal";
import { RejectModal } from "@/components/reject-modal";
import { SendEmailModal } from "@/components/send-email-modal";
import { SuggestionCard } from "@/components/suggestion-card";
import {
  approveSuggestion,
  emailSuggestion,
  rejectSuggestion,
  requestRevision,
} from "@/app/(app)/suggestions/actions";
import type {
  FeedbackDecision,
  RejectionTag,
  Suggestion,
} from "@/lib/types";

interface SuggestionQueueProps {
  suggestions: Suggestion[];
  tags: RejectionTag[];
}

/**
 * Optimistic-but-safe: we hide a card from the visible list as soon as
 * the Server Action returns `{ok: true}`. We do NOT hide it before the
 * round-trip — that would mean approving a card the queue would then
 * un-approve on a race error, which the doc explicitly calls out as a
 * trap. Click → action → revalidate is the safe MVP.
 */
export function SuggestionQueue({ suggestions, tags }: SuggestionQueueProps) {
  const [rejecting, setRejecting] = useState<Suggestion | null>(null);
  const [reviewing, setReviewing] = useState<Suggestion | null>(null);
  /** Card being emailed — opens the SendEmailModal when non-null. */
  const [emailing, setEmailing] = useState<Suggestion | null>(null);
  /** Toast shown after a successful send. Cleared by the next user action. */
  const [emailToast, setEmailToast] = useState<string | null>(null);
  /** Inline modal error (relay 500, bad email, etc.). */
  const [emailError, setEmailError] = useState<string | null>(null);
  /** Suggestions the reviewer just acted on this session — hidden until revalidate replaces the list. */
  const [acted, setActed] = useState<Record<string, FeedbackDecision>>({});
  /** Banner shown above the queue if the most recent action failed (race, RLS, network). */
  const [error, setError] = useState<string | null>(null);
  /** Disables decision buttons while ANY decision is in flight. */
  const [pending, startTransition] = useTransition();
  /** Email send happens in its own transition so a slow GAS round-trip
   *  doesn't lock the Approve/Reject buttons on other cards. */
  const [emailPending, startEmailTransition] = useTransition();

  const stageDecision = (id: string, decision: FeedbackDecision) => {
    setActed((prev) => ({ ...prev, [id]: decision }));
  };

  const handleApprove = (s: Suggestion) => {
    setError(null);
    startTransition(async () => {
      const result = await approveSuggestion(s.id);
      if (result.ok) {
        stageDecision(s.id, "approved");
      } else {
        setError(result.error);
      }
    });
  };

  const handleReject = (
    s: Suggestion,
    payload: { tags: RejectionTag["key"][]; reasonText: string },
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await rejectSuggestion(
        s.id,
        payload.tags,
        payload.reasonText.length > 0 ? payload.reasonText : null,
      );
      if (result.ok) {
        stageDecision(s.id, "rejected");
      } else {
        setError(result.error);
      }
    });
  };

  const handleNeedsRevision = (s: Suggestion, note: string) => {
    setError(null);
    startTransition(async () => {
      const result = await requestRevision(s.id, note);
      if (result.ok) {
        stageDecision(s.id, "needs_revision");
      } else {
        setError(result.error);
      }
    });
  };

  const handleEmailSuggestion = (
    s: Suggestion,
    payload: { to: string[]; note: string },
  ) => {
    setEmailError(null);
    setEmailToast(null);
    startEmailTransition(async () => {
      const result = await emailSuggestion({
        suggestionId: s.id,
        to: payload.to,
        note: payload.note,
      });
      if (result.ok) {
        setEmailing(null);
        const sentList = result.sentTo.join(", ");
        const failedNote =
          result.failed.length > 0
            ? ` (${result.failed.length} failed: ${result.failed
                .map((f) => `${f.to}: ${f.error}`)
                .join("; ")})`
            : "";
        setEmailToast(
          `Sent to ${result.sentTo.length} recipient${
            result.sentTo.length === 1 ? "" : "s"
          }: ${sentList}.${failedNote}`,
        );
      } else {
        setEmailError(result.error);
      }
    });
  };

  const visible = suggestions.filter((s) => !(s.id in acted));

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-soft px-4 py-3 text-sm text-red-700"
        >
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-red-700">
            Couldn&rsquo;t save decision
          </span>
          <div className="mt-1">{error}</div>
        </div>
      )}

      {emailToast && (
        <div
          role="status"
          className="mb-4 flex items-start justify-between gap-3 rounded-md border border-green-200 bg-green-soft px-4 py-3 text-sm text-green-800"
        >
          <div>
            <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-green-700">
              Email sent
            </span>
            <div className="mt-1">{emailToast}</div>
          </div>
          <button
            type="button"
            onClick={() => setEmailToast(null)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-green-700 hover:bg-green-soft/60"
          >
            ✕
          </button>
        </div>
      )}

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
                    disabled={pending}
                    onApprove={() => handleApprove(s)}
                    onReject={() => setRejecting(s)}
                    onNeedsRevision={() => setReviewing(s)}
                    onSendEmail={() => {
                      setEmailError(null);
                      setEmailToast(null);
                      setEmailing(s);
                    }}
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
          handleReject(rejecting, payload);
        }}
      />

      <NeedsRevisionModal
        open={reviewing != null}
        onClose={() => setReviewing(null)}
        suggestionTitle={reviewing?.title ?? ""}
        onSubmit={(note) => {
          if (!reviewing) return;
          handleNeedsRevision(reviewing, note);
        }}
      />

      <SendEmailModal
        open={emailing != null}
        onClose={() => {
          setEmailing(null);
          setEmailError(null);
        }}
        suggestionTitle={emailing?.title ?? ""}
        pending={emailPending}
        error={emailError}
        onSubmit={(payload) => {
          if (!emailing) return;
          handleEmailSuggestion(emailing, payload);
        }}
      />
    </>
  );
}

function CardActions({
  disabled,
  onApprove,
  onReject,
  onNeedsRevision,
  onSendEmail,
}: {
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onNeedsRevision: () => void;
  onSendEmail: () => void;
}) {
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={onApprove}
        className="rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onNeedsRevision}
        className="rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-800 transition-colors hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Needs revision
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onReject}
        className="rounded-md border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-500 hover:bg-red-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reject
      </button>
      <button
        type="button"
        onClick={onSendEmail}
        className="rounded-md border border-navy-soft bg-white px-3.5 py-2 text-sm font-medium text-navy-deep transition-colors hover:border-navy hover:bg-navy-soft/40"
      >
        Send by email
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
          ? `${totalActed} decision${totalActed === 1 ? "" : "s"} recorded.`
          : "Nothing to review today."}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        Refresh the page to bring in the next batch, or visit{" "}
        <a
          href="/history"
          className="font-medium text-navy hover:text-navy-deep"
        >
          /history
        </a>{" "}
        to see what just shipped.
      </p>
    </div>
  );
}

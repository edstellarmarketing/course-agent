"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface SendEmailModalProps {
  open: boolean;
  onClose: () => void;
  /** Suggestion title shown in the modal header. */
  suggestionTitle: string;
  /** Disables submit while the action is in flight. */
  pending?: boolean;
  /** External error from the action; clears when the user edits the form. */
  error?: string | null;
  onSubmit: (payload: { to: string; note: string }) => void;
}

/** Loose RFC-5322-ish; matches the server-side check in actions.ts. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Recipient prompt for sharing a single suggestion by email.
 *
 * No structured fields — the operator types one email + an optional
 * personal note. The server action renders the suggestion body and
 * POSTs to the existing GAS relay (same one the daily digest uses).
 *
 * The note is optional: a quick share can be just the suggestion.
 */
export function SendEmailModal({
  open,
  onClose,
  suggestionTitle,
  pending,
  error: externalError,
  onSubmit,
}: SendEmailModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const errorId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const resetState = () => {
    setTo("");
    setNote("");
    setSubmitAttempted(false);
  };

  const handleClose = () => {
    if (pending) return;
    resetState();
    onClose();
  };

  const trimmedEmail = to.trim();
  const isValid = EMAIL_RE.test(trimmedEmail);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid || pending) return;
    onSubmit({ to: trimmedEmail.toLowerCase(), note });
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className="w-full max-w-lg rounded-lg border border-gray-100 bg-white p-0 shadow-lg backdrop:bg-navy-deep/40 backdrop:backdrop-blur-sm"
      aria-labelledby="send-email-title"
    >
      <form onSubmit={handleSubmit}>
        <header className="border-b border-gray-100 px-6 py-5">
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            Share by email
          </div>
          <h2
            id="send-email-title"
            className="mt-1 font-display text-lg font-semibold text-navy-deep"
          >
            {suggestionTitle}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Sends the full suggestion (title, pitch, outline, references) to one
            address via the same email relay as the daily digest.
          </p>
        </header>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label
              htmlFor="email-to"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Send to <span className="text-red-600">*</span>
            </label>
            <input
              id="email-to"
              type="email"
              required
              autoFocus
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="colleague@edstellar.com"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
              aria-describedby={
                submitAttempted && !isValid ? errorId : undefined
              }
            />
          </div>

          <div>
            <label
              htmlFor="email-note"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Personal note <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="email-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. ‘Thought you'd want a look before our pricing review.’"
              rows={3}
              className="mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Shown at the top of the email above the suggestion details.
            </p>
          </div>
        </div>

        {submitAttempted && !isValid && (
          <div
            id={errorId}
            role="alert"
            className="mx-6 -mt-1 mb-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-xs text-red-700"
          >
            Enter a valid email address (e.g. name@example.com).
          </div>
        )}

        {externalError && (
          <div
            role="alert"
            className="mx-6 -mt-1 mb-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-xs text-red-700"
          >
            {externalError}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-gray-100 bg-off-white px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={pending}
            className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || pending}
            className={cn(
              "rounded-md px-3.5 py-2 text-sm font-medium text-white transition-colors",
              isValid && !pending
                ? "bg-navy hover:bg-navy-deep"
                : "cursor-not-allowed bg-navy/30",
            )}
          >
            {pending ? "Sending…" : "Send email"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

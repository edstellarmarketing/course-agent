"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface NeedsRevisionModalProps {
  open: boolean;
  onClose: () => void;
  /** Suggestion being marked for revision — used in the modal header. */
  suggestionTitle: string;
  onSubmit: (note: string) => void;
}

/**
 * Minimal note-prompt modal for the "Needs revision" path. Smaller
 * than the RejectModal because there are no structured tags — only a
 * free-text note that becomes the feedback row's `reason_text`.
 *
 * The note is required: an empty needs-revision is indistinguishable
 * from "I clicked the wrong button" and gives the agent no signal to
 * learn from on the next run.
 */
export function NeedsRevisionModal({
  open,
  onClose,
  suggestionTitle,
  onSubmit,
}: NeedsRevisionModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
    setNote("");
    setSubmitAttempted(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const trimmed = note.trim();
  const isValid = trimmed.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid) return;
    onSubmit(trimmed);
    handleClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className="w-full max-w-lg rounded-lg border border-gray-100 bg-white p-0 shadow-lg backdrop:bg-navy-deep/40 backdrop:backdrop-blur-sm"
      aria-labelledby="needs-revision-title"
    >
      <form onSubmit={handleSubmit}>
        <header className="border-b border-gray-100 px-6 py-5">
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            Send back for revision
          </div>
          <h2
            id="needs-revision-title"
            className="mt-1 font-display text-lg font-semibold text-navy-deep"
          >
            {suggestionTitle}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Leave a short note so the agent knows what to change on its
            next pass.
          </p>
        </header>

        <div className="px-6 py-5">
          <label
            htmlFor="revision-note"
            className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
          >
            Note <span className="text-red-600">(required)</span>
          </label>
          <textarea
            id="revision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. ‘Pitch this at senior procurement, not generalists.’"
            rows={4}
            autoFocus
            className="mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            aria-describedby={submitAttempted && !isValid ? errorId : undefined}
          />
        </div>

        {submitAttempted && !isValid && (
          <div
            id={errorId}
            role="alert"
            className="mx-6 -mt-1 mb-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-xs text-red-700"
          >
            Add a short note — empty revision requests give the agent no
            signal to learn from.
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-gray-100 bg-off-white px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={cn(
              "rounded-md px-3.5 py-2 text-sm font-medium text-white transition-colors",
              isValid
                ? "bg-amber-600 hover:bg-amber-700"
                : "cursor-not-allowed bg-amber-300",
            )}
          >
            Send back
          </button>
        </footer>
      </form>
    </dialog>
  );
}

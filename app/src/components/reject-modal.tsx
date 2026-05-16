"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { RejectionTag, RejectionTagKey } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RejectModalProps {
  open: boolean;
  onClose: () => void;
  /** Suggestion being rejected — used in the modal header. */
  suggestionTitle: string;
  /**
   * Rejection tag list. Sourced from `rejection_taxonomy` in Phase 5; passed
   * as a prop so the modal stays decoupled from the data source.
   */
  tags: RejectionTag[];
  onSubmit: (payload: {
    tags: RejectionTagKey[];
    reasonText: string;
  }) => void;
}

export function RejectModal({
  open,
  onClose,
  suggestionTitle,
  tags,
  onSubmit,
}: RejectModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Set<RejectionTagKey>>(new Set());
  const [reasonText, setReasonText] = useState("");
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
    setSelected(new Set());
    setReasonText("");
    setSubmitAttempted(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const isOtherWithoutText =
    selected.has("other") && reasonText.trim().length === 0;
  const isValid = selected.size > 0 && !isOtherWithoutText;

  const toggleTag = (key: RejectionTagKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid) return;
    onSubmit({ tags: [...selected], reasonText: reasonText.trim() });
    handleClose();
  };

  const primary = tags.filter((t) => !t.rare);
  const rare = tags.filter((t) => t.rare);

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className="w-full max-w-xl rounded-lg border border-gray-100 bg-white p-0 shadow-lg backdrop:bg-navy-deep/40 backdrop:backdrop-blur-sm"
      aria-labelledby="reject-modal-title"
    >
      <form onSubmit={handleSubmit}>
        <header className="border-b border-gray-100 px-6 py-5">
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            Reject with structured reason
          </div>
          <h2
            id="reject-modal-title"
            className="mt-1 font-display text-lg font-semibold text-navy-deep"
          >
            {suggestionTitle}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Pick at least one tag. These feed the agent&apos;s negative memory
            for the next 90 days.
          </p>
        </header>

        <fieldset className="px-6 py-5">
          <legend className="mb-2 font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Why is this candidate wrong?
          </legend>
          <ul className="flex flex-wrap gap-2">
            {primary.map((tag) => (
              <li key={tag.key}>
                <TagChip
                  tag={tag}
                  selected={selected.has(tag.key)}
                  onToggle={() => toggleTag(tag.key)}
                />
              </li>
            ))}
          </ul>
          {rare.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {rare.map((tag) => (
                <li key={tag.key}>
                  <TagChip
                    tag={tag}
                    selected={selected.has(tag.key)}
                    onToggle={() => toggleTag(tag.key)}
                  />
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <div className="border-t border-gray-100 px-6 py-5">
          <label
            htmlFor="reason-text"
            className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
          >
            Additional note {selected.has("other") && <span className="text-red-600">(required)</span>}
          </label>
          <textarea
            id="reason-text"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="Optional context the agent should learn from — e.g. ‘good idea, pitch it at senior buyers, not generalists’."
            rows={3}
            className="mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          />
        </div>

        {submitAttempted && !isValid && (
          <div
            id={errorId}
            role="alert"
            className="mx-6 -mt-1 mb-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-xs text-red-700"
          >
            {selected.size === 0
              ? "Pick at least one tag — free text alone produces a signal the agent can't learn from."
              : "‘Other’ requires a free-text explanation."}
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-gray-100 bg-off-white px-6 py-4">
          <div className="text-xs text-gray-500">
            {selected.size} tag{selected.size === 1 ? "" : "s"} selected
          </div>
          <div className="flex items-center gap-2">
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
                  ? "bg-red-600 hover:bg-red-700"
                  : "cursor-not-allowed bg-red-300",
              )}
              aria-describedby={submitAttempted && !isValid ? errorId : undefined}
            >
              Reject candidate
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function TagChip({
  tag,
  selected,
  onToggle,
}: {
  tag: RejectionTag;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      title={tag.description}
      className={cn(
        "rounded-full border px-3 py-1 font-display text-[11px] font-medium transition-colors",
        selected
          ? "border-navy bg-navy text-white"
          : "border-gray-200 bg-white text-gray-700 hover:border-navy hover:text-navy-deep",
      )}
    >
      {tag.label}
    </button>
  );
}

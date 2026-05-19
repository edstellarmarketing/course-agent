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
  onSubmit: (payload: { to: string[]; note: string }) => void;
}

/** Loose RFC-5322-ish; matches the server-side check in actions.ts. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fixed quick-pick recipients. Edit this list to add/remove people;
 * the action also accepts ad-hoc addresses via the "Other" field.
 */
const PRESET_RECIPIENTS = [
  "vijay@edstellar.com",
  "venkat.r@edstellar.com",
  "surya.l@edstellar.com",
];

/**
 * Pre-filled checklist for the recipient. Editable — clear or rewrite
 * the textarea as needed. Kept here (not on the server) so admins can
 * tweak it later by editing one constant.
 */
const DEFAULT_NOTE =
  "Research this course name in google, check for existing course conflicts and see if we can create any new category for this course and also check the tools mentioned in the labs can be created as courses or not through google search";

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
  // Preset checkboxes — every preset starts UNchecked so each share is
  // an intentional click, not an accidental blast. Toggle by clicking.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Optional "also send to…" field. Free-form, comma- or space-separated.
  const [otherRaw, setOtherRaw] = useState("");
  const [note, setNote] = useState(DEFAULT_NOTE);
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
    setOtherRaw("");
    setNote(DEFAULT_NOTE);
    setSubmitAttempted(false);
  };

  const handleClose = () => {
    if (pending) return;
    resetState();
    onClose();
  };

  // Parse "Other" — split on comma OR whitespace, drop empties.
  const otherList = otherRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Deduped, ordered: presets first, then other addresses.
  const allRecipients: string[] = [];
  const seen = new Set<string>();
  for (const e of selected) {
    if (!seen.has(e)) {
      seen.add(e);
      allRecipients.push(e);
    }
  }
  for (const e of otherList) {
    const low = e.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      allRecipients.push(low);
    }
  }

  const otherInvalid = otherList.filter((e) => !EMAIL_RE.test(e));
  const isValid =
    allRecipients.length > 0 && otherInvalid.length === 0;

  function togglePreset(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid || pending) return;
    onSubmit({ to: allRecipients, note });
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
            <div
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
              id="recipients-label"
            >
              Send to <span className="text-red-600">*</span>
            </div>
            <ul
              role="group"
              aria-labelledby="recipients-label"
              aria-describedby={submitAttempted && !isValid ? errorId : undefined}
              className="mt-1.5 space-y-1.5"
            >
              {PRESET_RECIPIENTS.map((email) => {
                const isChecked = selected.has(email);
                return (
                  <li key={email}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-navy/40 hover:bg-navy-soft/20">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePreset(email)}
                        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-navy focus:ring-navy"
                      />
                      <span className="font-mono text-[13px]">{email}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <label
              htmlFor="email-other"
              className="mt-3 block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Other recipients <span className="text-gray-400">(optional, comma-separated)</span>
            </label>
            <input
              id="email-other"
              type="text"
              value={otherRaw}
              onChange={(e) => setOtherRaw(e.target.value)}
              placeholder="someone@edstellar.com, other@example.com"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
            {allRecipients.length > 0 && (
              <p className="mt-2 text-[11px] text-gray-500">
                Will send to <span className="font-mono">{allRecipients.length}</span>{" "}
                recipient{allRecipients.length === 1 ? "" : "s"}:{" "}
                <span className="font-mono">{allRecipients.join(", ")}</span>
              </p>
            )}
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
            {otherInvalid.length > 0
              ? `Invalid email${otherInvalid.length === 1 ? "" : "s"}: ${otherInvalid.join(", ")}`
              : "Pick at least one recipient (tick a preset above, or add a custom address)."}
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

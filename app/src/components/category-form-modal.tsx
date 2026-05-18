"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The editable shape — strips id + auto-managed courseCount. */
export type CategoryDraft = Omit<Category, "id" | "courseCount">;

interface CategoryFormModalProps {
  onClose: () => void;
  /**
   * When provided, the form is in **edit** mode and prefills these values.
   * When undefined, the form is in **add** mode.
   */
  initialValues?: Category;
  /** Names already in use — used to prevent duplicates in add mode. */
  existingNames: string[];
  /**
   * Persists the draft. Phase 1 hands this to setState in the parent;
   * Phase 4 swaps in a Server Action that upserts into
   * `course-agent.categories`.
   */
  onSubmit: (draft: CategoryDraft) => void;
}

/**
 * Mount this component to open the modal; unmount to close. The parent
 * controls visibility by conditionally rendering — this keeps form state
 * out of effects (each open is a fresh mount with fresh useState).
 */
export function CategoryFormModal({
  onClose,
  initialValues,
  existingNames,
  onSubmit,
}: CategoryFormModalProps) {
  const isEdit = initialValues != null;
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState(initialValues?.name ?? "");
  // Phase 9 update — target_count is no longer used by gap_analyze
  // (the agent derives an implicit target from the inventory's
  // distribution). The DB column still exists but the UI no longer
  // exposes it; we preserve whatever value already lives there on
  // edit, and pass null on add.
  const targetCount = initialValues?.targetCount ?? null;
  const [demandScore, setDemandScore] = useState<number>(
    initialValues?.demandScore ?? 0.5,
  );
  const [isPinned, setIsPinned] = useState(initialValues?.isPinned ?? true);
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const errorId = useId();

  // Show the native modal once on mount. The parent handles close-on-unmount.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const trimmed = name.trim();
  const isDuplicate =
    !isEdit &&
    trimmed.length > 0 &&
    existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const nameValid = trimmed.length >= 3 && !isDuplicate;
  const demandValid =
    Number.isFinite(demandScore) && demandScore >= 0 && demandScore <= 1;
  const isValid = nameValid && demandValid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid) return;
    onSubmit({
      name: trimmed,
      targetCount,
      demandScore,
      isPinned,
      notes: notes.trim() || null,
    });
    // Don't call onClose() here — the parent owns close timing now.
    // On a successful Server Action the parent unmounts this modal by
    // flipping form.mode to "closed"; on failure it keeps us mounted
    // so the user can see the error and retry without losing input.
  };

  const errorMessage = !nameValid
    ? trimmed.length === 0
      ? "Give the category a name."
      : isDuplicate
        ? "A category with this name already exists."
        : "Category names need at least 3 characters."
    : !demandValid
      ? "Demand score should be between 0 and 1."
      : null;

  const title = isEdit ? "Edit category" : "Add a category for the agent to target";
  const eyebrow = isEdit ? "Admin · adjust" : "Admin · expand catalogue";
  const submitLabel = isEdit ? "Save changes" : "Add category";

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-full max-w-lg rounded-lg border border-gray-100 bg-white p-0 shadow-lg backdrop:bg-navy-deep/40 backdrop:backdrop-blur-sm"
      aria-labelledby="category-form-title"
    >
      <form onSubmit={handleSubmit}>
        <header className="border-b border-gray-100 px-6 py-5">
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            {eyebrow}
          </div>
          <h2
            id="category-form-title"
            className="mt-1 font-display text-lg font-semibold text-navy-deep"
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {isEdit
              ? "Adjust the demand hint and pin status. The gap analyzer derives the under-supply target automatically from the inventory."
              : "New categories start with zero courses. Pin them and the agent will prioritise filling the gap on the next run."}
          </p>
        </header>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label
              htmlFor="category-name"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Category name <span className="text-red-600">*</span>
            </label>
            <input
              id="category-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bioinformatics"
              disabled={isEdit}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
            />
            {isEdit && (
              <p className="mt-1 text-[11px] text-gray-500">
                Renaming a category requires a data migration — disabled in the
                UI to keep the FK from <code className="font-mono">suggestions.category</code> stable.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="category-demand"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Demand score (0–1)
            </label>
            <input
              id="category-demand"
              type="number"
              min={0}
              max={1}
              step="any"
              value={demandScore}
              onChange={(e) => setDemandScore(Number(e.target.value))}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Multiplier on the under-supply score. Higher = the agent picks this category sooner when the gap is similar.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-md border border-gray-100 bg-off-white p-3">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy/30"
            />
            <span className="text-sm">
              <span className="font-medium text-navy-deep">Pin for the next run</span>
              <span className="block text-[11px] text-gray-500">
                Pinned categories jump the gap-analysis ranking regardless of
                under-supply score.
              </span>
            </span>
          </label>

          <div>
            <label
              htmlFor="category-notes"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Notes
            </label>
            <textarea
              id="category-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this category worth chasing? Anything the agent should bias toward?"
              rows={2}
              className="mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
          </div>
        </div>

        {submitAttempted && errorMessage && (
          <div
            id={errorId}
            role="alert"
            className="mx-6 -mt-1 mb-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-xs text-red-700"
          >
            {errorMessage}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-gray-100 bg-off-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={cn(
              "rounded-md px-3.5 py-2 text-sm font-medium text-white transition-colors",
              isValid ? "bg-navy hover:bg-navy-deep" : "cursor-not-allowed bg-navy/40",
            )}
            aria-describedby={
              submitAttempted && !isValid ? errorId : undefined
            }
          >
            {submitLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

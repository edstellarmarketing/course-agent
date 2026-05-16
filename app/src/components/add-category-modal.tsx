"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export type NewCategoryDraft = Omit<Category, "id" | "courseCount">;

interface AddCategoryModalProps {
  open: boolean;
  onClose: () => void;
  /** Names already in use — used to prevent duplicates client-side. */
  existingNames: string[];
  /**
   * Persists the new category. Phase 1 hands this to a setState in the
   * parent; Phase 4 will swap in a Server Action that writes to
   * `course-agent.categories`.
   */
  onSubmit: (draft: NewCategoryDraft) => void;
}

export function AddCategoryModal({
  open,
  onClose,
  existingNames,
  onSubmit,
}: AddCategoryModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [targetCount, setTargetCount] = useState<number>(30);
  const [demandScore, setDemandScore] = useState<number>(0.5);
  const [isPinned, setIsPinned] = useState(true);
  const [notes, setNotes] = useState("");
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

  const trimmed = name.trim();
  const isDuplicate =
    trimmed.length > 0 &&
    existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const nameValid = trimmed.length >= 3 && !isDuplicate;
  const targetValid = Number.isFinite(targetCount) && targetCount > 0;
  const demandValid =
    Number.isFinite(demandScore) && demandScore >= 0 && demandScore <= 1;
  const isValid = nameValid && targetValid && demandValid;

  const reset = () => {
    setName("");
    setTargetCount(30);
    setDemandScore(0.5);
    setIsPinned(true);
    setNotes("");
    setSubmitAttempted(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

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
    handleClose();
  };

  const errorMessage = !nameValid
    ? trimmed.length === 0
      ? "Give the category a name."
      : isDuplicate
        ? "A category with this name already exists."
        : "Category names need at least 3 characters."
    : !targetValid
      ? "Target count must be a positive number."
      : !demandValid
        ? "Demand score should be between 0 and 1."
        : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className="w-full max-w-lg rounded-lg border border-gray-100 bg-white p-0 shadow-lg backdrop:bg-navy-deep/40 backdrop:backdrop-blur-sm"
      aria-labelledby="add-category-title"
    >
      <form onSubmit={handleSubmit}>
        <header className="border-b border-gray-100 px-6 py-5">
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            Admin · expand catalogue
          </div>
          <h2
            id="add-category-title"
            className="mt-1 font-display text-lg font-semibold text-navy-deep"
          >
            Add a category for the agent to target
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            New categories start with zero courses. Pin them and the agent will
            prioritise filling the gap on the next run.
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
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
            {isDuplicate && submitAttempted && (
              <p className="mt-1 text-xs text-red-700">
                Already in use — pick a different name.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="category-target"
                className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
              >
                Target course count
              </label>
              <input
                id="category-target"
                type="number"
                min={1}
                step={1}
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                How many courses you eventually want here.
              </p>
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
                step={0.05}
                value={demandScore}
                onChange={(e) => setDemandScore(Number(e.target.value))}
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Phase 3 will pull this from external signals; set a hint for now.
              </p>
            </div>
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
            onClick={handleClose}
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
            Add category
          </button>
        </footer>
      </form>
    </dialog>
  );
}

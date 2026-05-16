"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { CategoryCell } from "@/components/category-cell";
import {
  CategoryFormModal,
  type CategoryDraft,
} from "@/components/category-form-modal";
import { PageHeader } from "@/components/page-header";
import { underSupplyScore } from "@/lib/mock/categories";
import type { Category } from "@/lib/types";

interface CategoriesViewProps {
  seedCategories: Category[];
  /** Only admins see the Add / Edit affordances. */
  canEdit: boolean;
}

type FormState =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; target: Category };

/**
 * Renders the 43-category heatmap and (for admins) lets new categories be
 * added or existing categories be edited. Phase 4 will replace the local
 * state with Server Actions that upsert into `course-agent.categories`
 * and revalidate this route — the modal already calls a single
 * `onSubmit(draft)` callback, so the swap is mechanical.
 */
export function CategoriesView({
  seedCategories,
  canEdit,
}: CategoriesViewProps) {
  const [added, setAdded] = useState<Category[]>([]);
  /** Per-id overrides applied to seed + added categories. */
  const [edits, setEdits] = useState<Record<string, CategoryDraft>>({});
  const [form, setForm] = useState<FormState>({ mode: "closed" });

  const applyEdits = (c: Category): Category => {
    const override = edits[c.id];
    return override ? { ...c, ...override } : c;
  };

  const all = useMemo(
    () => [...seedCategories.map(applyEdits), ...added.map(applyEdits)],
    [seedCategories, added, edits], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const scored = useMemo(
    () =>
      all
        .map((c) => ({ category: c, score: underSupplyScore(c) }))
        .sort((a, b) => b.score - a.score),
    [all],
  );

  const maxScore = scored[0]?.score ?? 0;
  const pinnedCount = all.filter((c) => c.isPinned).length;
  const editedCount = Object.keys(edits).length;

  const handleSubmit = (draft: CategoryDraft) => {
    if (form.mode === "edit") {
      setEdits((prev) => ({ ...prev, [form.target.id]: draft }));
    } else if (form.mode === "add") {
      const fresh: Category = {
        ...draft,
        id: `local-${crypto.randomUUID()}`,
        courseCount: 0,
      };
      setAdded((prev) => [...prev, fresh]);
    }
  };

  // Names to dedupe against when adding — exclude the one being edited so
  // the form doesn't flag itself.
  const existingNames = all
    .filter((c) => !(form.mode === "edit" && c.id === form.target.id))
    .map((c) => c.name);

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Coverage Heatmap"
        description={`All ${all.length} categories, colour-graded by under-supply (gap × demand × pin boost). Click any cell to filter the inventory.`}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => setForm({ mode: "add" })}
                className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-navy-deep transition-colors hover:border-navy hover:bg-navy-soft"
              >
                + Add category
              </button>
            )}
            <Link
              href="/categories/least-supplied"
              className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
            >
              Least supplied →
            </Link>
          </div>
        }
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        {(added.length > 0 || editedCount > 0) && (
          <div className="rounded-md border border-orange-light/40 bg-orange-pale px-4 py-3 text-sm text-orange">
            <span className="font-display text-[11px] font-semibold uppercase tracking-widest">
              Session-only ·
            </span>{" "}
            {added.length > 0 && (
              <>
                {added.length} added{editedCount > 0 ? " · " : ""}
              </>
            )}
            {editedCount > 0 && (
              <>
                {editedCount} edited
              </>
            )}
            . Phase 4 wires the Add/Edit form to a Server Action that persists
            to <code className="rounded bg-white px-1 font-mono text-[11px]">course-agent.categories</code>.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-gray-100 bg-white px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <ScaleSwatch tone="bg-gray-50 border-gray-100" label="Saturated" />
            <ScaleSwatch tone="bg-navy-soft border-navy-soft" label="Low gap" />
            <ScaleSwatch tone="bg-amber-soft border-amber-200" label="Medium" />
            <ScaleSwatch tone="bg-orange-pale border-orange-light/40" label="High" />
            <ScaleSwatch tone="bg-orange border-orange-light" label="Critical" />
          </div>
          <div className="text-xs text-gray-500">
            <span className="font-display font-semibold text-orange">◆</span>{" "}
            {pinnedCount} pinned by admins (boosted in agent targeting)
            {canEdit && (
              <span className="ml-3 text-gray-400">
                Hover any cell to edit
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {scored.map(({ category, score }) => (
            <CategoryCell
              key={category.id}
              category={category}
              underSupplyScore={score}
              maxScore={maxScore}
              onEdit={
                canEdit
                  ? () => setForm({ mode: "edit", target: category })
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {form.mode !== "closed" && (
        <CategoryFormModal
          key={form.mode === "edit" ? `edit-${form.target.id}` : "add"}
          onClose={() => setForm({ mode: "closed" })}
          initialValues={form.mode === "edit" ? form.target : undefined}
          existingNames={existingNames}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}

function ScaleSwatch({ tone, label }: { tone: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600">
      <span className={`block h-3 w-5 rounded border ${tone}`} />
      {label}
    </div>
  );
}

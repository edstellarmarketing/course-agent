"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { upsertCategory } from "@/app/(app)/categories/actions";
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
 * Renders the heatmap of all categories. Admins can add new categories
 * and edit existing ones — both flows hit the `upsertCategory` Server
 * Action which writes to `course-agent.categories` and revalidates this
 * route. RLS enforces admin-only writes server-side; the `canEdit` prop
 * only controls the UI affordance.
 *
 * The mock `underSupplyScore` algorithm still drives the heat colours
 * because real `target_count` + `demand_score` are null until admins
 * fill them in — the heatmap will gradient up as those columns get
 * populated.
 */
export function CategoriesView({
  seedCategories,
  canEdit,
}: CategoriesViewProps) {
  const [form, setForm] = useState<FormState>({ mode: "closed" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const scored = seedCategories
    .map((c) => ({ category: c, score: underSupplyScore(c) }))
    .sort((a, b) => b.score - a.score);

  const maxScore = scored[0]?.score ?? 0;
  const pinnedCount = seedCategories.filter((c) => c.isPinned).length;

  const handleSubmit = (draft: CategoryDraft) => {
    setError(null);
    const id = form.mode === "edit" ? form.target.id : undefined;
    startTransition(async () => {
      const res = await upsertCategory(
        {
          name: draft.name,
          targetCount: draft.targetCount,
          demandScore: draft.demandScore,
          isPinned: draft.isPinned,
          notes: draft.notes,
        },
        id,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setForm({ mode: "closed" });
    });
  };

  const existingNames = seedCategories
    .filter((c) => !(form.mode === "edit" && c.id === form.target.id))
    .map((c) => c.name);

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Coverage Heatmap"
        description={`All ${seedCategories.length} categories, colour-graded by under-supply (gap × demand × pin boost). Click any cell to filter the inventory.`}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setForm({ mode: "add" });
                }}
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
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-soft px-4 py-3 text-sm text-red-700"
          >
            {error}
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
                  ? () => {
                      setError(null);
                      setForm({ mode: "edit", target: category });
                    }
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

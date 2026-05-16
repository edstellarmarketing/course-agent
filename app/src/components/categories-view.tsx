"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AddCategoryModal, type NewCategoryDraft } from "@/components/add-category-modal";
import { CategoryCell } from "@/components/category-cell";
import { PageHeader } from "@/components/page-header";
import { underSupplyScore } from "@/lib/mock/categories";
import type { Category } from "@/lib/types";

interface CategoriesViewProps {
  seedCategories: Category[];
  /** Only admins see the "Add category" affordance. */
  canEdit: boolean;
}

/**
 * Renders the 43-category heatmap and (for admins) lets new categories be
 * added on the fly. Phase 4 will replace the local state with a Server
 * Action that writes to `course-agent.categories` and revalidates this
 * route — at which point this component returns to being a thin Client
 * Island over server-fetched data.
 */
export function CategoriesView({
  seedCategories,
  canEdit,
}: CategoriesViewProps) {
  const [added, setAdded] = useState<Category[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const all = useMemo(() => [...seedCategories, ...added], [seedCategories, added]);

  const scored = useMemo(
    () =>
      all
        .map((c) => ({ category: c, score: underSupplyScore(c) }))
        .sort((a, b) => b.score - a.score),
    [all],
  );

  const maxScore = scored[0]?.score ?? 0;
  const pinnedCount = all.filter((c) => c.isPinned).length;

  const handleAdd = (draft: NewCategoryDraft) => {
    const fresh: Category = {
      ...draft,
      id: `local-${crypto.randomUUID()}`,
      courseCount: 0,
    };
    setAdded((prev) => [...prev, fresh]);
  };

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
                onClick={() => setModalOpen(true)}
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
        {added.length > 0 && (
          <div className="rounded-md border border-orange-light/40 bg-orange-pale px-4 py-3 text-sm text-orange">
            <span className="font-display text-[11px] font-semibold uppercase tracking-widest">
              Session-only ·
            </span>{" "}
            You&rsquo;ve added {added.length} categor{added.length === 1 ? "y" : "ies"} this
            session. Phase 4 wires the Add button to a Server Action that
            persists to <code className="rounded bg-white px-1 font-mono text-[11px]">course-agent.categories</code>.
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
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {scored.map(({ category, score }) => (
            <CategoryCell
              key={category.id}
              category={category}
              underSupplyScore={score}
              maxScore={maxScore}
            />
          ))}
        </div>
      </div>

      <AddCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        existingNames={all.map((c) => c.name)}
        onSubmit={handleAdd}
      />
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

import Link from "next/link";

import { CategoryCell } from "@/components/category-cell";
import { PageHeader } from "@/components/page-header";
import {
  mockCategories,
  underSupplyScore,
} from "@/lib/mock/categories";

export const metadata = {
  title: "Categories · Course Agent",
};

export default function CategoriesPage() {
  const scored = mockCategories
    .map((c) => ({ category: c, score: underSupplyScore(c) }))
    .sort((a, b) => b.score - a.score);

  const maxScore = scored[0]?.score ?? 0;
  const pinnedCount = mockCategories.filter((c) => c.isPinned).length;

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Coverage Heatmap"
        description={`All ${mockCategories.length} categories, colour-graded by under-supply (gap × demand × pin boost). Click any cell to filter the inventory.`}
        actions={
          <Link
            href="/categories/least-supplied"
            className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
          >
            Least supplied →
          </Link>
        }
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-gray-100 bg-white px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <ScaleSwatch tone="bg-gray-50 border-gray-100" label="Saturated" />
            <ScaleSwatch tone="bg-navy-soft border-navy-soft" label="Low gap" />
            <ScaleSwatch tone="bg-amber-soft border-amber-200" label="Medium" />
            <ScaleSwatch tone="bg-orange-pale border-orange-light/40" label="High" />
            <ScaleSwatch tone="bg-orange border-orange-light" label="Critical" textTone="text-white" />
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
    </>
  );
}

function ScaleSwatch({
  tone,
  label,
  textTone,
}: {
  tone: string;
  label: string;
  textTone?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600">
      <span className={`block h-3 w-5 rounded border ${tone} ${textTone ?? ""}`} />
      {label}
    </div>
  );
}

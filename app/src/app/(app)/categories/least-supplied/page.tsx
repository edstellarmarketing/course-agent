import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import {
  mockCategories,
  underSupplyScore,
} from "@/lib/mock/categories";

export const metadata = {
  title: "Least Supplied · Course Agent",
};

export default function LeastSuppliedPage() {
  const ranked = mockCategories
    .map((c) => ({
      category: c,
      score: underSupplyScore(c),
      gap: (c.targetCount ?? 0) - c.courseCount,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Least-supplied categories"
        description="The 20 categories with the biggest gap-to-target × demand pressure. These are the agent's natural targets for tomorrow's run."
        actions={
          <Link
            href="/categories"
            className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Full heatmap
          </Link>
        }
      />

      <div className="flex-1 px-8 py-8">
        <div className="overflow-hidden rounded-lg border border-gray-100 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500">
                <th className="px-6 py-3 font-display font-semibold">Rank</th>
                <th className="px-6 py-3 font-display font-semibold">Category</th>
                <th className="px-6 py-3 font-display font-semibold">Current</th>
                <th className="px-6 py-3 font-display font-semibold">Target</th>
                <th className="px-6 py-3 font-display font-semibold">Gap</th>
                <th className="px-6 py-3 font-display font-semibold">Demand</th>
                <th className="px-6 py-3 font-display font-semibold">Score</th>
                <th className="px-6 py-3 font-display font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ category, score, gap }, i) => (
                <tr key={category.id} className="border-t border-gray-100">
                  <td className="px-6 py-3 font-mono text-xs text-gray-500">
                    {i + 1}
                  </td>
                  <td className="px-6 py-3">
                    <span className="font-medium text-navy-deep">{category.name}</span>
                    {category.isPinned && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-orange-pale px-2 py-0.5 font-display text-[9px] font-semibold uppercase tracking-widest text-orange"
                        title="Pinned by admin"
                      >
                        ◆ Pinned
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-gray-700">
                    {category.courseCount}
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-gray-700">
                    {category.targetCount ?? "—"}
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-red-700">
                    {gap > 0 ? `+${gap}` : "—"}
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-gray-700">
                    {category.demandScore != null
                      ? Math.round(category.demandScore * 100)
                      : "—"}
                  </td>
                  <td className="px-6 py-3 font-mono text-xs font-semibold text-navy-deep">
                    {score.toFixed(1)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link
                      href={`/inventory?category=${encodeURIComponent(category.name)}`}
                      className="font-display text-xs font-medium text-navy hover:text-navy-deep"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

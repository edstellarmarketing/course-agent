import Link from "next/link";

import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CategoryCellProps {
  category: Category;
  underSupplyScore: number;
  /** Highest score in the rendered set — used to scale heat intensity. */
  maxScore: number;
}

/**
 * One cell in the categories heatmap. Background intensity tracks
 * under-supply score; pinned cells get the diamond marker.
 */
export function CategoryCell({
  category,
  underSupplyScore,
  maxScore,
}: CategoryCellProps) {
  const intensity = maxScore > 0 ? Math.min(1, underSupplyScore / maxScore) : 0;
  // Five buckets from cool navy-soft to hot orange.
  const tone =
    intensity < 0.15
      ? "bg-gray-50 text-gray-600 border-gray-100"
      : intensity < 0.35
        ? "bg-navy-soft text-navy-deep border-navy-soft"
        : intensity < 0.55
          ? "bg-amber-soft text-amber-700 border-amber-200"
          : intensity < 0.8
            ? "bg-orange-pale text-orange border-orange-light/40"
            : "bg-orange text-white border-orange-light";

  const ratio = category.targetCount
    ? `${category.courseCount}/${category.targetCount}`
    : `${category.courseCount}`;

  return (
    <Link
      href={`/inventory?category=${encodeURIComponent(category.name)}`}
      className={cn(
        "group relative block rounded-md border p-3 text-left transition-shadow hover:shadow-sm",
        tone,
      )}
      title={category.notes ?? undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium leading-tight">
          {category.name}
        </span>
        {category.isPinned && (
          <span
            aria-label="Pinned by admin"
            className="shrink-0 text-orange group-hover:text-current"
          >
            ◆
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between font-mono text-[11px]">
        <span className="opacity-80">{ratio}</span>
        {category.demandScore != null && (
          <span className="opacity-80">demand {Math.round(category.demandScore * 100)}</span>
        )}
      </div>
    </Link>
  );
}

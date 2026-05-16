import Link from "next/link";

import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CategoryCellProps {
  category: Category;
  underSupplyScore: number;
  /** Highest score in the rendered set — used to scale heat intensity. */
  maxScore: number;
  /** Admin-only edit hook. When present, an Edit button is rendered. */
  onEdit?: () => void;
}

/**
 * One cell in the categories heatmap. Background intensity tracks
 * under-supply score; pinned cells get the diamond marker. Admins get a
 * small Edit affordance via `onEdit`.
 */
export function CategoryCell({
  category,
  underSupplyScore,
  maxScore,
  onEdit,
}: CategoryCellProps) {
  const intensity = maxScore > 0 ? Math.min(1, underSupplyScore / maxScore) : 0;
  // Five buckets from cool navy-soft to hot orange.
  const tone =
    intensity < 0.15
      ? "bg-gray-50 text-gray-600 border-gray-100 hover:border-gray-200"
      : intensity < 0.35
        ? "bg-navy-soft text-navy-deep border-navy-soft hover:border-navy/30"
        : intensity < 0.55
          ? "bg-amber-soft text-amber-700 border-amber-200 hover:border-amber-400"
          : intensity < 0.8
            ? "bg-orange-pale text-orange border-orange-light/40 hover:border-orange"
            : "bg-orange text-white border-orange-light hover:border-white";

  const ratio = category.targetCount
    ? `${category.courseCount}/${category.targetCount}`
    : `${category.courseCount}`;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border transition-shadow hover:shadow-sm",
        tone,
      )}
      title={category.notes ?? undefined}
    >
      <Link
        href={`/inventory?category=${encodeURIComponent(category.name)}`}
        className="block p-3 text-left"
        aria-label={`Filter inventory by ${category.name}`}
      >
        <div className="flex items-start justify-between gap-2 pr-6">
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

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${category.name}`}
          className={cn(
            "absolute right-1.5 top-1.5 z-10 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/30",
            intensity >= 0.8
              ? "hover:bg-white/20"
              : "hover:bg-black/5",
          )}
        >
          <PencilIcon />
        </button>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

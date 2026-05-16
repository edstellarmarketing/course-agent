import { cn } from "@/lib/utils";

interface RuleBadgeProps {
  label: string;
  variant?: "rule" | "neutral" | "warning";
  className?: string;
}

/**
 * The green "Rule N passed" pills from the mockup. Used on suggestion cards
 * to surface which guardrails the candidate cleared.
 */
export function RuleBadge({ label, variant = "rule", className }: RuleBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider",
        variant === "rule" && "bg-green-soft text-green-700",
        variant === "neutral" && "bg-gray-100 text-gray-600",
        variant === "warning" && "bg-amber-soft text-amber-700",
        className,
      )}
    >
      {variant === "rule" && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {label}
    </span>
  );
}

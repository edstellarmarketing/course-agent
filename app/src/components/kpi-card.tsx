import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: {
    direction: "up" | "down" | "flat";
    label: string;
  };
  caption?: string;
  accent?: "navy" | "orange" | "green" | "neutral";
  className?: string;
}

const ACCENTS: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  navy: "before:bg-navy",
  orange: "before:bg-orange",
  green: "before:bg-green-500",
  neutral: "before:bg-gray-200",
};

export function KpiCard({
  label,
  value,
  delta,
  caption,
  accent = "navy",
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-gray-100 bg-white p-5 shadow-sm",
        "before:absolute before:left-0 before:top-0 before:h-full before:w-1",
        ACCENTS[accent],
        className,
      )}
    >
      <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="font-display text-3xl font-semibold tracking-tight text-navy-deep">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[11px] font-medium",
              delta.direction === "up" && "bg-green-soft text-green-700",
              delta.direction === "down" && "bg-red-soft text-red-700",
              delta.direction === "flat" && "bg-gray-100 text-gray-600",
            )}
          >
            {delta.direction === "up" && "↑ "}
            {delta.direction === "down" && "↓ "}
            {delta.label}
          </span>
        )}
      </div>
      {caption && (
        <div className="mt-2 text-xs text-gray-500">{caption}</div>
      )}
    </div>
  );
}

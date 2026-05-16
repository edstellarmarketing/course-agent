import Link from "next/link";

import { RuleBadge } from "@/components/rule-badge";
import type { Suggestion } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SuggestionCardProps {
  suggestion: Suggestion;
  actions?: React.ReactNode;
  className?: string;
}

const dollarsUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Headline rules every persisted candidate has already cleared. */
const PASSED_RULES = [
  "≥3 verified refs",
  "no cert names",
  "no recent duplicate",
  "price > $2.5k",
  "instructor-led",
];

export function SuggestionCard({
  suggestion,
  actions,
  className,
}: SuggestionCardProps) {
  const closest = suggestion.closestExistingCourse;

  return (
    <article
      className={cn(
        "grid grid-cols-1 gap-6 rounded-lg border border-gray-100 bg-white p-6 shadow-sm xl:grid-cols-[1.6fr_1fr]",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-display text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          <span className="rounded-full bg-navy-soft px-2 py-0.5 text-navy">
            {suggestion.category}
          </span>
          {suggestion.proposedSubcategory && (
            <span className="text-gray-400">{suggestion.proposedSubcategory}</span>
          )}
        </div>

        <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-navy-deep">
          <Link
            href={`/suggestions/${suggestion.id}`}
            className="hover:text-navy"
          >
            {suggestion.title}
          </Link>
        </h3>

        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          {suggestion.rationale}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Fact label="Audience" value={suggestion.targetAudience} />
          <Fact label="Duration" value={`${suggestion.durationDays} day${suggestion.durationDays === 1 ? "" : "s"}`} />
          <Fact label="Format" value={suggestion.deliveryFormat} />
          <Fact
            label="Price"
            value={
              <span className="font-mono font-semibold text-navy-deep">
                {dollarsUsd(suggestion.suggestedPriceUsd)}
              </span>
            }
          />
        </dl>

        <div className="mt-3 rounded-md border border-gray-100 bg-off-white p-3 text-xs leading-relaxed text-gray-600">
          <span className="font-display font-semibold uppercase tracking-wider text-gray-500">
            Price basis ·{" "}
          </span>
          {suggestion.priceBasis}
        </div>

        <div className="mt-4">
          <div className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            References
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {suggestion.references.map((ref) => (
              <li key={ref.url}>
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-xs items-center gap-1.5 truncate rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 transition-colors hover:border-navy hover:bg-navy-soft hover:text-navy-deep"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
                  <span className="truncate">{ref.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {PASSED_RULES.map((r) => (
            <RuleBadge key={r} label={r} />
          ))}
        </div>

        {actions && <div className="mt-5 flex items-center gap-2">{actions}</div>}
      </div>

      <aside className="rounded-md border border-gray-100 bg-off-white p-4">
        <div className="mb-2 font-display text-[10px] font-semibold uppercase tracking-widest text-orange">
          Closest existing course
        </div>
        {closest ? (
          <>
            <a
              href={closest.course.link ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm font-medium text-navy-deep hover:text-navy"
            >
              {closest.course.name}
            </a>
            <div className="mt-0.5 text-[11px] text-gray-500">
              {closest.course.category}
              {closest.course.subcategory && ` · ${closest.course.subcategory}`}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <SimilarityBar value={closest.similarity} />
              <span className="font-mono text-xs font-semibold text-navy-deep">
                {Math.round(closest.similarity * 100)}%
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              Cosine similarity vs <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">courses.embedding</code>.
              Anything &gt; 85% would have been blocked by Rule 2.
            </p>
          </>
        ) : (
          <div className="text-sm text-gray-500">
            No close match in the catalogue.
          </div>
        )}
      </aside>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-700">{value}</dd>
    </div>
  );
}

function SimilarityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.8
      ? "bg-red-500"
      : value >= 0.7
        ? "bg-amber-500"
        : "bg-navy";
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
      <div
        className={cn("h-full rounded-full", tone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

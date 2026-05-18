import Link from "next/link";

import { RuleBadge } from "@/components/rule-badge";
import type { EdstellarPackage, Suggestion } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SuggestionCardProps {
  suggestion: Suggestion;
  actions?: React.ReactNode;
  className?: string;
}

const dollarsUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

/** Headline rules every persisted candidate has already cleared. */
const PASSED_RULES = [
  "≥3 verified refs",
  "no cert names",
  "no recent duplicate",
  "price > $2.5k",
  "instructor-led",
];

const PACKAGE_TONE: Record<EdstellarPackage, string> = {
  Starter: "bg-gray-100 text-gray-700",
  Growth: "bg-orange-pale text-orange",
  Enterprise: "bg-navy-soft text-navy-deep",
  Custom: "bg-green-soft text-green-700",
};

/**
 * License bank size per package (matches edstellar.com/corporate-training-pricing).
 * Custom is "unlimited" so we render utilisation as a dash.
 */
const PACKAGE_BANK_SIZE: Record<EdstellarPackage, number | null> = {
  Starter: 120,
  Growth: 320,
  Enterprise: 800,
  Custom: null,
};

function bankUtilisation(pf: import("@/lib/types").PackageFit): string {
  const bank = PACKAGE_BANK_SIZE[pf.primaryPackage];
  if (bank == null) return "Unlimited";
  const pct = Math.round((pf.licensesPerBatchOf10 / bank) * 100);
  return `${pct}%`;
}

function formatDuration(s: Suggestion): string {
  if (s.durationHoursMin != null && s.durationHoursMax != null) {
    return s.durationHoursMin === s.durationHoursMax
      ? `${s.durationHoursMin} hrs`
      : `${s.durationHoursMin}-${s.durationHoursMax} hrs`;
  }
  if (s.durationDays != null && s.durationDays > 0) {
    return `${s.durationDays} day${s.durationDays === 1 ? "" : "s"}`;
  }
  return "—";
}

export function SuggestionCard({
  suggestion,
  actions,
  className,
}: SuggestionCardProps) {
  const closest = suggestion.closestExistingCourse;
  const outline = suggestion.contentOutline ?? [];
  const packageFit = suggestion.packageFit;
  const labs = suggestion.labRequirements;
  const pitch = suggestion.edstellarPitch?.trim() ?? "";

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
          <Fact label="Duration" value={formatDuration(suggestion)} />
          <Fact label="Format" value={suggestion.deliveryFormat} />
          <Fact
            label="Per-seat price"
            value={
              <span className="font-mono font-semibold text-navy-deep">
                {dollarsUsd(suggestion.suggestedPriceUsd)}
              </span>
            }
          />
        </dl>

        {packageFit && (
          <div className="mt-4 rounded-md border border-gray-100 bg-off-white p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-orange">
                Package fit
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider",
                  PACKAGE_TONE[packageFit.primaryPackage] ??
                    "bg-gray-100 text-gray-700",
                )}
              >
                {packageFit.primaryPackage}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-md border border-gray-100 bg-white p-3">
                <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Licenses for a group of 10
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-navy-deep">
                  {packageFit.licensesPerBatchOf10}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-gray-400">
                  {packageFit.licenseMath}
                </div>
              </div>
              <div className="rounded-md border border-gray-100 bg-white p-3">
                <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Estimated cost for a batch of 10
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-navy-deep">
                  {dollarsUsd(suggestion.suggestedPriceUsd * 10)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-gray-400">
                  {dollarsUsd(suggestion.suggestedPriceUsd)} / seat × 10
                </div>
              </div>
              <div className="rounded-md border border-gray-100 bg-white p-3">
                <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Bank utilisation
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-navy-deep">
                  {bankUtilisation(packageFit)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-gray-400">
                  of the {packageFit.primaryPackage} license bank
                </div>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-gray-700">
              {packageFit.packageRationale}
            </p>
          </div>
        )}

        <div className="mt-3 rounded-md border border-gray-100 bg-off-white p-3 text-xs leading-relaxed text-gray-600">
          <span className="font-display font-semibold uppercase tracking-wider text-gray-500">
            Price basis ·{" "}
          </span>
          {suggestion.priceBasis}
        </div>

        {pitch && (
          <div className="mt-4 rounded-md border border-orange/30 bg-orange/5 p-3">
            <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-orange">
              Why Edstellar should build this
            </div>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">{pitch}</p>
          </div>
        )}

        {outline.length > 0 && (
          <details className="mt-4 rounded-md border border-gray-100 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 font-display text-[11px] font-semibold uppercase tracking-widest text-navy-deep">
              ▸ Content outline · {outline.length} module
              {outline.length === 1 ? "" : "s"}
            </summary>
            <ol className="space-y-3 border-t border-gray-100 px-4 py-3 text-sm">
              {outline.map((m, i) => (
                <li key={`${i}-${m.module}`}>
                  <div className="font-medium text-navy-deep">
                    {i + 1}. {m.module}
                  </div>
                  {m.topics.length > 0 && (
                    <ul className="mt-1 ml-4 list-disc space-y-0.5 text-[13px] text-gray-600">
                      {m.topics.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}

        {labs && (
          <details className="mt-3 rounded-md border border-gray-100 bg-white">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-display text-[11px] font-semibold uppercase tracking-widest text-navy-deep">
                  Lab requirements
                </span>
                {labs.required ? (
                  <span className="rounded-full bg-amber-soft px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Required
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Theory-only
                  </span>
                )}
              </div>
              {labs.required && (
                <span className="font-mono text-[11px] text-gray-500">
                  {labs.platforms.length} platform
                  {labs.platforms.length === 1 ? "" : "s"} ·{" "}
                  {labs.tools.length} tool{labs.tools.length === 1 ? "" : "s"}
                </span>
              )}
            </summary>
            {labs.required && (
              <div className="grid grid-cols-1 gap-3 border-t border-gray-100 px-4 py-3 text-sm md:grid-cols-2">
                <div>
                  <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    Platforms
                  </div>
                  {labs.platforms.length > 0 ? (
                    <ul className="mt-1 list-disc pl-4 text-[13px] text-gray-700">
                      {labs.platforms.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12px] text-gray-400">None specified.</p>
                  )}
                </div>
                <div>
                  <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    Tools
                  </div>
                  {labs.tools.length > 0 ? (
                    <ul className="mt-1 list-disc pl-4 text-[13px] text-gray-700">
                      {labs.tools.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12px] text-gray-400">None specified.</p>
                  )}
                </div>
                {labs.notes && (
                  <div className="md:col-span-2">
                    <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                      Delivery notes
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-gray-700">
                      {labs.notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </details>
        )}

        <div className="mt-4">
          <div className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            References · {suggestion.references.length}
          </div>
          <ul className="space-y-2">
            {suggestion.references.map((ref) => (
              <li
                key={ref.url}
                className="rounded-md border border-gray-100 bg-white p-3"
              >
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-navy-deep transition-colors hover:text-orange"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
                  <span className="truncate">{ref.name}</span>
                  <span className="text-[10px] text-gray-400">↗</span>
                </a>
                <div className="mt-0.5 truncate font-mono text-[10px] text-gray-400">
                  {ref.url}
                </div>
                {ref.quote && (
                  <blockquote className="mt-2 border-l-2 border-orange-pale pl-3 text-[13px] leading-relaxed text-gray-700">
                    <span className="font-display text-[9px] font-semibold uppercase tracking-widest text-orange">
                      Agent-attributed ·{" "}
                    </span>
                    &ldquo;{ref.quote}&rdquo;
                  </blockquote>
                )}
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

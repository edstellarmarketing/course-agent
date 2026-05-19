"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type SuggestionStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "needs_revision";

// Mirrors the SELECT in app/(app)/history/page.tsx. JSONB columns are
// `unknown` here so the component doesn't have to mirror every nested
// shape; CSV export JSON.stringifies them as-is.
export interface SuggestionExportRow {
  id: string;
  run_id: string;
  title: string | null;
  rationale: string | null;
  category: string | null;
  proposed_subcategory: string | null;
  target_audience: string | null;
  duration_days: number | null;
  duration_hours_min: number | null;
  duration_hours_max: number | null;
  delivery_format: string | null;
  suggested_price_usd: number | string | null;
  price_basis: string | null;
  references: unknown;
  content_outline: unknown;
  package_fit: unknown;
  lab_requirements: unknown;
  edstellar_pitch: string | null;
  status: SuggestionStatus;
  created_at: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

// CSV column order. Kept stable so downstream importers (Sheets, etc.)
// don't drift if the page schema gains/loses fields.
const CSV_COLUMNS: { key: keyof SuggestionExportRow; label: string }[] = [
  { key: "id", label: "id" },
  { key: "run_id", label: "run_id" },
  { key: "created_at", label: "created_at" },
  { key: "status", label: "status" },
  { key: "category", label: "category" },
  { key: "proposed_subcategory", label: "proposed_subcategory" },
  { key: "title", label: "title" },
  { key: "rationale", label: "rationale" },
  { key: "target_audience", label: "target_audience" },
  { key: "delivery_format", label: "delivery_format" },
  { key: "duration_days", label: "duration_days" },
  { key: "duration_hours_min", label: "duration_hours_min" },
  { key: "duration_hours_max", label: "duration_hours_max" },
  { key: "suggested_price_usd", label: "suggested_price_usd" },
  { key: "price_basis", label: "price_basis" },
  { key: "edstellar_pitch", label: "edstellar_pitch" },
  { key: "content_outline", label: "content_outline" },
  { key: "package_fit", label: "package_fit" },
  { key: "lab_requirements", label: "lab_requirements" },
  { key: "references", label: "references" },
];

// RFC 4180-ish CSV escaping. Wrap in quotes if the value contains
// quote, comma, or newline; double-up internal quotes.
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: SuggestionExportRow[]): string {
  const header = CSV_COLUMNS.map((c) => c.label).join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((c) => csvEscape(row[c.key])).join(","),
  );
  // Prepend BOM so Excel opens UTF-8 cleanly.
  return "﻿" + [header, ...lines].join("\r\n");
}

function triggerDownload(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click handler returns so Safari has time to finish.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function SuggestionsExportTable({
  rows,
}: {
  rows: SuggestionExportRow[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // When the parent rows change (filter updates), drop any selected
  // ids no longer present — otherwise the "X selected" count would
  // include phantom rows the user can't see.
  const visibleIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const effectiveSelected = useMemo(() => {
    const out = new Set<string>();
    for (const id of selected) if (visibleIds.has(id)) out.add(id);
    return out;
  }, [selected, visibleIds]);

  const allChecked =
    rows.length > 0 && effectiveSelected.size === rows.length;
  const someChecked =
    effectiveSelected.size > 0 && effectiveSelected.size < rows.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  function onDownload() {
    const toExport =
      effectiveSelected.size > 0
        ? rows.filter((r) => effectiveSelected.has(r.id))
        : rows;
    if (toExport.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix =
      effectiveSelected.size > 0
        ? `selected-${toExport.length}`
        : `all-${toExport.length}`;
    triggerDownload(`suggestions-${stamp}-${suffix}.csv`, buildCsv(toExport));
  }

  const downloadLabel =
    effectiveSelected.size > 0
      ? `Download CSV (${effectiveSelected.size} selected)`
      : rows.length > 0
        ? `Download CSV (all ${rows.length})`
        : "Download CSV";

  return (
    <div className="rounded-lg border border-gray-100 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4 text-sm text-gray-500">
        <span>
          <span className="font-display text-base font-semibold text-navy-deep">
            {rows.length}
          </span>{" "}
          suggestion{rows.length === 1 ? "" : "s"}
          {rows.length === 500 && (
            <span className="ml-2 text-[11px] text-gray-400">
              (showing latest 500 — narrow the date range to see older)
            </span>
          )}
          {effectiveSelected.size > 0 && (
            <span className="ml-3 text-[11px] uppercase tracking-widest text-orange">
              {effectiveSelected.size} selected
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onDownload}
          disabled={rows.length === 0}
          className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloadLabel}
        </button>
      </header>

      {rows.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-500">
          No suggestions match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-off-white text-left text-[10px] uppercase tracking-widest text-gray-500">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all visible suggestions"
                    checked={allChecked}
                    // The DOM property `indeterminate` isn't reflected
                    // via React's `checked` attribute; set it imperatively.
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-navy focus:ring-navy"
                  />
                </th>
                <th className="px-6 py-3 font-display font-semibold">Title</th>
                <th className="px-6 py-3 font-display font-semibold">Category</th>
                <th className="px-6 py-3 font-display font-semibold">Status</th>
                <th className="px-6 py-3 font-display font-semibold whitespace-nowrap">
                  Suggested date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const checked = effectiveSelected.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-off-white ${
                      checked ? "bg-navy-soft/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.title ?? row.id}`}
                        checked={checked}
                        onChange={() => toggleOne(row.id)}
                        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-navy focus:ring-navy"
                      />
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/suggestions/${row.id}`}
                        className="font-medium text-navy-deep hover:text-navy"
                      >
                        {row.title ?? <em className="text-gray-400">untitled</em>}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {row.category ?? "—"}
                    </td>
                    <td className="px-6 py-3">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                      {fmtDate(row.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SuggestionStatus }) {
  const map = {
    pending_review: "bg-amber-soft text-amber-700",
    approved: "bg-green-soft text-green-700",
    rejected: "bg-red-soft text-red-700",
    needs_revision: "bg-navy-soft text-navy-deep",
  } as const;
  const label = status.replace("_", " ");
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {label}
    </span>
  );
}

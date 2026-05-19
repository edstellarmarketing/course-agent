"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  type BulkCourseInput,
  type BulkUploadResult,
  bulkUploadCourses,
} from "@/app/(app)/inventory/actions";
import { parseCsv } from "@/lib/csv";

/**
 * The page (server component) renders this; it owns the open/close
 * state so the modal only mounts when the user actually clicks.
 * Mounting on demand means each open is a clean useState — no need
 * to thread file/result state through props.
 */
export function InventoryUploadButton() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
      >
        Upload courses
      </button>
      {isOpen && <InventoryUploadModal onClose={() => setIsOpen(false)} />}
    </>
  );
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches plan §4

// 1-based CSV row numbering: the header is row 1, data starts at row 2.
type ClientValidation =
  | { ok: true }
  | { ok: false; message: string };

function validateRow(row: BulkCourseInput): ClientValidation {
  if (!row.name.trim()) return { ok: false, message: "missing `name`" };
  if (!row.category.trim()) return { ok: false, message: "missing `category`" };
  if (row.num.trim()) {
    const n = Number.parseInt(row.num.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, message: `\`num\` not a positive integer: "${row.num}"` };
    }
  }
  return { ok: true };
}

export function InventoryUploadModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<BulkCourseInput[]>([]);
  const [parseErrors, setParseErrors] = useState<
    { row: number; message: string }[]
  >([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const stage: "pick" | "preview" | "result" =
    result != null ? "result" : rows.length > 0 ? "preview" : "pick";

  function resetToPick() {
    setFile(null);
    setRows([]);
    setParseErrors([]);
    setFileError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(f: File) {
    setFileError(null);
    setResult(null);
    if (f.size > MAX_BYTES) {
      setFileError(
        `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`,
      );
      return;
    }
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setFileError("Pick a .csv file (UTF-8 text).");
      return;
    }
    setFile(f);

    let text: string;
    try {
      text = await f.text();
    } catch (err) {
      setFileError(
        `Couldn't read the file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      setFile(null);
      return;
    }

    const parsed = parseCsv<Record<string, string>>(text);
    if (parsed.headers.length === 0) {
      setFileError(parsed.errors[0]?.message ?? "Couldn't parse the CSV.");
      setFile(null);
      return;
    }

    // Lowercase headers so "Name" / "NAME" / "name" all map to the same key.
    const headerKeys = parsed.headers.map((h) => h.toLowerCase());
    if (!headerKeys.includes("name") || !headerKeys.includes("category")) {
      setFileError(
        `Missing required column${headerKeys.includes("name") ? "" : " \`name\`"}${
          headerKeys.includes("category") ? "" : " \`category\`"
        }. Found: ${parsed.headers.join(", ")}.`,
      );
      setFile(null);
      return;
    }

    // Map each row by-key, defaulting missing optional columns to "".
    const mapped: BulkCourseInput[] = parsed.rows.map((r) => {
      // Lowercase the incoming keys so "Name" / "NAME" / "name" all match.
      const lower: Record<string, string> = {};
      for (const k of Object.keys(r)) lower[k.toLowerCase()] = r[k];
      return {
        num: lower.num ?? "",
        name: lower.name ?? "",
        category: lower.category ?? "",
        subcategory: lower.subcategory ?? "",
        link: lower.link ?? "",
      };
    });

    setRows(mapped);
    setParseErrors(parsed.errors);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }

  function onProcess() {
    startTransition(async () => {
      const r = await bulkUploadCourses(rows);
      setResult(r);
    });
  }

  const previewRows = rows.slice(0, 5);
  // Surface inline validation issues so the operator can spot bad rows
  // BEFORE they hit Process.
  const rowValidations = rows.map(validateRow);
  const invalidCount = rowValidations.filter((v) => !v.ok).length;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-full max-w-2xl rounded-lg border border-gray-100 bg-white p-0 shadow-lg backdrop:bg-navy-deep/40 backdrop:backdrop-blur-sm"
      aria-labelledby="upload-modal-title"
    >
      <header className="flex items-start justify-between border-b border-gray-100 px-6 py-5">
        <div>
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            Admin · bulk import
          </div>
          <h2
            id="upload-modal-title"
            className="mt-1 font-display text-lg font-semibold text-navy-deep"
          >
            Upload courses
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Required columns: <code className="font-mono">name</code>,{" "}
            <code className="font-mono">category</code>. Optional:{" "}
            <code className="font-mono">num</code>,{" "}
            <code className="font-mono">subcategory</code>,{" "}
            <code className="font-mono">link</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ✕
        </button>
      </header>

      <div className="space-y-4 px-6 py-5">
        {stage === "pick" && (
          <PickStage
            fileInputRef={fileInputRef}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            onDrop={onDrop}
            onFile={handleFile}
            fileError={fileError}
          />
        )}

        {stage === "preview" && (
          <PreviewStage
            file={file}
            rows={rows}
            previewRows={previewRows}
            rowValidations={rowValidations}
            invalidCount={invalidCount}
            parseErrors={parseErrors}
            onChangeFile={resetToPick}
          />
        )}

        {stage === "result" && result != null && (
          <ResultStage result={result} />
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
        {stage === "preview" && (
          <>
            <button
              type="button"
              onClick={resetToPick}
              className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onProcess}
              disabled={pending || invalidCount === rows.length}
              className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending
                ? "Processing…"
                : `Process upload (${rows.length - invalidCount} row${
                    rows.length - invalidCount === 1 ? "" : "s"
                  })`}
            </button>
          </>
        )}
        {stage === "pick" && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        {stage === "result" && (
          <>
            <button
              type="button"
              onClick={resetToPick}
              className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Upload another
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
            >
              Done
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}

// ─── stage components ───────────────────────────────────────────────

function PickStage({
  fileInputRef,
  isDragging,
  setIsDragging,
  onDrop,
  onFile,
  fileError,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  setIsDragging: (b: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFile: (f: File) => void;
  fileError: string | null;
}) {
  return (
    <>
      <div className="rounded-md border border-gray-100 bg-off-white px-3 py-2 text-[12px] text-gray-600">
        Need the format?{" "}
        <a
          href="/api/internal/sample-courses-csv"
          className="font-medium text-navy-deep underline-offset-2 hover:underline"
        >
          Download sample CSV
        </a>
        .
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors ${
          isDragging
            ? "border-navy bg-navy-soft/40"
            : "border-gray-200 bg-white"
        }`}
      >
        <p className="font-display text-sm font-medium text-navy-deep">
          Drop a CSV here
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          Max 5 MB · UTF-8 · header row required
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Browse files…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>

      {fileError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-soft px-3 py-2 text-sm text-red-700"
        >
          {fileError}
        </div>
      )}
    </>
  );
}

function PreviewStage({
  file,
  rows,
  previewRows,
  rowValidations,
  invalidCount,
  parseErrors,
  onChangeFile,
}: {
  file: File | null;
  rows: { num: string; name: string; category: string; subcategory: string; link: string }[];
  previewRows: typeof rows;
  rowValidations: ClientValidation[];
  invalidCount: number;
  parseErrors: { row: number; message: string }[];
  onChangeFile: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-off-white px-3 py-2 text-[12px]">
        <span className="text-gray-600">
          <span className="font-medium text-navy-deep">{file?.name}</span>
          {" — "}
          <span className="font-mono">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
          {invalidCount > 0 && (
            <span className="ml-2 text-red-700">
              {invalidCount} invalid
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onChangeFile}
          className="font-medium text-navy-deep underline-offset-2 hover:underline"
        >
          Choose a different file
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-off-white text-left text-[10px] uppercase tracking-widest text-gray-500">
            <tr>
              <th className="px-3 py-2 font-display font-semibold">#</th>
              <th className="px-3 py-2 font-display font-semibold">num</th>
              <th className="px-3 py-2 font-display font-semibold">name</th>
              <th className="px-3 py-2 font-display font-semibold">category</th>
              <th className="px-3 py-2 font-display font-semibold">subcategory</th>
              <th className="px-3 py-2 font-display font-semibold">link</th>
              <th className="px-3 py-2 font-display font-semibold">status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {previewRows.map((r, i) => {
              const v = rowValidations[i];
              return (
                <tr key={i} className={!v.ok ? "bg-red-soft/40" : ""}>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-500">
                    {i + 2}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {r.num || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-800">
                    {r.name || <em className="text-gray-400">empty</em>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.category || <em className="text-gray-400">empty</em>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {r.subcategory || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-500 truncate max-w-[180px]">
                    {r.link || "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {v.ok ? (
                      <span className="text-green-700">OK</span>
                    ) : (
                      <span className="text-red-700">{v.message}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > previewRows.length && (
          <div className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
            Showing the first {previewRows.length} of {rows.length} rows.
          </div>
        )}
      </div>

      {parseErrors.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-soft px-3 py-2 text-[12px] text-amber-800">
          {parseErrors.length} parse warning{parseErrors.length === 1 ? "" : "s"}:{" "}
          {parseErrors
            .slice(0, 3)
            .map((e) => `row ${e.row}: ${e.message}`)
            .join("; ")}
          {parseErrors.length > 3 && " …"}
        </div>
      )}

      {invalidCount === rows.length && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-soft px-3 py-2 text-sm text-red-700"
        >
          Every row has a validation issue — fix the CSV and try again.
        </div>
      )}
    </>
  );
}

function ResultStage({ result }: { result: BulkUploadResult }) {
  if (!result.ok) {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-soft px-3 py-3 text-sm text-red-700"
      >
        <div className="font-semibold">Upload failed</div>
        <div className="mt-1">{result.error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-green-200 bg-green-soft px-3 py-3 text-sm text-green-800">
        <div className="font-semibold">Upload complete</div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px]">
          <li>
            <span className="font-mono">{result.newCourses}</span> new courses added
          </li>
          <li>
            <span className="font-mono">{result.newCategories}</span> new categories auto-created
            {result.newCategoryNames.length > 0 && (
              <> ({result.newCategoryNames.join(", ")})</>
            )}
          </li>
          <li>
            <span className="font-mono">{result.skippedDuplicates}</span> duplicates skipped
          </li>
          <li>
            <span className="font-mono">{result.conflicts.length}</span> conflict
            {result.conflicts.length === 1 ? "" : "s"} reported
          </li>
        </ul>
      </div>

      {result.newCourses > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-soft px-3 py-3 text-[13px] text-amber-800">
          <div className="font-semibold">
            ⚠ {result.newCourses} course{result.newCourses === 1 ? "" : "s"} awaiting embedding
          </div>
          <div className="mt-1">
            Until embeddings are backfilled, the agent&apos;s dedup (Rule 2) and demand (Rule 9)
            checks won&apos;t see these rows. Run:
          </div>
          <pre className="mt-2 overflow-x-auto rounded bg-white/60 px-2 py-1 font-mono text-[11px]">
uv --directory engine run embed_courses
          </pre>
          <div className="mt-1 text-[11px] opacity-80">
            (Or wait for the next scheduled embed job on the Coolify VPS.)
          </div>
        </div>
      )}

      {result.conflicts.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-white">
          <header className="border-b border-gray-100 px-3 py-2 text-[11px] uppercase tracking-widest text-gray-500">
            Conflicts ({result.conflicts.length})
          </header>
          <table className="w-full text-sm">
            <thead className="bg-off-white text-left text-[10px] uppercase tracking-widest text-gray-500">
              <tr>
                <th className="px-3 py-2 font-display font-semibold">CSV row</th>
                <th className="px-3 py-2 font-display font-semibold">num</th>
                <th className="px-3 py-2 font-display font-semibold">CSV name</th>
                <th className="px-3 py-2 font-display font-semibold">DB name</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.conflicts.map((c) => (
                <tr key={`${c.num}-${c.row}`}>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-500">
                    {c.row}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{c.num}</td>
                  <td className="px-3 py-2">{c.csvName}</td>
                  <td className="px-3 py-2 text-gray-700">{c.dbName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-soft px-3 py-2 text-[12px] text-amber-800">
          <div className="font-semibold">
            {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped due to validation
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {result.errors.slice(0, 5).map((e, i) => (
              <li key={i}>
                row {e.row}: {e.message}
              </li>
            ))}
            {result.errors.length > 5 && <li>… and {result.errors.length - 5} more</li>}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        Audit-logged as <code className="font-mono">courses.bulk_upload</code> · visible in /history.
      </p>
    </div>
  );
}

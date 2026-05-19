/**
 * Tiny RFC-4180-ish CSV parser.
 *
 * Used by the /inventory bulk-upload flow. Browser-side parsing only,
 * so we don't pull a 30 KB dep like papaparse into the bundle just for
 * a header + 5 optional columns × ≤50K rows.
 *
 * Supported:
 *   - Header row drives field names (first non-empty line).
 *   - Fields wrapped in `"..."` with `""` for an escaped quote inside.
 *   - Commas / newlines / quotes inside quoted fields.
 *   - CRLF or LF line endings.
 *   - Trailing blank lines ignored.
 *
 * Not supported:
 *   - Comments (`#...`)
 *   - Custom delimiters (always comma)
 *   - Multi-line quoted fields with binary blobs (we only need text)
 */

export interface CsvParseResult<T extends Record<string, string>> {
  /** Header column names, in document order. */
  headers: string[];
  /** Each row keyed by header. Missing trailing columns become "". */
  rows: T[];
  /** Best-effort per-row errors. 1-based row numbers (the header is row 1). */
  errors: { row: number; message: string }[];
}

/**
 * Streaming state machine. Walks the input once.
 *
 * Returns columns row by row. `parseCsv` then maps columns onto the
 * header to build typed objects.
 */
function tokenize(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const n = input.length;

  // Strip a UTF-8 BOM if present so the first header doesn't end up
  // as "﻿num" — Excel emits this on "Save As CSV UTF-8".
  if (n > 0 && input.charCodeAt(0) === 0xfeff) i = 1;

  while (i < n) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped `""` -> literal `"`; otherwise the quote closes the field.
        if (i + 1 < n && input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    // Not in quotes
    if (ch === '"') {
      // Quote opens a field only at the start of a cell. Inside text
      // it's appended literally — matches Excel's lenient behaviour.
      if (cell.length === 0) {
        inQuotes = true;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Treat CR or CRLF as end-of-line.
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      if (i + 1 < n && input[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  // Flush the trailing cell/row if the file doesn't end in a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop fully-empty rows (a single "" cell from a blank line).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function parseCsv<T extends Record<string, string>>(
  input: string,
): CsvParseResult<T> {
  const grid = tokenize(input);
  if (grid.length === 0) {
    return { headers: [], rows: [], errors: [{ row: 1, message: "Empty file." }] };
  }

  const headers = grid[0].map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h === "")) {
    return {
      headers: [],
      rows: [],
      errors: [{ row: 1, message: "Header row is empty." }],
    };
  }

  const errors: { row: number; message: string }[] = [];
  const rows: T[] = [];

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    // Tolerant: pad short rows with "" and truncate over-long rows.
    if (cells.length > headers.length) {
      errors.push({
        row: r + 1,
        message: `Row has ${cells.length} fields, header expects ${headers.length}. Extra fields ignored.`,
      });
    }
    const obj = {} as Record<string, string>;
    for (let c = 0; c < headers.length; c++) {
      const raw = c < cells.length ? cells[c] : "";
      obj[headers[c]] = raw.trim();
    }
    rows.push(obj as T);
  }

  return { headers, rows, errors };
}

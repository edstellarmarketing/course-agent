/**
 * Render two digest emails — a populated one and the empty-queue
 * variant — to .preview-emails/*.html so you can eyeball both in
 * a browser before Step 3 ships.
 *
 * Run:
 *   pnpm --dir app exec tsx scripts/digest-template-preview.ts
 *
 * Then open the printed paths in Chrome / Firefox. Drop the files
 * into Gmail's "send as draft" if you want to test the inbox
 * rendering too — they're standalone HTML documents.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

import {
  renderDigestHtml,
  renderDigestSubject,
  type DigestProps,
} from "../src/lib/email/digest-template";

const OUT_DIR = resolve(process.cwd(), ".preview-emails");
mkdirSync(OUT_DIR, { recursive: true });

const populated: DigestProps = {
  runId: "b31dfeee-a06a-4f55-9df0-8dccb7ac9d44",
  finishedAt: new Date().toISOString(),
  modelUsed: "deepseek/deepseek-chat-v3.1",
  categoriesTargeted: ["Cloud Computing", "Cybersecurity"],
  candidatesPersisted: 3,
  pendingTotal: 14,
  approvalRate7d: 0.33,
  preview: [
    {
      id: "22222222-2222-2222-2222-222222222204",
      title: "Secure Software Supply Chain for Engineering Teams",
      category: "Cybersecurity",
      suggestedPriceUsd: 3400,
      durationDays: 3,
    },
    {
      id: "22222222-2222-2222-2222-222222222205",
      title: "Platform Engineering for Internal Developer Experience",
      category: "DevOps",
      suggestedPriceUsd: 3500,
      durationDays: 3,
    },
    {
      id: "22222222-2222-2222-2222-222222222203",
      title: "Cloud Cost Optimisation for Engineering Leaders",
      category: "Cloud Computing",
      suggestedPriceUsd: 2900,
      durationDays: 2,
    },
  ],
  reviewerName: "Vijay",
  appUrl: "http://localhost:3000",
};

const empty: DigestProps = {
  runId: "deadbeef-1111-2222-3333-444444444444",
  finishedAt: new Date().toISOString(),
  modelUsed: "deepseek/deepseek-chat-v3.1",
  categoriesTargeted: ["Quality Management"],
  candidatesPersisted: 0,
  pendingTotal: 11,
  approvalRate7d: 0.33,
  preview: [],
  reviewerName: "",
  appUrl: "http://localhost:3000",
};

const populatedHtml = renderDigestHtml(populated);
const populatedSubject = renderDigestSubject(populated);
const emptyHtml = renderDigestHtml(empty);
const emptySubject = renderDigestSubject(empty);

// ── Sanity asserts (the verify line in phase7.md Step 2) ─────────
assert.ok(populatedHtml.length > 1000, "populated HTML should be non-trivial");
assert.ok(
  populatedSubject.includes(populated.runId.slice(0, 8)),
  "populated subject should include run-id prefix",
);
assert.ok(
  populatedSubject.includes("3 new"),
  `populated subject should mention candidate count, got: ${populatedSubject}`,
);
assert.ok(
  populatedHtml.includes("Secure Software Supply Chain"),
  "populated HTML should include the first preview card",
);
assert.ok(
  !populatedHtml.includes("No new suggestions today"),
  "populated HTML should NOT show empty-queue copy",
);

assert.ok(emptyHtml.length > 1000, "empty HTML should still render structure");
assert.ok(
  emptySubject.includes("no new suggestions"),
  `empty subject should call out the empty case, got: ${emptySubject}`,
);
assert.ok(
  emptyHtml.includes("No new suggestions today"),
  "empty HTML should show the empty-queue panel",
);
assert.ok(emptyHtml.includes("Hi there,"), "empty greeting falls back to 'there'");

// Write files for visual inspection.
const populatedPath = join(OUT_DIR, "digest-populated.html");
const emptyPath = join(OUT_DIR, "digest-empty.html");
writeFileSync(populatedPath, populatedHtml, "utf-8");
writeFileSync(emptyPath, emptyHtml, "utf-8");

console.log("✓ All asserts passed.");
console.log();
console.log(`populated subject: ${populatedSubject}`);
console.log(`empty subject:     ${emptySubject}`);
console.log();
console.log("Preview files written:");
console.log(`  ${populatedPath}`);
console.log(`  ${emptyPath}`);
console.log();
console.log("Open them in a browser to eyeball the rendering.");

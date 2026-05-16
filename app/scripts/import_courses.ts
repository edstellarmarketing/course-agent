/**
 * Phase 4 Checkpoint 1 — bulk import courses + seed the categories list.
 *
 * Reads `scripts/courses-seed.json` (extracted from
 * Edstellar_Intelligence_Hub_Verified.html), normalises the em-dash
 * placeholder subcategory to null, and upserts into
 * `course-agent.courses` on `num`. Also seeds `course-agent.categories`
 * with the 43 distinct category names so suggestions can later FK
 * back to them (target_count + demand_score start null; admins fill
 * those in via the Categories page once the UI lands in Checkpoint 2).
 *
 * Idempotent: re-running upserts every row, no duplicates.
 *
 *   pnpm --dir app exec tsx scripts/import_courses.ts
 *
 * Requires migration 0003 to have been applied (adds the unique index
 * on courses.num that the upsert keys on).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

import { createAdminClient } from "../src/lib/supabase/server";

loadDotenv({ path: ".env.local", quiet: true });

interface SeedCourse {
  num: number;
  name: string;
  category: string;
  subcategory: string;
  link: string;
}

const CHUNK_SIZE = 500;
const SUBCATEGORY_PLACEHOLDER = "—"; // em-dash sentinel from the source

async function main(): Promise<void> {
  const seedPath = resolve(process.cwd(), "scripts/courses-seed.json");
  const raw = readFileSync(seedPath, "utf8");
  const rows = JSON.parse(raw) as SeedCourse[];

  console.log(`import_courses (${rows.length} rows from ${seedPath})\n`);

  const supabase = createAdminClient();

  // ── 1. Seed categories ────────────────────────────────────────────
  const categoryNames = [...new Set(rows.map((r) => r.category))].sort();
  console.log(`→ upserting ${categoryNames.length} categories…`);
  const categoryPayload = categoryNames.map((name) => ({ name }));
  const { error: catErr } = await supabase
    .from("categories")
    .upsert(categoryPayload, { onConflict: "name", ignoreDuplicates: true });
  if (catErr) {
    console.error("✗ categories upsert failed:", catErr);
    process.exit(1);
  }
  console.log("✓ categories ready");

  // ── 2. Upsert courses in chunks ───────────────────────────────────
  const coursePayload = rows.map((r) => ({
    num: r.num,
    name: r.name,
    category: r.category,
    subcategory:
      r.subcategory === SUBCATEGORY_PLACEHOLDER || !r.subcategory
        ? null
        : r.subcategory,
    link: r.link,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  let inserted = 0;
  for (let i = 0; i < coursePayload.length; i += CHUNK_SIZE) {
    const chunk = coursePayload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("courses")
      .upsert(chunk, { onConflict: "num" });
    if (error) {
      console.error(
        `✗ courses upsert failed on chunk starting at row ${i}:`,
        error,
      );
      process.exit(1);
    }
    inserted += chunk.length;
    process.stdout.write(`\r→ courses upserted: ${inserted}/${rows.length}`);
  }
  console.log("\n✓ courses ready");

  // ── 3. Verify ─────────────────────────────────────────────────────
  const { count, error: countErr } = await supabase
    .from("courses")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    console.error("✗ count query failed:", countErr);
    process.exit(1);
  }
  console.log(`\nFinal: ${count} rows in course-agent.courses`);
  console.log(
    `Next step: run embed_courses.py to backfill the 1024-dim Voyage embeddings.`,
  );
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(1);
});

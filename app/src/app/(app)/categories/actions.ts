"use server";

import { revalidatePath } from "next/cache";

import { createSessionClient } from "@/lib/supabase/server-with-session";

/**
 * The shape the CategoryFormModal sends — same as `CategoryDraft` in the
 * modal component, but kept here as a local interface so this file
 * doesn't pull a Client Component's exports into the server bundle.
 */
export interface CategoryUpsertInput {
  name: string;
  targetCount: number | null;
  demandScore: number | null;
  isPinned: boolean;
  notes: string | null;
}

/**
 * Insert a brand-new category or update an existing one by id.
 *
 * RLS already enforces admin-only writes (the
 * `categories_admin_write` policy created in migration 0001), so a
 * reviewer-role user calling this action sees the row-count check
 * silently no-op. Returning explicit `{ ok: false }` for that case lets
 * the modal show a friendly error instead of a generic exception.
 */
export async function upsertCategory(
  input: CategoryUpsertInput,
  id?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSessionClient();
  const payload = {
    name: input.name.trim(),
    target_count: input.targetCount,
    demand_score: input.demandScore,
    is_pinned: input.isPinned,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };

  if (id) {
    // Ask for the affected rows back so a silent 0-row response (RLS
    // denied the write but PostgREST didn't error) can be detected and
    // surfaced — supabase-js returns `error: null, data: []` in that
    // case, which would otherwise look like success.
    const { data, error } = await supabase
      .from("categories")
      .update(payload)
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return {
        ok: false,
        error:
          "No rows updated — your account may not have admin write access on this category.",
      };
    }
  } else {
    const { data, error } = await supabase
      .from("categories")
      .insert(payload)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: "No row inserted — admin write access required.",
      };
    }
  }

  // Both pages aggregate over categories, so invalidate both.
  revalidatePath("/categories");
  revalidatePath("/categories/least-supplied");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/audit";
import { createSessionClient } from "@/lib/supabase/server-with-session";

/**
 * Promote a candidate prompt to active.
 *
 * Two writes in sequence (no transaction):
 *   1. Flip the current active row to ``retired``.
 *   2. Flip the chosen candidate row to ``active``.
 *
 * If step 2 fails, step 1's retirement stays — admin can manually
 * fix by promoting the old version back. Two-row swap is the right
 * trade-off vs the rarer Postgres function call; this happens at
 * most a few times a week.
 *
 * RLS: `prompt_versions_admin_all` policy (migration 0001) gates
 * writes on is_admin(). The session client respects this; a
 * non-admin caller silently no-ops at the row-count level — we
 * detect and return `{ok:false}` so the UI banner shows.
 */
export async function promotePromptVersion(
  candidateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSessionClient();

  // Retire current active(s). There should be exactly one but be
  // defensive — if there are zero we still proceed.
  const { error: retireErr } = await supabase
    .from("prompt_versions")
    .update({ status: "retired" })
    .eq("status", "active")
    .select("id");
  if (retireErr) return { ok: false, error: retireErr.message };

  const { data, error } = await supabase
    .from("prompt_versions")
    .update({ status: "active" })
    .eq("id", candidateId)
    .eq("status", "candidate")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "Couldn't promote — either the row isn't a candidate, or your account isn't admin.",
    };
  }

  await logAdminAction({
    action: "prompt.promote",
    targetType: "prompt_versions",
    targetId: candidateId,
  });

  revalidatePath("/learning");
  return { ok: true };
}

export async function retirePromptVersion(
  rowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .update({ status: "retired" })
    .eq("id", rowId)
    .in("status", ["candidate", "active"])
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Couldn't retire — admin write access required.",
    };
  }

  await logAdminAction({
    action: "prompt.retire",
    targetType: "prompt_versions",
    targetId: rowId,
  });

  revalidatePath("/learning");
  return { ok: true };
}

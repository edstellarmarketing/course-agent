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

/**
 * Re-activate a retired prompt (rollback).
 *
 * Same two-write shape as promotePromptVersion but the source row
 * must be `retired`, not `candidate`. The audit_log row uses a
 * distinct action (`prompt.restore`) so the trail makes intent
 * clear in a future investigation.
 */
export async function restorePromptVersion(
  rowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSessionClient();

  const { error: retireErr } = await supabase
    .from("prompt_versions")
    .update({ status: "retired" })
    .eq("status", "active")
    .select("id");
  if (retireErr) return { ok: false, error: retireErr.message };

  const { data, error } = await supabase
    .from("prompt_versions")
    .update({ status: "active" })
    .eq("id", rowId)
    .eq("status", "retired")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "Couldn't restore — either the row isn't retired, or your account isn't admin.",
    };
  }

  await logAdminAction({
    action: "prompt.restore",
    targetType: "prompt_versions",
    targetId: rowId,
  });

  revalidatePath("/learning");
  return { ok: true };
}

/**
 * Save a new candidate prompt version.
 *
 * Auto-assigns the next version number (max + 1). The resulting
 * row lands as `candidate` so it shows up alongside the active in
 * /learning; the operator promotes when ready. To bypass A/B and
 * promote the new text immediately, save here and then promote
 * the freshly-inserted row.
 *
 * Returns the new row id so the UI can update without a full
 * reload if it wants to.
 */
export async function createPromptCandidate(input: {
  systemPrompt: string;
  notes?: string;
  modelSlug?: string;
}): Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }> {
  const text = input.systemPrompt.trim();
  if (!text) return { ok: false, error: "Prompt text can't be empty." };
  if (text.length < 200) {
    return {
      ok: false,
      error: "Prompt looks suspiciously short (< 200 chars). Refusing to save.",
    };
  }

  const supabase = await createSessionClient();

  // Pick the next version number. There's a unique index on
  // version, so two concurrent saves can race — we'd see a 409
  // from PostgREST and the second caller would retry by hand.
  // Single-admin operation in practice; not worth a sequence.
  const { data: latestRows, error: latestErr } = await supabase
    .from("prompt_versions")
    .select("version")
    .order("version", { ascending: false })
    .limit(1);
  if (latestErr) return { ok: false, error: latestErr.message };
  const nextVersion = (latestRows?.[0]?.version ?? 0) + 1;

  const modelSlug = input.modelSlug?.trim() || "deepseek/deepseek-chat-v3.1";
  const notes = input.notes?.trim() || `Edited from /learning UI`;

  const { data, error } = await supabase
    .from("prompt_versions")
    .insert({
      version: nextVersion,
      model_slug: modelSlug,
      system_prompt: text,
      status: "candidate",
      notes,
    })
    .select("id, version");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "No row inserted — admin write access required.",
    };
  }

  await logAdminAction({
    action: "prompt.create_candidate",
    targetType: "prompt_versions",
    targetId: data[0].id,
    payload: { version: nextVersion, chars: text.length },
  });

  revalidatePath("/learning");
  return { ok: true, id: data[0].id, version: nextVersion };
}

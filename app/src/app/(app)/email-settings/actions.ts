"use server";

import { revalidatePath } from "next/cache";

import { getCurrentReviewer } from "@/lib/auth/current-user";
import { logAdminAction } from "@/lib/audit";
import { sendDigestForRun } from "@/lib/email/send-digest";
import { createAdminClient } from "@/lib/supabase/server";
import { createSessionClient } from "@/lib/supabase/server-with-session";

/**
 * RFC-5322-ish loose email check. Good enough for an admin-only
 * input — the digest_recipients table has a unique constraint on
 * email so dupes return a clean error from PostgREST regardless.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RecipientUpsertInput {
  email: string;
  isActive: boolean;
  assignedCategories: string[] | null;  // null = all categories
  notes: string | null;
}

function _normalizeCategories(arr: string[] | null): string[] | null {
  if (!arr) return null;
  const clean = arr.map((s) => s.trim()).filter((s) => s.length > 0);
  return clean.length > 0 ? clean : null;
}

export async function addRecipient(
  input: RecipientUpsertInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("digest_recipients")
    .insert({
      email,
      is_active: input.isActive,
      assigned_categories: _normalizeCategories(input.assignedCategories),
      notes: input.notes?.trim() || null,
    })
    .select("id");

  if (error) {
    // Unique constraint violation gets a friendlier message.
    if (error.code === "23505") {
      return { ok: false, error: `${email} is already on the digest list.` };
    }
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "No row inserted — admin write access required.",
    };
  }

  await logAdminAction({
    action: "digest_recipient.add",
    targetType: "digest_recipients",
    targetId: data[0].id,
    payload: { email, is_active: input.isActive },
  });

  revalidatePath("/email-settings");
  return { ok: true, id: data[0].id };
}

export async function updateRecipient(
  id: string,
  input: Partial<RecipientUpsertInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const update: Record<string, unknown> = {};
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: "That doesn't look like a valid email address." };
    }
    update.email = email;
  }
  if (input.isActive !== undefined) update.is_active = input.isActive;
  if (input.assignedCategories !== undefined) {
    update.assigned_categories = _normalizeCategories(input.assignedCategories);
  }
  if (input.notes !== undefined) update.notes = input.notes?.trim() || null;

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "Nothing to update." };
  }
  update.updated_at = new Date().toISOString();

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("digest_recipients")
    .update(update)
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That email is already on the digest list." };
    }
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Couldn't update — admin write access required.",
    };
  }

  await logAdminAction({
    action: "digest_recipient.update",
    targetType: "digest_recipients",
    targetId: id,
    payload: update,
  });

  revalidatePath("/email-settings");
  return { ok: true };
}

/**
 * Send the digest for the most recent agent_run, but only to the
 * signed-in admin's own email. Real recipient list is bypassed —
 * this is for verifying the GAS relay + email rendering without
 * spamming reviewers.
 *
 * Why service-role for the agent_runs lookup: the latest-run query
 * needs to see every row regardless of which reviewer is signed in;
 * RLS could otherwise hide rows the admin doesn't directly own.
 */
export async function sendTestDigest(): Promise<
  | { ok: true; runId: string; sentTo: string }
  | { ok: false; error: string }
> {
  const profile = await getCurrentReviewer();
  if (!profile?.email) {
    return { ok: false, error: "No signed-in reviewer email — cannot test." };
  }

  const admin = createAdminClient();
  const { data: runs, error: runErr } = await admin
    .from("agent_runs")
    .select("id")
    .not("finished_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1);

  if (runErr) return { ok: false, error: runErr.message };
  if (!runs || runs.length === 0) {
    return {
      ok: false,
      error:
        "No completed agent runs yet — trigger one first, then come back to test.",
    };
  }
  const runId = runs[0].id;

  const result = await sendDigestForRun(runId, {
    recipientsOverride: [profile.email],
  });
  if (!result.ok) return { ok: false, error: result.error };

  await logAdminAction({
    action: "digest_recipient.test_send",
    targetType: "digest_recipients",
    payload: { run_id: runId, sent_to: profile.email },
  });

  return { ok: true, runId, sentTo: profile.email };
}

export async function deleteRecipient(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("digest_recipients")
    .delete()
    .eq("id", id)
    .select("id,email");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Couldn't delete — admin write access required.",
    };
  }

  await logAdminAction({
    action: "digest_recipient.delete",
    targetType: "digest_recipients",
    targetId: id,
    payload: { email: data[0].email },
  });

  revalidatePath("/email-settings");
  return { ok: true };
}

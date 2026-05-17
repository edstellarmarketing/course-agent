"use server";

import { revalidatePath } from "next/cache";

import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { FeedbackDecision, RejectionTagKey } from "@/lib/types";

/**
 * Server-action result envelope. The components import this shape and
 * branch on `ok` rather than catching exceptions.
 *
 * We deliberately don't throw — RLS denials, stale-click races, and
 * validation failures are all expected reviewer-facing scenarios and
 * should render as banner messages, not Error Boundaries.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Shared backend for the three reviewer actions. Performs in order:
 *
 *   1. resolve the signed-in reviewer via auth.getUser()
 *   2. UPDATE suggestions SET status = $newStatus
 *      WHERE id = $id AND status = 'pending_review'
 *      — the second predicate is the race guard. If another reviewer
 *      already acted, the UPDATE affects zero rows and we surface a
 *      friendly error instead of silently overwriting their decision.
 *   3. INSERT into feedback. If this fails, we best-effort flip the
 *      status back to 'pending_review' so the queue heals. A real
 *      transaction would be cleaner; supabase-js can't span two tables
 *      atomically without an RPC. Phase 6 may promote this to an RPC.
 *
 * Always runs as the session client (anon key + cookies) so that
 * `feedback_insert` RLS policy can enforce `reviewer_id = auth.uid()`.
 * Never swap in the admin client here — it would let a reviewer
 * impersonate another by passing an arbitrary reviewer_id.
 */
async function applyDecision(args: {
  suggestionId: string;
  decision: FeedbackDecision;
  newStatus: "approved" | "rejected" | "needs_revision";
  reasonTags?: RejectionTagKey[];
  reasonText?: string | null;
}): Promise<ActionResult> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  // Race-safe status flip. The .eq("status", "pending_review") guard
  // means the second reviewer's UPDATE in a parallel race returns zero
  // rows back, which is how we detect ghost clicks.
  const { data: flipped, error: flipError } = await supabase
    .from("suggestions")
    .update({ status: args.newStatus })
    .eq("id", args.suggestionId)
    .eq("status", "pending_review")
    .select("id");
  if (flipError) {
    return { ok: false, error: flipError.message };
  }
  if (!flipped || flipped.length === 0) {
    return {
      ok: false,
      error: "This suggestion was already decided by another reviewer.",
    };
  }

  const { error: fbError } = await supabase.from("feedback").insert({
    suggestion_id: args.suggestionId,
    decision: args.decision,
    reason_tags: args.reasonTags ?? [],
    reason_text: args.reasonText ?? null,
    reviewer_id: user.id,
  });
  if (fbError) {
    // Heal the queue — without this rollback, the row would be in
    // limbo (status != pending_review blocks the next reviewer, but
    // no feedback row explains why).
    await supabase
      .from("suggestions")
      .update({ status: "pending_review" })
      .eq("id", args.suggestionId);
    return { ok: false, error: fbError.message };
  }

  // Every surface that aggregates over suggestions or feedback needs
  // to re-render after a decision. revalidatePath is the single
  // invalidation signal — components should not also call
  // router.refresh() (that double-fetches).
  revalidatePath("/suggestions/today");
  revalidatePath(`/suggestions/${args.suggestionId}`);
  revalidatePath("/history");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Approve — no tags, no note. Hard transition to status='approved'. */
export async function approveSuggestion(
  id: string,
): Promise<ActionResult> {
  return applyDecision({
    suggestionId: id,
    decision: "approved",
    newStatus: "approved",
  });
}

/**
 * Reject — at least one tag required. The `other` tag additionally
 * requires reason text, but that constraint is enforced client-side in
 * the modal; here we only check that the tag set is non-empty so the
 * agent's negative memory always has a structured signal.
 */
export async function rejectSuggestion(
  id: string,
  tags: RejectionTagKey[],
  reasonText: string | null,
): Promise<ActionResult> {
  if (!tags || tags.length === 0) {
    return { ok: false, error: "Pick at least one rejection tag." };
  }
  return applyDecision({
    suggestionId: id,
    decision: "rejected",
    newStatus: "rejected",
    reasonTags: tags,
    reasonText: reasonText && reasonText.trim().length > 0
      ? reasonText.trim()
      : null,
  });
}

/**
 * Needs-revision — free-text only (no structured tags). The note is
 * required so the agent has something concrete to learn from on the
 * next run.
 */
export async function requestRevision(
  id: string,
  note: string,
): Promise<ActionResult> {
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Add a short note for the agent." };
  }
  return applyDecision({
    suggestionId: id,
    decision: "needs_revision",
    newStatus: "needs_revision",
    reasonText: trimmed,
  });
}

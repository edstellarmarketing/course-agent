import "server-only";

import { getCurrentReviewer } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Phase 9 Step 5 — record one admin action in the audit_log.
 *
 * Call this from a Server Action AFTER its primary write succeeds.
 * If the audit insert itself fails (network blip, schema drift), we
 * log to stderr and continue — the admin action shouldn't be rolled
 * back just because the audit trail is temporarily unreachable.
 *
 * The audit_log table has no writer RLS policy, so writes only land
 * via the service-role client. That's intentional: the audit trail
 * must not be editable by the reviewer whose actions it records.
 *
 * If no reviewer is signed in we no-op silently — engine-side writes
 * (no auth.user) belong to a future migration that introduces a
 * "system" pseudo-user in auth.users. Skipping for now matches the
 * doc's "actor_id is not null" constraint without throwing.
 */
export async function logAdminAction(args: {
  action: string;
  targetType: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const profile = await getCurrentReviewer();
  if (!profile) return;

  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    actor_id: profile.id,
    action: args.action,
    target_type: args.targetType,
    target_id: args.targetId ?? null,
    payload: args.payload ?? {},
  });

  if (error) {
    console.error(
      "[audit_log] insert failed action=%s target=%s/%s err=%s",
      args.action,
      args.targetType,
      args.targetId ?? "",
      error.message,
    );
  }
}

/**
 * Reviewer recipient list for the daily digest.
 *
 * Phase 8 Step 10 — DB-backed. Reads ``course-agent.digest_recipients``
 * via the service-role client. The route handler at
 * ``/api/internal/run-complete`` calls this once per send; with
 * <100 reviewers expected for the foreseeable future a single
 * round-trip per digest is fine.
 *
 * Override via the ``DIGEST_RECIPIENTS_OVERRIDE`` env var when
 * testing — comma-separated emails go to that recipient instead.
 * Keeps dev runs from spamming real reviewers at 2am. (Phase 7
 * pattern preserved.)
 */

import { createAdminClient } from "@/lib/supabase/server";

interface DigestRecipientRow {
  email: string;
  is_active: boolean;
}

/**
 * Phase 8: now async because it queries Supabase. Callers (the
 * route handler in send-digest.ts) await this once per send.
 */
export async function digestRecipients(): Promise<string[]> {
  const override = process.env.DIGEST_RECIPIENTS_OVERRIDE?.trim();
  if (override) {
    return override
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("digest_recipients")
    .select("email,is_active")
    .eq("is_active", true)
    .order("email");

  if (error) {
    console.error("[digestRecipients] query failed:", error);
    return [];
  }
  return ((data ?? []) as DigestRecipientRow[]).map((r) => r.email);
}

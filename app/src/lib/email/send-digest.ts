/**
 * Build + send the daily digest email for one agent run.
 *
 * Internal-only — called from the webhook route handler that the
 * engine pings on run completion. Never exposed to the browser
 * (uses the service-role Supabase client to read across all
 * suggestions, which RLS would otherwise block for an anon caller).
 *
 * On the wire side, this just POSTs to the GAS relay; the same
 * relay the Phase 2 smoke test exercises. The relay returns
 * ``{ok: true}`` on success, ``{error: "..."}`` on failure.
 */

import { env } from "@/lib/env";
import {
  type DigestPreviewItem,
  type DigestProps,
  renderDigestHtml,
  renderDigestSubject,
} from "@/lib/email/digest-template";
import { digestRecipients } from "@/lib/email/recipients";
import { createAdminClient } from "@/lib/supabase/server";

/** Max suggestion cards inlined into the email body. */
const PREVIEW_LIMIT = 6;

export type SendDigestResult =
  | {
      ok: true;
      sent_to: string[];
      message_id: string;
      candidates_persisted: number;
      pending_total: number;
    }
  | { ok: false; error: string };

interface AgentRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  model_used: string;
  categories_targeted: string[];
  candidates_persisted: number | null;
}

interface PreviewSuggestionRow {
  id: string;
  title: string;
  category: string;
  suggested_price_usd: number;
  duration_days: number | null;
  run_id: string | null;
}

export async function sendDigestForRun(
  runId: string,
): Promise<SendDigestResult> {
  const e = env();
  if (!e.GAS_EMAIL_WEBHOOK_URL || !e.GAS_EMAIL_SHARED_SECRET) {
    return {
      ok: false,
      error:
        "GAS relay not configured — set GAS_EMAIL_WEBHOOK_URL + GAS_EMAIL_SHARED_SECRET",
    };
  }

  const supabase = createAdminClient();

  // ── Fan out the four reads we need in parallel. ───────────────
  // Two-week feedback window powers the 7d approval rate
  // computation. PREVIEW_LIMIT pending rows feed the email cards.
  const now = new Date();
  const cutoff7d = new Date(now);
  cutoff7d.setDate(cutoff7d.getDate() - 7);
  const cutoff7dIso = cutoff7d.toISOString();

  const [runRes, previewRes, pendingCountRes, recentFeedbackRes] =
    await Promise.all([
      supabase
        .from("agent_runs")
        .select(
          "id,started_at,finished_at,model_used,categories_targeted,candidates_persisted",
        )
        .eq("id", runId)
        .maybeSingle(),
      // Prefer this run's own pending suggestions; fall back to the
      // overall pending queue (carryover from earlier runs) so a
      // zero-survivor run still shows something useful behind the
      // CTA. The empty-queue panel below makes the distinction
      // visible to the reviewer.
      supabase
        .from("suggestions")
        .select("id,title,category,suggested_price_usd,duration_days,run_id")
        .eq("status", "pending_review")
        .order("created_at", { ascending: false })
        .limit(PREVIEW_LIMIT),
      supabase
        .from("suggestions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_review"),
      supabase
        .from("feedback")
        .select("decision,created_at")
        .gte("created_at", cutoff7dIso),
    ]);

  if (runRes.error || !runRes.data) {
    return {
      ok: false,
      error: `agent_runs ${runId} not found: ${runRes.error?.message ?? "no row"}`,
    };
  }
  const run = runRes.data as AgentRunRow;
  const previewRows = (previewRes.data ?? []) as PreviewSuggestionRow[];
  const pendingTotal = pendingCountRes.count ?? 0;

  // ── Compute the 7d approval rate. ─────────────────────────────
  // 0-window or no-decisions → 0%. Nothing fancy; the dashboard
  // does the same math.
  const recent = (recentFeedbackRes.data ?? []) as Array<{
    decision: string;
    created_at: string;
  }>;
  const approvalRate7d =
    recent.length === 0
      ? 0
      : recent.filter((f) => f.decision === "approved").length / recent.length;

  // Promote this-run's preview items to the top of the inlined
  // cards if any of them survived; otherwise the most recent
  // carryover candidates lead.
  const thisRunFirst = previewRows.slice().sort((a, b) => {
    const aIsThisRun = a.run_id === run.id ? 1 : 0;
    const bIsThisRun = b.run_id === run.id ? 1 : 0;
    return bIsThisRun - aIsThisRun;
  });

  const preview: DigestPreviewItem[] = thisRunFirst.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    suggestedPriceUsd: Number(r.suggested_price_usd),
    durationDays: r.duration_days ?? 0,
  }));

  // ── Render the email. ─────────────────────────────────────────
  const props: DigestProps = {
    runId: run.id,
    finishedAt: run.finished_at ?? run.started_at,
    modelUsed: run.model_used,
    categoriesTargeted: run.categories_targeted ?? [],
    candidatesPersisted: run.candidates_persisted ?? 0,
    pendingTotal,
    approvalRate7d,
    preview,
    reviewerName: "",
    appUrl: deriveAppUrl(),
  };

  const html = renderDigestHtml(props);
  const subject = renderDigestSubject(props);
  const recipients = await digestRecipients();
  if (recipients.length === 0) {
    return { ok: false, error: "no digest recipients configured" };
  }

  // ── POST to GAS relay. ────────────────────────────────────────
  // Send one POST per recipient — the relay accepts a single
  // recipient per call. Could pack into `to` as a comma-separated
  // list, but per-recipient gives cleaner failure semantics if one
  // address is malformed.
  const failures: string[] = [];
  for (const to of recipients) {
    const res = await fetch(e.GAS_EMAIL_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to,
        subject,
        html,
        secret: e.GAS_EMAIL_SHARED_SECRET,
        name: "Edstellar Course Agent",
      }),
    });
    const body = await res.json().catch(() => null);
    const ok =
      res.ok && (body?.ok === true || body?.success === true);
    if (!ok) {
      failures.push(
        `${to}: ${body?.error ?? `HTTP ${res.status}`}`,
      );
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: `GAS relay rejected ${failures.length}/${recipients.length}: ${failures.join("; ")}`,
    };
  }

  return {
    ok: true,
    sent_to: recipients,
    message_id: run.id,
    candidates_persisted: run.candidates_persisted ?? 0,
    pending_total: pendingTotal,
  };
}

/**
 * App base URL for deep links in the email. Prefer an explicit
 * APP_URL env var; fall back to the dev-server default. Production
 * deploys MUST set APP_URL to the customer-facing hostname so the
 * Review-now button doesn't link to localhost.
 */
function deriveAppUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit && /^https?:\/\//.test(explicit)) {
    return explicit.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

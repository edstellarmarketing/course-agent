"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/audit";
import { env } from "@/lib/env";
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

// ─── Share-by-email ─────────────────────────────────────────────────

/** Loose RFC-5322-ish email check — same as /email-settings actions. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Cheap HTML escape so suggestion text (from the agent) can't break
 * the email body. The agent output is mostly safe but occasionally
 * contains `<` from code snippets in rationale/outline.
 */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

interface ReferenceShape {
  name?: string;
  url?: string;
  quote?: string | null;
}

interface ContentOutlineShape {
  module?: string;
  topics?: string[];
}

interface SuggestionEmailRow {
  id: string;
  title: string | null;
  category: string | null;
  proposed_subcategory: string | null;
  rationale: string | null;
  target_audience: string | null;
  duration_days: number | null;
  duration_hours_min: number | null;
  duration_hours_max: number | null;
  suggested_price_usd: number | string | null;
  price_basis: string | null;
  edstellar_pitch: string | null;
  content_outline: ContentOutlineShape[] | null;
  references: ReferenceShape[] | null;
}

function renderSuggestionEmail(args: {
  row: SuggestionEmailRow;
  fromName: string;
  note: string | null;
  appUrl: string;
}): string {
  const { row, fromName, note, appUrl } = args;

  const title = htmlEscape(row.title ?? "Untitled suggestion");
  const category = htmlEscape(row.category ?? "—");
  const sub = row.proposed_subcategory
    ? ` · ${htmlEscape(row.proposed_subcategory)}`
    : "";
  const price = fmtUsd(
    typeof row.suggested_price_usd === "string"
      ? Number(row.suggested_price_usd)
      : row.suggested_price_usd,
  );
  const duration =
    row.duration_hours_min != null && row.duration_hours_max != null
      ? row.duration_hours_min === row.duration_hours_max
        ? `${row.duration_hours_min} hrs`
        : `${row.duration_hours_min}-${row.duration_hours_max} hrs`
      : row.duration_days != null && row.duration_days > 0
        ? `${row.duration_days} day${row.duration_days === 1 ? "" : "s"}`
        : "—";

  const outlineHtml =
    Array.isArray(row.content_outline) && row.content_outline.length > 0
      ? `<h3 style="font-size:13px;margin:20px 0 6px;color:#0f172a;">Content outline</h3><ul style="padding-left:20px;margin:0;">${row.content_outline
          .map(
            (m) =>
              `<li style="margin-bottom:6px;"><strong>${htmlEscape(m.module ?? "")}</strong>${
                Array.isArray(m.topics) && m.topics.length > 0
                  ? `<div style="color:#475569;font-size:12px;">${m.topics
                      .map(htmlEscape)
                      .join(" · ")}</div>`
                  : ""
              }</li>`,
          )
          .join("")}</ul>`
      : "";

  const refsHtml =
    Array.isArray(row.references) && row.references.length > 0
      ? `<h3 style="font-size:13px;margin:20px 0 6px;color:#0f172a;">References</h3><ol style="padding-left:20px;margin:0;font-size:12px;color:#334155;">${row.references
          .map(
            (r) =>
              `<li style="margin-bottom:4px;"><a href="${htmlEscape(r.url ?? "#")}" style="color:#1e40af;text-decoration:underline;">${htmlEscape(r.name ?? r.url ?? "ref")}</a>${
                r.quote ? `<div style="color:#64748b;font-style:italic;margin-top:2px;">“${htmlEscape(r.quote)}”</div>` : ""
              }</li>`,
          )
          .join("")}</ol>`
      : "";

  const pitchHtml = row.edstellar_pitch
    ? `<h3 style="font-size:13px;margin:20px 0 6px;color:#0f172a;">Edstellar pitch</h3><p style="margin:0;color:#334155;font-size:13px;line-height:1.5;">${htmlEscape(row.edstellar_pitch)}</p>`
    : "";

  const noteHtml = note
    ? `<div style="background:#fff7ed;border-left:3px solid #f97316;padding:10px 12px;margin:0 0 18px;font-size:13px;color:#7c2d12;"><strong>${htmlEscape(fromName)} wrote:</strong><br/>${htmlEscape(note).replace(/\n/g, "<br/>")}</div>`
    : "";

  const link = `${appUrl}/suggestions/${row.id}`;

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px;">
<table style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;width:100%;border-collapse:collapse;">
  <tr><td style="padding:24px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.16em;color:#f97316;font-weight:600;">
      Edstellar Course Agent · shared with you by ${htmlEscape(fromName)}
    </div>
    <h1 style="font-size:20px;margin:8px 0 4px;color:#0f172a;">${title}</h1>
    <div style="color:#475569;font-size:12px;">${category}${sub}</div>
    ${noteHtml ? `<div style="margin-top:18px;">${noteHtml}</div>` : ""}

    <table style="width:100%;margin-top:18px;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:6px 0;color:#64748b;width:140px;">Suggested price</td><td style="padding:6px 0;color:#0f172a;"><strong>${price}</strong> ${row.price_basis ? `<span style="color:#64748b;">· ${htmlEscape(row.price_basis)}</span>` : ""}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Duration</td><td style="padding:6px 0;color:#0f172a;">${duration}</td></tr>
      ${row.target_audience ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top;">Audience</td><td style="padding:6px 0;color:#0f172a;">${htmlEscape(row.target_audience)}</td></tr>` : ""}
    </table>

    ${row.rationale ? `<h3 style="font-size:13px;margin:20px 0 6px;color:#0f172a;">Why this matters</h3><p style="margin:0;color:#334155;font-size:13px;line-height:1.5;">${htmlEscape(row.rationale)}</p>` : ""}

    ${pitchHtml}
    ${outlineHtml}
    ${refsHtml}

    <div style="margin-top:24px;">
      <a href="${link}" style="display:inline-block;background:#1e40af;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">Open in the agent dashboard</a>
    </div>

    <p style="margin-top:22px;color:#94a3b8;font-size:11px;line-height:1.5;">
      You're receiving this because someone at Edstellar manually shared a course suggestion with you.
      Reply to this email to discuss — replies don't reach the dashboard.
    </p>
  </td></tr>
</table>
</body></html>`;
}

/** App URL preference: explicit env, else assume the live host. */
function deriveAppUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit && /^https?:\/\//.test(explicit)) {
    return explicit.replace(/\/$/, "");
  }
  return "https://course-agent-nine.vercel.app";
}

export type SendSuggestionResult =
  | { ok: true; to: string }
  | { ok: false; error: string };

/**
 * Share a single suggestion by email. Renders an HTML body from the
 * suggestion's columns and POSTs to the existing GAS relay (same
 * pipeline as the digest). The reviewer must be signed in; the email
 * recipient is whoever the operator types into the modal — no admin
 * gate, but every send is audit-logged with both addresses.
 */
export async function emailSuggestion(args: {
  suggestionId: string;
  to: string;
  note: string;
}): Promise<SendSuggestionResult> {
  const to = args.to.trim().toLowerCase();
  if (!EMAIL_RE.test(to)) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }

  const e = env();
  if (!e.GAS_EMAIL_WEBHOOK_URL || !e.GAS_EMAIL_SHARED_SECRET) {
    return {
      ok: false,
      error:
        "Email relay not configured — set GAS_EMAIL_WEBHOOK_URL + GAS_EMAIL_SHARED_SECRET on Vercel.",
    };
  }

  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: row, error: rowErr } = await supabase
    .from("suggestions")
    .select(
      "id,title,category,proposed_subcategory,rationale,target_audience,duration_days,duration_hours_min,duration_hours_max,suggested_price_usd,price_basis,edstellar_pitch,content_outline,references",
    )
    .eq("id", args.suggestionId)
    .maybeSingle();
  if (rowErr) return { ok: false, error: rowErr.message };
  if (!row) {
    return {
      ok: false,
      error: "Suggestion not found, or not visible to your account.",
    };
  }

  const fromName =
    (user.user_metadata?.full_name as string | undefined) ||
    user.email ||
    "an Edstellar reviewer";
  const subject = `Edstellar Course Agent — ${row.title ?? "course suggestion"}`;
  const html = renderSuggestionEmail({
    row: row as SuggestionEmailRow,
    fromName,
    note: args.note.trim() ? args.note.trim() : null,
    appUrl: deriveAppUrl(),
  });

  let relayResp: Response;
  try {
    relayResp = await fetch(e.GAS_EMAIL_WEBHOOK_URL, {
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
  } catch (err) {
    return {
      ok: false,
      error: `GAS relay unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  // GAS returns 200 with either {ok:true} or {error:"..."}; treat both.
  const body = (await relayResp.json().catch(() => null)) as
    | { ok?: boolean; success?: boolean; error?: string }
    | null;
  const ok =
    relayResp.ok && (body?.ok === true || body?.success === true);
  if (!ok) {
    return {
      ok: false,
      error: body?.error ?? `GAS relay HTTP ${relayResp.status}`,
    };
  }

  await logAdminAction({
    action: "suggestion.email_sent",
    targetType: "suggestions",
    targetId: args.suggestionId,
    payload: { to, has_note: args.note.trim().length > 0 },
  });

  return { ok: true, to };
}

/**
 * Daily digest HTML + subject renderers.
 *
 * Two pure functions, no IO. The route handler at
 * `/api/internal/run-complete` calls these, then POSTs the result
 * to the GAS relay.
 *
 * Inline styles only — Gmail strips `<style>` blocks. Table-based
 * layout because CSS-grid in email is still flaky in Outlook
 * desktop in 2026. Hard-coded brand colours match the app palette
 * so the email reads as "from the same product".
 *
 * Stays a plain string template (no React Email) to keep the dep
 * list short. Phase 9 can graduate this if multiple templates
 * emerge.
 */

const COLOURS = {
  navy: "#1a2540",
  navyDeep: "#0f1729",
  orange: "#f97316",
  red: "#dc2626",
  green: "#16a34a",
  amber: "#d97706",
  offWhite: "#fafaf9",
  gray100: "#f3f4f6",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray500: "#6b7280",
  gray700: "#374151",
  gray800: "#1f2937",
  white: "#ffffff",
} as const;

export interface DigestPreviewItem {
  id: string;
  title: string;
  category: string;
  suggestedPriceUsd: number;
  durationDays: number;
}

export interface DigestProps {
  /** UUID of the agent_runs row this digest was triggered by. */
  runId: string;
  /** ISO timestamp from agent_runs.finished_at. */
  finishedAt: string;
  /** Model slug — e.g. "deepseek/deepseek-chat-v3.1". */
  modelUsed: string;
  /** From agent_runs.categories_targeted. */
  categoriesTargeted: string[];
  /** From agent_runs.candidates_persisted — survivors of THIS run. */
  candidatesPersisted: number;
  /** Count across all `pending_review` suggestions, including carryover. */
  pendingTotal: number;
  /** 0..1, computed across the last 7 days of feedback. */
  approvalRate7d: number;
  /** Up to 6 suggestion summaries to inline in the email body. */
  preview: DigestPreviewItem[];
  /** Reviewer first name; falls back to "there" if empty. */
  reviewerName: string;
  /** App base URL — e.g. "https://app.edstellar.com" or "http://localhost:3000". */
  appUrl: string;
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

const fmtTimeUtc = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );

/** Run-id prefix used in the subject. Keeps the line scannable. */
function runShortId(runId: string): string {
  return runId.slice(0, 8);
}

export function renderDigestSubject(p: DigestProps): string {
  const n = p.candidatesPersisted;
  const noun = n === 1 ? "suggestion" : "suggestions";
  return n > 0
    ? `Course Agent — ${n} new ${noun} [run ${runShortId(p.runId)}]`
    : `Course Agent — agent ran, no new suggestions [run ${runShortId(p.runId)}]`;
}

/**
 * Render the digest HTML. Single-column, 600px wide table layout
 * with inline styles. Tested-by-eye in Gmail web + Outlook web.
 *
 * Returns a complete HTML document (with `<!doctype html>`) so the
 * GAS relay can pass the string straight to ``MailApp.sendEmail``'s
 * ``htmlBody`` field without further wrapping.
 */
export function renderDigestHtml(p: DigestProps): string {
  const name = p.reviewerName?.trim() || "there";
  const reviewLink = `${p.appUrl.replace(/\/$/, "")}/suggestions/today`;
  const isEmptyRun = p.candidatesPersisted === 0;

  const cardsHtml = isEmptyRun
    ? renderEmptyQueuePanel(p)
    : p.preview.map(renderSuggestionCard).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(renderDigestSubject(p))}</title>
</head>
<body style="margin:0;padding:0;background:${COLOURS.gray100};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLOURS.gray800};">
  <!-- Preheader: hidden on render, shown in the inbox preview. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(
      isEmptyRun
        ? `Agent run ${runShortId(p.runId)} produced no new suggestions today.`
        : `${p.candidatesPersisted} new suggestion${p.candidatesPersisted === 1 ? "" : "s"} from agent run ${runShortId(p.runId)} — review at /suggestions/today`,
    )}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLOURS.gray100};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${COLOURS.white};border:1px solid ${COLOURS.gray200};border-radius:8px;overflow:hidden;">

          <!-- Header strip -->
          <tr>
            <td style="background:${COLOURS.navyDeep};padding:20px 28px;color:${COLOURS.white};">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:${COLOURS.orange};">
                Course Agent · daily digest
              </div>
              <div style="margin-top:4px;font-size:20px;font-weight:600;line-height:1.3;">
                Hi ${escapeHtml(name)},
              </div>
              <div style="margin-top:6px;font-size:14px;color:#cbd5e1;line-height:1.5;">
                Agent run <span style="font-family:'SF Mono',Consolas,Menlo,monospace;color:${COLOURS.white};">${escapeHtml(runShortId(p.runId))}</span>
                finished at <strong>${escapeHtml(fmtTimeUtc(p.finishedAt))}</strong>.
                ${
                  isEmptyRun
                    ? "No new candidates survived all 10 rules — see below."
                    : `${p.candidatesPersisted} new candidate${p.candidatesPersisted === 1 ? "" : "s"} ${p.candidatesPersisted === 1 ? "is" : "are"} waiting on you.`
                }
              </div>
            </td>
          </tr>

          <!-- KPI strip -->
          <tr>
            <td style="background:${COLOURS.offWhite};padding:16px 28px;border-bottom:1px solid ${COLOURS.gray200};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="50%" style="padding-right:8px;vertical-align:top;">
                    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:${COLOURS.gray500};">
                      Pending review
                    </div>
                    <div style="margin-top:4px;font-size:24px;font-weight:700;color:${COLOURS.navyDeep};line-height:1;">
                      ${p.pendingTotal}
                    </div>
                    <div style="margin-top:4px;font-size:12px;color:${COLOURS.gray500};">
                      across all open suggestions
                    </div>
                  </td>
                  <td width="50%" style="padding-left:8px;vertical-align:top;">
                    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:${COLOURS.gray500};">
                      7-day approval rate
                    </div>
                    <div style="margin-top:4px;font-size:24px;font-weight:700;color:${COLOURS.navyDeep};line-height:1;">
                      ${fmtPct(p.approvalRate7d)}
                    </div>
                    <div style="margin-top:4px;font-size:12px;color:${COLOURS.gray500};">
                      trailing window
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Run metadata -->
          <tr>
            <td style="padding:14px 28px 0 28px;font-size:12px;color:${COLOURS.gray500};line-height:1.6;">
              <strong style="color:${COLOURS.gray700};">Model:</strong>
              <span style="font-family:'SF Mono',Consolas,Menlo,monospace;">${escapeHtml(p.modelUsed)}</span>
              &nbsp;·&nbsp;
              <strong style="color:${COLOURS.gray700};">Categories targeted:</strong>
              ${p.categoriesTargeted.length > 0 ? escapeHtml(p.categoriesTargeted.join(", ")) : "<em>(none)</em>"}
            </td>
          </tr>

          <!-- Suggestion cards OR empty-queue panel -->
          <tr>
            <td style="padding:16px 28px 4px 28px;">
              ${cardsHtml}
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td align="center" style="padding:8px 28px 24px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:${COLOURS.navy};border-radius:6px;">
                    <a href="${escapeHtml(reviewLink)}"
                       style="display:inline-block;padding:12px 22px;color:${COLOURS.white};font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">
                      ${isEmptyRun ? "Open today's queue →" : "Review now →"}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${COLOURS.offWhite};padding:16px 28px;border-top:1px solid ${COLOURS.gray200};font-size:11px;color:${COLOURS.gray500};line-height:1.5;">
              Course Agent · run <span style="font-family:'SF Mono',Consolas,Menlo,monospace;">${escapeHtml(p.runId)}</span><br>
              Reply to this email if anything looks off — it lands in the marketing inbox.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderSuggestionCard(item: DigestPreviewItem): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       style="margin:8px 0;border:1px solid ${COLOURS.gray200};border-radius:6px;background:${COLOURS.white};">
  <tr>
    <td style="padding:12px 14px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:${COLOURS.gray400};">
        ${escapeHtml(item.category)}
      </div>
      <div style="margin-top:4px;font-size:15px;font-weight:600;color:${COLOURS.navyDeep};line-height:1.4;">
        ${escapeHtml(item.title)}
      </div>
      <div style="margin-top:6px;font-size:12px;color:${COLOURS.gray500};">
        <span style="font-family:'SF Mono',Consolas,Menlo,monospace;color:${COLOURS.navyDeep};font-weight:600;">${escapeHtml(fmtUsd(item.suggestedPriceUsd))}</span>
        &nbsp;·&nbsp; ${item.durationDays}-day instructor-led
      </div>
    </td>
  </tr>
</table>`;
}

function renderEmptyQueuePanel(p: DigestProps): string {
  const targeted =
    p.categoriesTargeted.length > 0
      ? escapeHtml(p.categoriesTargeted.join(", "))
      : "any categories";
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       style="margin:8px 0;border:1px dashed ${COLOURS.gray200};border-radius:6px;background:${COLOURS.offWhite};">
  <tr>
    <td style="padding:24px 18px;text-align:center;">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:${COLOURS.orange};">
        No new suggestions today
      </div>
      <div style="margin-top:8px;font-size:15px;font-weight:600;color:${COLOURS.navyDeep};line-height:1.4;">
        The agent ran, but nothing survived all 10 rules.
      </div>
      <div style="margin-top:8px;font-size:13px;color:${COLOURS.gray500};line-height:1.6;">
        Targeted ${targeted}. Likely causes: the category is already saturated,
        references didn't verify, or candidates duplicated existing courses.
        Check the queue for carryover candidates that still need a decision.
      </div>
    </td>
  </tr>
</table>`;
}

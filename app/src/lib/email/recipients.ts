/**
 * Static reviewer recipient list for the daily digest.
 *
 * Phase 7 hard-codes this. Phase 8 will move the list into a DB
 * table managed via the `/settings` admin page so admins can add /
 * remove reviewers without a deploy.
 *
 * Override via the `DIGEST_RECIPIENTS_OVERRIDE` env var when
 * testing — comma-separated emails go to that recipient instead.
 * Keeps dev runs from spamming real reviewers at 2am.
 */

const DEFAULT_RECIPIENTS = ["marketing@edstellar.com"] as const;

export function digestRecipients(): string[] {
  const override = process.env.DIGEST_RECIPIENTS_OVERRIDE?.trim();
  if (override) {
    return override
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [...DEFAULT_RECIPIENTS];
}

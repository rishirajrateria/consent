import "server-only";
import { db } from "./db";

/**
 * Admin-editable message templates (admin → Templates). A template with a
 * matching key overrides the built-in copy; {{placeholders}} are substituted.
 * Keys in use: otp_email, otp_sms, signature_otp_email, invite_email.
 */
export async function renderMessage(
  key: string,
  fallback: { subject?: string; body: string },
  vars: Record<string, string> = {}
): Promise<{ subject?: string; body: string }> {
  const row = await db.messageTemplate.findUnique({ where: { key } }).catch(() => null);
  const subject = row?.subject ?? fallback.subject;
  const body = row?.body || fallback.body;
  const fill = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
  return { subject: subject ? fill(subject) : undefined, body: fill(body) };
}

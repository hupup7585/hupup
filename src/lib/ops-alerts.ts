import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";

/**
 * Problem alerts for the Owner (gap review, Abraham, Nov 26, 2026): a payment callback that failed or could not be
 * matched, and a daily count of texts and emails that failed. Staff-only emails (never to customers), logged in the
 * activity log. Free: uses the email sender already set up. No card details, message bodies or codes in any alert.
 */
export async function alertOwner(subject: string, body: string, entity: { type: string; id: string } = { type: "system", id: "0" }) {
  await db.insert(schema.auditLog).values({ action: "ops.alert", entityType: entity.type, entityId: entity.id, after: { subject, body } }).catch(() => null);
  const to = config.adminEmail();
  if (!to) return false;
  const r = await sendEmail(to, `Hup Up Attractions: ${subject}`, `${body}\n\nDetails are in Admin > System status.\n${config.baseUrl()}/admin/status`).catch(() => ({ sent: false }));
  return r.sent;
}

/**
 * A payment callback (Sola or Stripe) that throws: the Owner is emailed, and the provider gets a 500 so it tries
 * again later (both retry failed webhooks), so no payment is lost.
 */
export async function withCallbackAlert(name: string, handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    const msg = ((e as Error)?.message ?? String(e)).slice(0, 300);
    console.error(`[${name}] failed:`, msg);
    await alertOwner(`a ${name} payment notice failed`, `The ${name} payment notice could not be processed: ${msg}\n\nThe payment provider will send it again. If it keeps failing, check the order in Admin.`, { type: "payment_callback", id: name }).catch(() => null);
    return new Response("error", { status: 500 });
  }
}

/** Phone numbers in alerts: the last 4 digits only. */
const last4 = (phone: string | null | undefined) => (phone ? `ending ${String(phone).replace(/\D/g, "").slice(-4)}` : "unknown");

/**
 * The daily report of what failed to send in the last 24 hours (texts and emails), to the Owner only when something
 * failed. Returns the counts (the daily job log keeps them).
 */
export async function failedSendsReport(now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const texts = await db
    .select({ to: schema.messages.contactPhone, code: schema.messages.errorCode, err: schema.messages.errorMessage, at: schema.messages.createdAt })
    .from(schema.messages)
    // Extra check G3 (Nov 27, 2026): carrier rejections come back as "undelivered" (30003, 30007...), the most common
    // real failure; and a held text that failed today counts even if it was written days ago (send_after = when sent)
    .where(and(eq(schema.messages.direction, "out"), inArray(schema.messages.status, ["failed", "undelivered"]), or(gte(schema.messages.createdAt, since), gte(schema.messages.sendAfter, since))));
  const emails = await db
    .select({ to: schema.inboxReplies.toAddress, err: schema.inboxReplies.error, subject: schema.inboxReplies.subject })
    .from(schema.inboxReplies)
    .where(and(eq(schema.inboxReplies.sent, false), gte(schema.inboxReplies.createdAt, since), sql`${schema.inboxReplies.subject} NOT LIKE 'Hup Up Attractions: % failed%'`));
  if (texts.length || emails.length) {
    const lines = [
      `In the last 24 hours ${texts.length} text${texts.length === 1 ? "" : "s"} and ${emails.length} email${emails.length === 1 ? "" : "s"} could not be sent.`,
      ...texts.slice(0, 20).map((t) => `Text to the number ${last4(t.to)}: ${t.code ? `error ${t.code}` : (t.err ?? "failed").slice(0, 120)}`),
      ...emails.slice(0, 20).map((m) => `Email "${(m.subject ?? "").slice(0, 80)}": ${(m.err ?? "not sent").slice(0, 120)}`),
    ];
    await alertOwner("texts or emails failed to send", lines.join("\n"), { type: "messages", id: "daily" });
  }
  return { texts: texts.length, emails: emails.length };
}

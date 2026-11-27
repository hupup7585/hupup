import { BUSINESS_NAME, config } from "@/lib/config";
import { NO_TEXT_CONSENT, sendMessage, type SendInput } from "@/lib/sms";

export type SendResult = { sent: boolean; dev?: boolean; error?: string; blocked?: string };

/** Send a text. All texts go through sendMessage (logged, consent and opt-out aware). */
export async function sendSms(to: string, body: string, opts: Omit<SendInput, "to" | "body"> = {}): Promise<SendResult> {
  const r = await sendMessage({ to, body, ...opts });
  return { sent: r.sent, dev: r.dev, error: r.error, blocked: r.blocked };
}

/**
 * Order/service text with the required fallback: if the customer has no order-text consent, don't text; email
 * when there is an address; otherwise report "No text consent; call or email." for staff.
 */
export async function sendOrderText(input: { phone: string; email?: string | null; subject: string; body: string; orderId?: number | null; customerId?: number | null; userId?: number | null; event: string; mediaUrls?: string[] }): Promise<{ texted: boolean; emailed: boolean; message: string }> {
  const r = await sendSms(input.phone, input.body, { kind: "transactional", event: input.event, orderId: input.orderId, customerId: input.customerId, userId: input.userId, ...(input.mediaUrls?.length ? { mediaUrls: input.mediaUrls } : {}) });
  if (r.sent) return { texted: true, emailed: false, message: "Texted" };
  if (r.blocked === "no_transactional_consent" || r.blocked === "opted_out") {
    if (input.email) {
      const e = await sendEmail(input.email, input.subject, input.body);
      if (e.sent) return { texted: false, emailed: true, message: "No text consent: emailed instead." };
    }
    return { texted: false, emailed: false, message: NO_TEXT_CONSENT };
  }
  return { texted: false, emailed: false, message: r.error || "SMS failed" };
}

/**
 * Sender for every email (Abraham, Nov 12, 2026): "Hup Up Attractions <info@hupupattractions.com>" (EMAIL_FROM in
 * Vercel; hupupattractions.com is verified in Resend), and replies always go to info@. The catalog auto-reply and
 * replies from the Admin info@ inbox use this same sender.
 */
export const EMAIL_SENDER = `${BUSINESS_NAME} <info@hupupattractions.com>`;
export const EMAIL_REPLY_TO = "info@hupupattractions.com";

export function emailEnvelope(to: string, env: Record<string, string | undefined> = process.env) {
  return { from: env.EMAIL_FROM || EMAIL_SENDER, reply_to: EMAIL_REPLY_TO, to };
}

export type EmailAttachment = { filename: string; content: string /* base64 */ };
/** Where a sent email is kept in the Admin inbox (Abraham, Nov 20, 2026): code, catalog, or auto (the default). */
export type SentKind = "code" | "catalog" | "auto" | "backup";

export async function sendEmail(to: string, subject: string, text: string, attachments: EmailAttachment[] = [], opts: { headers?: Record<string, string>; record?: boolean; promo?: boolean; noThanks?: boolean; bodyHtml?: string | null; kind?: SentKind; button?: { label: string; url: string } | null } = {}): Promise<SendResult> {
  // Item 7 (Nov 25, 2026): never the dev domain or a test link in a customer email
  {
    const { customerSafe } = await import("@/lib/sms");
    const t = customerSafe(text);
    const h = opts.bodyHtml ? customerSafe(opts.bodyHtml) : null;
    const b = opts.button ? customerSafe(opts.button.url) : null;
    if (t.blocked || h?.blocked || b?.blocked) return { sent: false, error: "Email contains a test payment link and was not sent." };
    text = t.body;
    opts = { ...opts, bodyHtml: h ? h.body : opts.bodyHtml, button: opts.button && b ? { ...opts.button, url: b.body } : opts.button };
  }
  if (!config.resendConfigured()) {
    if (config.isProd()) return { sent: false, error: "Email (Resend) is not configured" };
    console.log(`[dev EMAIL to ${to}] ${subject}\n${text}${opts.button ? `\n[button: ${opts.button.label} ${opts.button.url}]` : ""}${attachments.length ? `\n[attachments: ${attachments.map((a) => a.filename).join(", ")}]` : ""}`);
    return { sent: true, dev: true };
  }
  try {
    // Logo and signature on every email (Abraham, Nov 17, 2026): HTML with the hosted logo, plus a plain-text version
    const { brandedEmail } = await import("@/lib/email-brand");
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings().catch(() => null);
    let promo: { address: string; unsubscribeUrl: string } | undefined;
    if (opts.promo) {
      // Promotional emails: never to an address that unsubscribed; the address and Unsubscribe link at the bottom
      const { db, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const [gone] = await db.select().from(schema.emailUnsubscribes).where(eq(schema.emailUnsubscribes.email, to.trim().toLowerCase())).limit(1);
      if (gone) return { sent: false, error: "This address unsubscribed from promotional emails." };
      const { unsubscribeLink } = await import("@/lib/signed-link");
      promo = { address: String(s?.emailMailingAddress ?? ""), unsubscribeUrl: unsubscribeLink(to.trim(), config.siteUrl()) };
      opts = { ...opts, headers: { ...(opts.headers ?? {}), "List-Unsubscribe": `<${promo.unsubscribeUrl.replace("/unsubscribe?", "/api/unsubscribe?")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
    }
    const { cleanEmailHtml } = await import("@/lib/email-format");
    const branded = brandedEmail(text, { baseUrl: config.siteUrl(), signature: s?.emailSignature ?? null, promo, noThanks: opts.noThanks, bodyHtml: opts.bodyHtml ? cleanEmailHtml(opts.bodyHtml) : null, button: opts.button ?? null });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...emailEnvelope(to),
        subject,
        text: branded.text,
        html: branded.html,
        ...(attachments.length ? { attachments } : {}),
        ...(opts.headers ? { headers: opts.headers } : {}),
      }),
    });
    const result: SendResult = res.ok ? { sent: true } : { sent: false, error: `Resend ${res.status}: ${await res.text()}` };
    // Every email sent from info@ is kept in the Admin inbox under Sent, with its files (Abraham, Nov 17, 2026, item 10).
    // The Admin inbox's own replies and new emails save themselves (record: false).
    if (opts.record !== false) {
      const { recordSentEmail } = await import("@/lib/inbox");
      await recordSentEmail({ to, subject, body: text, attachments, sent: result.sent, error: result.error ?? null, kind: opts.kind }).catch((e) => console.error("could not keep the sent copy", e));
    }
    return result;
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

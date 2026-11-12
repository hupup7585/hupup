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
export async function sendOrderText(input: { phone: string; email?: string | null; subject: string; body: string; orderId?: number | null; customerId?: number | null; userId?: number | null; event: string }): Promise<{ texted: boolean; emailed: boolean; message: string }> {
  const r = await sendSms(input.phone, input.body, { kind: "transactional", event: input.event, orderId: input.orderId, customerId: input.customerId, userId: input.userId });
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

export async function sendEmail(to: string, subject: string, text: string, attachments: EmailAttachment[] = [], opts: { headers?: Record<string, string> } = {}): Promise<SendResult> {
  if (!config.resendConfigured()) {
    if (config.isProd()) return { sent: false, error: "Email (Resend) is not configured" };
    console.log(`[dev EMAIL to ${to}] ${subject}\n${text}${attachments.length ? `\n[attachments: ${attachments.map((a) => a.filename).join(", ")}]` : ""}`);
    return { sent: true, dev: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...emailEnvelope(to),
        subject,
        text,
        ...(attachments.length ? { attachments } : {}),
        ...(opts.headers ? { headers: opts.headers } : {}),
      }),
    });
    if (!res.ok) return { sent: false, error: `Resend ${res.status}: ${await res.text()}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

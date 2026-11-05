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

export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  if (!config.resendConfigured()) {
    if (config.isProd()) return { sent: false, error: "Email (Resend) is not configured" };
    console.log(`[dev EMAIL to ${to}] ${subject}\n${text}`);
    return { sent: true, dev: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || `${BUSINESS_NAME} <onboarding@resend.dev>`,
        to,
        subject,
        text,
      }),
    });
    if (!res.ok) return { sent: false, error: `Resend ${res.status}: ${await res.text()}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

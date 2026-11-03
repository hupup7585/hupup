import { BUSINESS_NAME, config } from "@/lib/config";
import { sendMessage, type SendInput } from "@/lib/sms";

export type SendResult = { sent: boolean; dev?: boolean; error?: string };

/** Send a text. All texts go through sendMessage (logged, opt-out aware). */
export async function sendSms(to: string, body: string, opts: Omit<SendInput, "to" | "body"> = {}): Promise<SendResult> {
  const r = await sendMessage({ to, body, ...opts });
  return { sent: r.sent, dev: r.dev, error: r.error };
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

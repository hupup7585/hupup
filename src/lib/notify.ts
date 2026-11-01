import twilio from "twilio";
import { BUSINESS_NAME, config } from "@/lib/config";

let client: ReturnType<typeof twilio> | null = null;
export function twilioClient() {
  if (!config.twilioConfigured()) return null;
  client ??= twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  return client;
}

export type SendResult = { sent: boolean; dev?: boolean; error?: string };

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const c = twilioClient();
  if (!c || !process.env.TWILIO_PHONE_NUMBER) {
    if (config.isProd()) return { sent: false, error: "Twilio is not configured" };
    console.log(`[dev SMS to ${to}] ${body}`);
    return { sent: true, dev: true };
  }
  try {
    await c.messages.create({ to, from: process.env.TWILIO_PHONE_NUMBER, body });
    return { sent: true };
  } catch (e) {
    console.error("SMS failed", e);
    return { sent: false, error: (e as Error).message };
  }
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

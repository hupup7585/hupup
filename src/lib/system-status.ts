import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { NEW_EMAIL_LIVE } from "@/lib/config";
import { SMS_TERMS_V2_LIVE } from "@/lib/sms-terms-v2";
import { PAY_ENV_NAMES, phonePayConfigured } from "@/lib/phone-pay";

/**
 * Abraham EE: "Everything should work and run real." This lists every feature that can't run for real yet because of
 * an outside blocker (shown as "Not active yet: <reason>" in Admin), and scans the database for simulated test data.
 * Read-only: nothing is changed or deleted here.
 */

export type Blocker = { key: string; area: string; active: boolean; reason: string; where: string };

export async function blockers(env: Record<string, string | undefined> = process.env): Promise<Blocker[]> {
  const s = await getSettings().catch(() => null);
  const twilio = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
  return [
    {
      key: "sms",
      area: "Text messages (SMS)",
      active: twilio && Boolean(env.TWILIO_MESSAGING_SERVICE_SID),
      reason: !twilio
        ? "Twilio account details are missing."
        : "Texts need Twilio business verification (KYC) and A2P 10DLC registration; then TWILIO_MESSAGING_SERVICE_SID is added in Vercel.",
      where: "/admin/messages",
    },
    {
      key: "payments",
      area: "Card payments (Sola payment links)",
      active: Boolean(env.SOLA_PAYMENTSITE_NAME && env.SOLA_WEBHOOK_PIN),
      reason: `Sola isn't connected yet: ${[!env.SOLA_PAYMENTSITE_NAME && "SOLA_PAYMENTSITE_NAME", !env.SOLA_WEBHOOK_PIN && "SOLA_WEBHOOK_PIN"].filter(Boolean).join(" and ")} must be added in Vercel.`,
      where: "/admin/bookkeeping?tab=processor",
    },
    {
      key: "email",
      area: "Owner sign-in code by email",
      active: Boolean(env.RESEND_API_KEY),
      reason: "The email sender isn't set up (RESEND_API_KEY in Vercel).",
      where: "/admin/login",
    },
    {
      key: "keypad-pay",
      area: "Pay by keypad during the call (Stripe)",
      active: false,
      reason: phonePayConfigured(env)
        ? "Owner test calls only (Stripe test mode). Goes live for every caller after Abraham approves the pay prompts and a real test payment."
        : `Needs the payment subaccount in Vercel: ${PAY_ENV_NAMES.filter((k) => !env[k]).join(", ")} (and TWILIO_PAY_CONNECTOR if the Stripe connector isn't named Stripe_Connector).`,
      where: "/admin/phone/prompts",
    },
    {
      key: "google-voice",
      area: "Google voice recordings (pre-made phone lines)",
      active: Boolean(env.GOOGLE_TTS_API_KEY),
      reason: "Needs Google Cloud billing (with a $0 budget alert) and a Text-to-Speech key (GOOGLE_TTS_API_KEY). Until then the phone speaks the Twilio Google voice live.",
      where: "/admin/phone/prompts",
    },
    {
      key: "info-catalog",
      area: "Catalog auto-reply to info@ emails",
      active: false,
      reason: "Waiting for Abraham to approve the reply wording and the Cloudflare Email Worker DNS change.",
      where: "/admin/catalog",
    },
    {
      key: "sms-catalog",
      area: "Text CATALOG to the hotline for an automatic reply",
      active: false,
      reason: "Waiting for Twilio to approve texting (A2P 10DLC).",
      where: "/admin/messages",
    },
    {
      key: "speech-text",
      area: "Spoken answers typed up and read back (speech to text)",
      active: false,
      reason: "Has a per-use charge; waiting for Abraham's yes on the price per call.",
      where: "/admin/phone/prompts",
    },
    {
      key: "recording",
      area: "Call recording",
      active: Boolean(s?.callRecording),
      reason: "Off until Abraham approves the recording notice wording and turns it on himself (Phone settings).",
      where: "/admin/phone/settings",
    },
    {
      key: "info-email",
      area: "info@hupupattractions.com on the website",
      active: NEW_EMAIL_LIVE,
      reason: "Waiting for Cloudflare Email Routing to forward info@ to the Gmail address and a test email to arrive.",
      where: "/",
    },
    {
      key: "photos",
      area: "Delivery photos (Cloudflare R2)",
      active: Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET),
      reason: "Needs a free Cloudflare R2 bucket and its API keys (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) in Vercel.",
      where: "/admin/deliveries",
    },
    {
      key: "sms-terms-v2",
      area: "SMS Terms Version 2",
      active: SMS_TERMS_V2_LIVE,
      reason: "On the preview site only, waiting for Abraham's approval of the text.",
      where: "/sms-terms",
    },
  ];
}

export async function blocker(key: string) {
  return (await blockers()).find((b) => b.key === key) ?? null;
}

export type TestDataFinding = { table: string; label: string; ids: (string | number)[] };

/**
 * Simulated test data looks like: 555-01xx phone numbers (reserved for fiction), call/message ids that aren't real
 * Twilio ids (real ones are CA/SM + 32 hex characters), example.com emails, and the test sign-in numbers.
 */
export async function scanForTestData(): Promise<TestDataFinding[]> {
  const q = async (table: string, label: string, query: ReturnType<typeof sql>) => {
    try {
      const rows = (await db.execute(query)).rows as { id: string | number }[];
      return rows.length ? [{ table, label, ids: rows.map((r) => r.id) }] : [];
    } catch {
      return [];
    }
  };
  const fake = `^\\+1\\d{3}55501\\d{2}$`;
  return [
    ...(await q("customers", "Customers with a 555-01xx test number", sql`SELECT id FROM customers WHERE phone ~ ${fake} ORDER BY id`)),
    ...(await q("customers", "Customers with an example.com email", sql`SELECT id FROM customers WHERE email ILIKE '%@example.%' ORDER BY id`)),
    ...(await q("orders", "Bookings for those test customers", sql`SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone ~ ${fake} OR c.email ILIKE '%@example.%' ORDER BY o.id`)),
    ...(await q("call_sessions", "Calls that didn't come from Twilio (test call ids)", sql`SELECT call_sid AS id FROM call_sessions WHERE call_sid !~ '^CA[0-9a-f]{32}$' ORDER BY started_at`)),
    ...(await q("call_sessions", "Calls from 555-01xx test numbers", sql`SELECT call_sid AS id FROM call_sessions WHERE from_number ~ ${fake} ORDER BY started_at`)),
    ...(await q("messages", "Texts with test numbers", sql`SELECT id FROM messages WHERE contact_phone ~ ${fake} ORDER BY id`)),
    ...(await q("sms_consents", "Text consent records for test numbers", sql`SELECT id FROM sms_consents WHERE phone ~ ${fake} ORDER BY id`)),
    ...(await q("admin_users", "Staff accounts with test numbers", sql`SELECT id FROM admin_users WHERE phone ~ ${fake} ORDER BY id`)),
    ...(await q("voicemails", "Voicemails from test numbers", sql`SELECT id FROM voicemails WHERE from_number ~ ${fake} ORDER BY id`)),
  ];
}

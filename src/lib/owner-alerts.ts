import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { formatPhone, toE164 } from "@/lib/phone";
import { sendEmail, sendSms } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { alertDateTime, mainBox, textingActive } from "@/lib/voicemail";

/**
 * Owner alerts (Abraham, Nov 9, 2026) besides voicemail: missed calls and incoming texts. Sent to the Main voicemail
 * box's alert addresses (Voicemail settings): by email now, by text too once Twilio approves texting (A2P).
 */
async function callerWho(phone: string | null) {
  if (!phone) return "a withheld number";
  const e = toE164(phone);
  const [c] = e ? await db.select({ name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.phone, e)).limit(1) : [];
  return c?.name ? `${c.name} ${formatPhone(phone)}` : formatPhone(phone);
}

/** Which key the caller pressed last, in words, e.g. "Key 0 (no one answered)". */
export function missedKey(data: { menuKeys?: string[]; missed?: string } | null | undefined): string {
  const k = data?.menuKeys?.at(-1);
  if (!k) return "before choosing a key";
  if (data?.missed === "closed") return `Key ${k} (office closed)`;
  if (data?.missed === "no_answer") return `Key ${k} (no one answered)`;
  if (data?.missed === "rejected") return `Key ${k} (staff pressed 2)`;
  return `Key ${k}`;
}

/**
 * Missed call: the caller reached voicemail and hung up without a message, or hung up while the staff phone was
 * ringing. One alert per call; a call that left a voicemail gets the voicemail alert instead.
 */
export async function alertMissedCall(input: { callSid: string; from: string | null; at: Date; how: "voicemail_no_message" | "hung_up_ringing"; data: { menuKeys?: string[]; missed?: string } | null }) {
  const s = await getSettings();
  if (!s.missedCallAlerts) return { sent: 0 };
  const box = await mainBox();
  const who = await callerWho(input.from);
  const when = alertDateTime(input.at);
  const what = input.how === "voicemail_no_message" ? "reached voicemail and hung up without leaving a message" : "hung up while the phone was ringing";
  const key = missedKey(input.data);
  const subject = `Missed call from ${who}, ${when}`;
  const body = [`Missed call to ${BUSINESS_NAME}.`, "", `Caller: ${who}`, `Key: ${key}`, `Date and time: ${when}`, `What happened: the caller ${what}.`, "", `Call log: ${config.baseUrl()}/admin/calls`].join("\n");
  let sent = 0;
  for (const to of box.notifyEmail) if ((await sendEmail(to, subject, body)).sent) sent++;
  if (textingActive()) {
    const text = `${BUSINESS_NAME}: missed call from ${who}, ${key}, ${when}. The caller ${what}.`;
    for (const to of box.notifySms) if ((await sendSms(to, text, { kind: "system", event: "owner_alert" })).sent) sent++;
  }
  return { sent };
}

/** Incoming text to the hotline: email the sender's number and the full text, with any photos as links. */
export async function emailIncomingText(input: { from: string; body: string; mediaUrls: string[]; at: Date }) {
  const s = await getSettings();
  if (!s.incomingTextEmail) return { sent: 0 };
  const box = await mainBox();
  const who = await callerWho(input.from);
  const when = alertDateTime(input.at);
  const subject = `Text from ${who}, ${when}`;
  const body = [
    `New text to ${BUSINESS_NAME} (845) 415-7585.`,
    "",
    `From: ${who}`,
    `Date and time: ${when}`,
    "",
    input.body || "(no words, only a photo)",
    ...(input.mediaUrls.length ? ["", `Photos (${input.mediaUrls.length}): open them in Admin, Messages:`, `${config.baseUrl()}/admin/messages?p=${encodeURIComponent(input.from)}`] : []),
    "",
    `Reply in Admin: ${config.baseUrl()}/admin/messages?p=${encodeURIComponent(input.from)}`,
  ].join("\n");
  let sent = 0;
  for (const to of box.notifyEmail) if ((await sendEmail(to, subject, body)).sent) sent++;
  return { sent };
}

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatPhone, toE164 } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { sendMessage } from "@/lib/sms";

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
export const START_WORDS = ["START", "UNSTOP", "YES"];
export const HELP_WORDS = ["HELP", "INFO"];
export const NOPROMO_WORDS = ["NOPROMO"];

export type Keyword = "stop" | "start" | "help" | "nopromo" | null;

export function detectKeyword(body: string): Keyword {
  const w = body.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (STOP_WORDS.includes(w)) return "stop";
  if (START_WORDS.includes(w)) return "start";
  if (HELP_WORDS.includes(w)) return "help";
  if (NOPROMO_WORDS.includes(w)) return "nopromo";
  return null;
}

export type InboundResult = { messageId: number; keyword: Keyword; reply: string | null; forwarded: boolean };

/** Handle a Twilio inbound SMS/MMS webhook body (already signature-verified). */
export async function handleInboundSms(body: Record<string, string>): Promise<InboundResult> {
  const from = toE164(body.From) || body.From || "unknown";
  const text = body.Body ?? "";
  const numMedia = Number(body.NumMedia || 0);
  const mediaUrls = Array.from({ length: numMedia }, (_, i) => body[`MediaUrl${i}`]).filter(Boolean);

  // Duplicate webhook delivery: return the existing row.
  if (body.MessageSid) {
    const [dupe] = await db.select().from(schema.messages).where(eq(schema.messages.twilioSid, body.MessageSid));
    if (dupe) return { messageId: dupe.id, keyword: null, reply: null, forwarded: false };
  }

  // Match (or create) the customer by phone.
  let [customer] = await db.select().from(schema.customers).where(eq(schema.customers.phone, from)).limit(1);
  if (!customer && from.startsWith("+")) {
    [customer] = await db.insert(schema.customers).values({ phone: from, name: null }).returning();
  }

  const keyword = detectKeyword(text);
  const [row] = await db
    .insert(schema.messages)
    .values({
      direction: "in",
      fromNumber: from,
      toNumber: body.To ?? null,
      contactPhone: from,
      body: text,
      mediaUrls,
      kind: "inbound",
      event: keyword ? `keyword_${keyword}` : null,
      twilioSid: body.MessageSid ?? null,
      status: "received",
      customerId: customer?.id ?? null,
    })
    .returning({ id: schema.messages.id });

  const settings = await getSettings();
  let reply: string | null = null;

  if (customer && keyword) {
    const consent = (scope: string, action: string) =>
      db.insert(schema.smsConsents).values({ customerId: customer.id, phone: from, scope, action, source: "keyword", keyword: text.trim().toUpperCase() });
    if (keyword === "stop") {
      // Twilio blocks all messages after STOP, so both scopes are opted out.
      await db.update(schema.customers).set({ smsOptOut: true, marketingOptIn: false }).where(eq(schema.customers.id, customer.id));
      await consent("transactional", "opt_out");
      await consent("marketing", "opt_out");
    } else if (keyword === "start") {
      // Clears the block; marketing needs a new explicit opt-in.
      await db.update(schema.customers).set({ smsOptOut: false }).where(eq(schema.customers.id, customer.id));
      await consent("transactional", "opt_in");
    } else if (keyword === "nopromo") {
      await db.update(schema.customers).set({ marketingOptIn: false }).where(eq(schema.customers.id, customer.id));
      await consent("marketing", "opt_out");
      reply = "Hup Up Attractions: You won't receive promotional texts anymore. You'll still get booking and delivery updates. Reply STOP to stop all texts.";
    } else if (keyword === "help" && settings.smsHelpReplyEnabled) {
      reply = settings.smsHelpText;
    }
  }

  // Forward a copy to the owner (not for STOP/START, which Twilio handles, and not the owner's own texts).
  let forwarded = false;
  const fwd = toE164(settings.smsForwardPhone);
  if (settings.smsForwardEnabled && fwd && fwd !== from && keyword !== "stop" && keyword !== "start") {
    const who = customer?.name ? `${customer.name} ${formatPhone(from)}` : formatPhone(from);
    const r = await sendMessage({
      to: fwd,
      body: `Text to Hup Up Attractions from ${who}: ${text || "(no text)"}${mediaUrls.length ? ` [${mediaUrls.length} photo${mediaUrls.length > 1 ? "s" : ""}, see admin]` : ""}`,
      kind: "system",
      event: "owner_forward",
    });
    forwarded = r.sent;
  }

  return { messageId: row.id, keyword, reply, forwarded };
}

/** Twilio message status callback. */
export async function handleSmsStatus(body: Record<string, string>) {
  if (!body.MessageSid) return;
  await db
    .update(schema.messages)
    .set({
      status: body.MessageStatus || body.SmsStatus || "unknown",
      errorCode: body.ErrorCode || null,
      ...(body.ErrorCode ? { errorMessage: body.ErrorMessage || `Twilio error ${body.ErrorCode}` } : {}),
    })
    .where(eq(schema.messages.twilioSid, body.MessageSid));
}

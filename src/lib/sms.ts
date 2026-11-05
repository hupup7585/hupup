import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import { getTwilio } from "@/lib/twilio-client";
import { inRecipientPromoHours } from "@/lib/area-code-tz";
import { PROMO_OPENING } from "@/lib/sms-consent-copy";

export type MessageKind = "transactional" | "marketing" | "system";

export type SendInput = {
  to: string;
  body: string;
  mediaUrls?: string[];
  kind?: MessageKind;
  event?: string;
  customerId?: number | null;
  orderId?: number | null;
  callSid?: string | null;
  userId?: number | null;
  templateId?: number | null;
  /** false = don't store the body (sign-in codes). */
  log?: boolean;
  /** Test hook for the promotional quiet-hours check. */
  now?: Date;
};

export type SendResult = {
  sent: boolean;
  messageId?: number;
  sid?: string;
  dev?: boolean;
  blocked?: "opted_out" | "no_marketing_consent" | "card_number" | "quiet_hours";
  error?: string;
  /** MMS failed and we fell back to plain SMS */
  mmsFallback?: boolean;
};

/** True if text contains something that looks like a payment card number (13-19 digits passing Luhn). */
export function containsCardNumber(text: string): boolean {
  const candidates = text.match(/(?:\d[ -]?){13,19}/g) || [];
  return candidates.some((c) => {
    const d = c.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    return sum % 10 === 0;
  });
}

/**
 * Promotional texts go out only 8:00 AM - 9:00 PM in the recipient's local time, worked out from the
 * area code (New York time when unknown). See src/lib/area-code-tz.ts.
 */
export function inMarketingHours(to: string, now = new Date()): boolean {
  return inRecipientPromoHours(to, now);
}

/** Every promotional text begins with "Hup Up Attractions: Reply STOP to opt out." and then the offer. */
export function marketingBody(body: string): string {
  let offer = body.trim();
  if (offer.startsWith(PROMO_OPENING)) return offer;
  offer = offer.replace(/^hup up attractions\s*[:\-]\s*/i, "");
  offer = offer.replace(/\s*reply stop to opt out\.?\s*$/i, "");
  return `${PROMO_OPENING} ${offer}`.trim();
}

async function customerByPhone(phone: string) {
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  return c ?? null;
}

function senderParams(): { from?: string; messagingServiceSid?: string } {
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID };
  return { from: process.env.TWILIO_PHONE_NUMBER };
}

/**
 * The single way the app sends a text. Logs every message (content, type, who, links, status),
 * refuses opted-out numbers and card numbers, and falls back from MMS to SMS if media fails.
 */
export async function sendMessage(input: SendInput): Promise<SendResult> {
  const to = toE164(input.to);
  if (!to) return { sent: false, error: "Invalid phone number" };
  const kind = input.kind ?? "transactional";
  const log = input.log !== false;
  if (kind === "marketing") input = { ...input, body: marketingBody(input.body) };

  if (containsCardNumber(input.body)) {
    return { sent: false, blocked: "card_number", error: "Message looks like it contains a card number and was not sent." };
  }

  const customer = input.customerId
    ? (await db.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)))[0] ?? null
    : await customerByPhone(to);

  let blocked: SendResult["blocked"];
  if (kind !== "system" && customer?.smsOptOut) blocked = "opted_out";
  else if (kind === "marketing" && !customer?.marketingOptIn) blocked = "no_marketing_consent";
  else if (kind === "marketing" && !inMarketingHours(to, input.now)) blocked = "quiet_hours";

  let messageId: number | undefined;
  if (log) {
    const [row] = await db
      .insert(schema.messages)
      .values({
        direction: "out",
        fromNumber: process.env.TWILIO_PHONE_NUMBER ?? null,
        toNumber: to,
        contactPhone: to,
        body: input.body,
        mediaUrls: input.mediaUrls ?? [],
        kind,
        event: input.event ?? null,
        status: blocked ? "blocked" : "queued",
        errorMessage: blocked ? BLOCK_REASON[blocked] : null,
        customerId: customer?.id ?? null,
        orderId: input.orderId ?? null,
        callSid: input.callSid ?? null,
        userId: input.userId ?? null,
        templateId: input.templateId ?? null,
      })
      .returning({ id: schema.messages.id });
    messageId = row.id;
  }
  if (blocked) return { sent: false, blocked, messageId, error: BLOCK_REASON[blocked] };

  const client = getTwilio();
  if (!client || (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID)) {
    if (config.isProd()) {
      await markFailed(messageId, "config", "Twilio is not configured");
      return { sent: false, messageId, error: "Twilio is not configured" };
    }
    console.log(`[dev SMS to ${to}] ${log ? input.body : "(not logged)"}${input.mediaUrls?.length ? ` [media: ${input.mediaUrls.join(", ")}]` : ""}`);
    if (messageId) await db.update(schema.messages).set({ status: "dev" }).where(eq(schema.messages.id, messageId));
    return { sent: true, dev: true, messageId };
  }

  const statusCallback = `${config.baseUrl()}/api/sms/status`;
  const create = (mediaUrl?: string[]) =>
    client.messages.create({ to, body: input.body, ...senderParams(), statusCallback, ...(mediaUrl?.length ? { mediaUrl } : {}) });

  try {
    const msg = await create(input.mediaUrls);
    if (messageId) await db.update(schema.messages).set({ twilioSid: msg.sid, status: msg.status || "queued" }).where(eq(schema.messages.id, messageId));
    return { sent: true, sid: msg.sid, messageId };
  } catch (e) {
    const err = e as { code?: number | string; message?: string };
    if (input.mediaUrls?.length) {
      // MMS failed: keep the record of the failure, then send the same text without media.
      await markFailed(messageId, err.code, `MMS failed: ${err.message}`);
      const retry = await sendMessage({ ...input, mediaUrls: [] });
      return { ...retry, mmsFallback: true };
    }
    await markFailed(messageId, err.code, err.message);
    if (String(err.code) === "21610" && customer) {
      // Twilio says the recipient unsubscribed: mirror it.
      await db.update(schema.customers).set({ smsOptOut: true }).where(eq(schema.customers.id, customer.id));
    }
    return { sent: false, messageId, error: err.message || "SMS failed" };
  }
}

const BLOCK_REASON: Record<NonNullable<SendResult["blocked"]>, string> = {
  opted_out: "Customer replied STOP. Ask them to text START to receive messages again.",
  no_marketing_consent: "Customer has not opted in to promotional texts.",
  card_number: "Message looks like it contains a card number and was not sent.",
  quiet_hours: "Promotional texts can only be sent between 8 AM and 9 PM in the customer's local time.",
};

async function markFailed(messageId: number | undefined, code: unknown, message: string | undefined) {
  if (!messageId) return;
  await db
    .update(schema.messages)
    .set({ status: "failed", errorCode: code === undefined ? null : String(code), errorMessage: message ?? null })
    .where(eq(schema.messages.id, messageId));
}

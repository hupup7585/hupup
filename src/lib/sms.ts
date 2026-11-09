import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import { getTwilio } from "@/lib/twilio-client";
import { inRecipientPromoHours } from "@/lib/area-code-tz";
import { PROMOS_PER_YEAR, PROMO_ENDING_V2, PROMO_OPENING, PROMO_PREFIX_V2 } from "@/lib/sms-consent-copy";
import { smsTermsV2Active } from "@/lib/sms-terms-v2";

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
  blocked?: "opted_out" | "no_marketing_consent" | "no_transactional_consent" | "not_allowed" | "card_number" | "quiet_hours" | "yearly_limit";
  /** A promotion outside quiet hours: saved and sent in the next window (after rechecking consent). */
  held?: boolean;
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
 * Promotional texts go out only 8:00 AM - 9:00 PM in the recipient's local time: the time zone the customer
 * gave us, otherwise both the area-code zone(s) and New York time. See src/lib/area-code-tz.ts.
 */
export function inMarketingHours(to: string, now = new Date(), customerTimeZone?: string | null): boolean {
  return inRecipientPromoHours(to, now, customerTimeZone);
}

/** Every promotional text begins with "Hup Up Attractions: Reply STOP to opt out." and then the offer. */
export function marketingBody(body: string, v2 = smsTermsV2Active()): string {
  if (v2) return marketingBodyV2(body);
  let offer = body.trim();
  if (offer.startsWith(PROMO_OPENING)) return offer;
  offer = offer.replace(/^hup up attractions\s*[:\-]\s*/i, "");
  offer = offer.replace(/\s*reply stop to opt out\.?\s*$/i, "");
  return `${PROMO_OPENING} ${offer}`.trim();
}

/** SMS Terms v2: "Hup Up Attractions: <offer> Reply NO PROMO to stop promos, STOP to end all texts." */
export function marketingBodyV2(body: string): string {
  let offer = body.trim();
  offer = offer.replace(/^hup up attractions\s*[:\-]\s*/i, "");
  offer = offer.replace(/\s*reply stop to opt out\.?\s*/i, " ").trim();
  if (offer.endsWith(PROMO_ENDING_V2)) offer = offer.slice(0, -PROMO_ENDING_V2.length).trim();
  return `${PROMO_PREFIX_V2} ${offer} ${PROMO_ENDING_V2}`;
}

/** Start of the current calendar year in New York. */
function yearStart(now = new Date()): Date {
  const y = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now));
  // Jan 1 00:00 New York is 05:00 UTC (EST)
  return new Date(Date.UTC(y, 0, 1, 5, 0, 0));
}

/** Promotional texts this number has been sent (or has waiting) this calendar year. Blocked, failed and canceled ones don't count. */
export async function promosThisYear(phone: string, now = new Date()): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.contactPhone, phone),
        eq(schema.messages.kind, "marketing"),
        eq(schema.messages.direction, "out"),
        gte(schema.messages.createdAt, yearStart(now)),
        sql`${schema.messages.status} not in ('blocked', 'failed', 'undelivered', 'canceled')`,
      ),
    );
  return r?.n ?? 0;
}

/** Abraham (Nov 9, 2026): the first order text a customer gets, and the first after 30 days without one, ends with this. */
export const ORDER_STOP_LINE = "Reply STOP to opt out.";
export const ORDER_STOP_GAP_DAYS = 30;

/** True when this number hasn't been sent an order text (that went out) in the last 30 days, including never. */
export async function needsOrderStopLine(phone: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - ORDER_STOP_GAP_DAYS * 86_400_000);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.contactPhone, phone),
        eq(schema.messages.kind, "transactional"),
        eq(schema.messages.direction, "out"),
        gte(schema.messages.createdAt, since),
        sql`${schema.messages.status} not in ('blocked', 'failed', 'undelivered', 'canceled')`,
      ),
    );
  return (r?.n ?? 0) === 0;
}

/** Order text body: the STOP line only on the first text or after a 30-day gap; never twice. */
export function withOrderStopLine(body: string, needed: boolean): string {
  const b = body.trim();
  if (!needed || /\bSTOP\b/i.test(b)) return b;
  return `${b} ${ORDER_STOP_LINE}`;
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
 * Automatic (non-customer-program) messages: each purpose must be listed here, so "system" can't be used to
 * get around consent. Only the two marked `afterStop` may reach a number that replied STOP.
 */
export const SYSTEM_EVENTS: Record<string, { afterStop: boolean }> = {
  login_code: { afterStop: false }, // staff sign-in codes
  owner_forward: { afterStop: false }, // copy of an incoming text to the owner
  owner_alert: { afterStop: false }, // "new paid order" to the owner
  compliance_alert: { afterStop: false }, // compliance report to the owner
  consent_confirmation: { afterStop: false }, // confirmation right after a customer opts in
  opt_out_confirmation: { afterStop: true }, // the single permitted confirmation of an opt-out
  reenroll_request: { afterStop: true }, // the START confirmation asking the customer to reply YES
  promo_confirm_request: { afterStop: false }, // SMS Terms v2: asks for a YES reply (written promotional consent)
};

export type Customer = typeof schema.customers.$inferSelect;
type Blocked = NonNullable<SendResult["blocked"]>;

/** Latest order/service (transactional) consent decision for a number is an opt-in. */
export async function hasTransactionalConsent(phone: string): Promise<boolean> {
  const [row] = await db
    .select({ action: schema.smsConsents.action })
    .from(schema.smsConsents)
    .where(and(eq(schema.smsConsents.phone, phone), eq(schema.smsConsents.scope, "transactional")))
    .orderBy(desc(schema.smsConsents.createdAt), desc(schema.smsConsents.id))
    .limit(1);
  return row?.action === "opt_in";
}

/**
 * Every rule a text must pass, checked at the moment of sending (also for held promotions):
 *  - system texts: listed purpose only; after STOP only the opt-out confirmation and the START confirmation;
 *  - STOP blocks both programs;
 *  - order/service texts need order/service consent;
 *  - promotional texts need promotional consent and the 8 AM - 9 PM window.
 */
export async function checkEligibility(input: { to: string; kind: MessageKind; event?: string | null; customer: Customer | null; now?: Date; heldRecheck?: boolean }): Promise<Blocked | null> {
  const { to, kind, customer } = input;
  if (kind === "system") {
    const rule = input.event ? SYSTEM_EVENTS[input.event] : undefined;
    if (!rule) return "not_allowed";
    if (customer?.smsOptOut && !rule.afterStop) return "opted_out";
    return null;
  }
  if (customer?.smsOptOut) return "opted_out";
  if (kind === "transactional") return (await hasTransactionalConsent(to)) ? null : "no_transactional_consent";
  if (!customer?.marketingOptIn) return "no_marketing_consent";
  if (!input.heldRecheck && (await promosThisYear(to, input.now)) >= PROMOS_PER_YEAR) return "yearly_limit";
  if (!inMarketingHours(to, input.now, customer.timeZone)) return "quiet_hours";
  return null;
}

/** Next time (on the hour, within 7 days) the promotional window is open for this recipient. */
export function nextPromoWindow(to: string, from: Date, customerTimeZone?: string | null): Date | null {
  const t = new Date(from);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 24 * 7; i++) {
    const c = new Date(t.getTime() + i * 3600 * 1000);
    if (inMarketingHours(to, c, customerTimeZone)) return c;
  }
  return null;
}

/**
 * The single way the app sends a text. Logs every message (content, type, who, links, status), applies every
 * consent rule, holds promotions that fall outside quiet hours for the next window, refuses card numbers, and
 * falls back from MMS to SMS if media fails.
 */
export async function sendMessage(input: SendInput): Promise<SendResult> {
  const to = toE164(input.to);
  if (!to) return { sent: false, error: "Invalid phone number" };
  const kind = input.kind ?? "transactional";
  const log = input.log !== false;
  if (kind === "marketing") input = { ...input, body: marketingBody(input.body) };
  if (kind === "transactional") input = { ...input, body: withOrderStopLine(input.body, await needsOrderStopLine(to, input.now)) };

  if (containsCardNumber(input.body)) {
    return { sent: false, blocked: "card_number", error: "Message looks like it contains a card number and was not sent." };
  }

  const customer = input.customerId
    ? (await db.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)))[0] ?? null
    : await customerByPhone(to);

  const blocked = await checkEligibility({ to, kind, event: input.event, customer, now: input.now });
  const held = blocked === "quiet_hours";
  const sendAfter = held ? nextPromoWindow(to, input.now ?? new Date(), customer?.timeZone) : null;

  let messageId: number | undefined;
  if (log || held) {
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
        status: held ? "held" : blocked ? "blocked" : "queued",
        errorMessage: blocked ? BLOCK_REASON[blocked] : null,
        sendAfter,
        customerId: customer?.id ?? null,
        orderId: input.orderId ?? null,
        callSid: input.callSid ?? null,
        userId: input.userId ?? null,
        templateId: input.templateId ?? null,
      })
      .returning({ id: schema.messages.id });
    messageId = row.id;
  }
  if (blocked) return { sent: false, blocked, held, messageId, error: BLOCK_REASON[blocked] };
  return deliver({ messageId, to, body: input.body, mediaUrls: input.mediaUrls, customer, logBody: log, retry: () => sendMessage({ ...input, mediaUrls: [] }) });
}

async function deliver(m: { messageId?: number; to: string; body: string; mediaUrls?: string[]; customer: Customer | null; logBody: boolean; retry?: () => Promise<SendResult> }): Promise<SendResult> {
  const { messageId, to } = m;
  const client = getTwilio();
  if (!client || (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID)) {
    if (config.isProd()) {
      await markFailed(messageId, "config", "Twilio is not configured");
      return { sent: false, messageId, error: "Twilio is not configured" };
    }
    console.log(`[dev SMS to ${to}] ${m.logBody ? m.body : "(not logged)"}${m.mediaUrls?.length ? ` [media: ${m.mediaUrls.join(", ")}]` : ""}`);
    if (messageId) await db.update(schema.messages).set({ status: "dev" }).where(eq(schema.messages.id, messageId));
    return { sent: true, dev: true, messageId };
  }

  const statusCallback = `${config.baseUrl()}/api/sms/status`;
  try {
    const msg = await client.messages.create({ to, body: m.body, ...senderParams(), statusCallback, ...(m.mediaUrls?.length ? { mediaUrl: m.mediaUrls } : {}) });
    if (messageId) await db.update(schema.messages).set({ twilioSid: msg.sid, status: msg.status || "queued" }).where(eq(schema.messages.id, messageId));
    return { sent: true, sid: msg.sid, messageId };
  } catch (e) {
    const err = e as { code?: number | string; message?: string };
    if (m.mediaUrls?.length && m.retry) {
      // MMS failed: keep the record of the failure, then send the same text without media.
      await markFailed(messageId, err.code, `MMS failed: ${err.message}`);
      const retry = await m.retry();
      return { ...retry, mmsFallback: true };
    }
    await markFailed(messageId, err.code, err.message);
    if (String(err.code) === "21610" && m.customer) {
      // Twilio says the recipient unsubscribed: mirror it.
      await db.update(schema.customers).set({ smsOptOut: true }).where(eq(schema.customers.id, m.customer.id));
    }
    return { sent: false, messageId, error: err.message || "SMS failed" };
  }
}

/**
 * Send promotions that were held for quiet hours and are now due. Each one is rechecked right before sending:
 * if the customer opted out or lost consent it is canceled (never sent); if it is still outside the window it is
 * moved to the next window.
 */
export async function processHeldPromotions(now = new Date()): Promise<{ sent: number; canceled: number; rescheduled: number }> {
  const due = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.status, "held"), eq(schema.messages.kind, "marketing"), lte(schema.messages.sendAfter, now)));
  const out = { sent: 0, canceled: 0, rescheduled: 0 };
  for (const m of due) {
    const to = m.toNumber || m.contactPhone || "";
    const customer = m.customerId ? ((await db.select().from(schema.customers).where(eq(schema.customers.id, m.customerId)))[0] ?? null) : await customerByPhone(to);
    const blocked = await checkEligibility({ to, kind: "marketing", customer, now, heldRecheck: true }); // already counted toward the yearly limit
    if (blocked === "quiet_hours") {
      await db.update(schema.messages).set({ sendAfter: nextPromoWindow(to, now, customer?.timeZone) }).where(eq(schema.messages.id, m.id));
      out.rescheduled++;
    } else if (blocked) {
      await db.update(schema.messages).set({ status: "canceled", errorMessage: `Canceled before sending: ${BLOCK_REASON[blocked]}` }).where(eq(schema.messages.id, m.id));
      out.canceled++;
    } else {
      const r = await deliver({ messageId: m.id, to, body: m.body, mediaUrls: m.mediaUrls ?? [], customer, logBody: true });
      if (r.sent) out.sent++;
    }
  }
  return out;
}

/** Message statuses that mean "not sent yet" (held by us, or scheduled/queued at Twilio). */
const PENDING_STATUSES = ["held", "scheduled", "queued", "accepted"];

/**
 * Opt-out: cancel every promotional text for this number that hasn't gone out yet. Held texts (ours) are
 * canceled outright; texts already handed to Twilio are canceled through the API (and marked canceled only if
 * Twilio confirms). Every send also rechecks consent at the moment of sending.
 */
export async function cancelQueuedPromotions(phone: string): Promise<number> {
  const pending = await db
    .select({ id: schema.messages.id, sid: schema.messages.twilioSid, status: schema.messages.status })
    .from(schema.messages)
    .where(and(eq(schema.messages.contactPhone, phone), eq(schema.messages.kind, "marketing"), eq(schema.messages.direction, "out"), inArray(schema.messages.status, PENDING_STATUSES)));
  const client = getTwilio();
  let canceled = 0;
  for (const m of pending) {
    if (m.sid) {
      if (!client) continue;
      try {
        await (client.messages as unknown as (sid: string) => { update: (p: { status: string }) => Promise<unknown> })(m.sid).update({ status: "canceled" });
      } catch (e) {
        console.error("Could not cancel promotion at Twilio (it may already be sending)", m.sid, e);
        continue;
      }
    }
    await db.update(schema.messages).set({ status: "canceled", errorMessage: "Canceled: customer opted out before it was sent" }).where(eq(schema.messages.id, m.id));
    canceled++;
  }
  return canceled;
}

export const NO_TEXT_CONSENT = "No text consent; call or email.";

const BLOCK_REASON: Record<Blocked, string> = {
  opted_out: "Customer replied STOP. They must text START and reply YES to receive order texts again.",
  no_marketing_consent: "Customer has not opted in to promotional texts.",
  no_transactional_consent: NO_TEXT_CONSENT,
  not_allowed: "This kind of automatic message is not allowed.",
  card_number: "Message looks like it contains a card number and was not sent.",
  quiet_hours: "Held: promotional texts are sent only between 8 AM and 9 PM in the customer's local time.",
  yearly_limit: `Not sent: this customer already got ${PROMOS_PER_YEAR} promotional texts this year (the most allowed).`,
};

async function markFailed(messageId: number | undefined, code: unknown, message: string | undefined) {
  if (!messageId) return;
  await db
    .update(schema.messages)
    .set({ status: "failed", errorCode: code === undefined ? null : String(code), errorMessage: message ?? null })
    .where(eq(schema.messages.id, messageId));
}

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { bookingLock } from "@/lib/jewish-calendar";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import { getTwilio } from "@/lib/twilio-client";
import { inRecipientPromoHours } from "@/lib/area-code-tz";
import { promoTextV2 } from "@/lib/promo-text";
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
  /** Internal (extra check J4): the plain-text resend of a picture text that failed; its words are already final. */
  mmsResend?: boolean;
};

export type SendResult = {
  sent: boolean;
  messageId?: number;
  sid?: string;
  dev?: boolean;
  blocked?: "opted_out" | "no_marketing_consent" | "no_transactional_consent" | "not_allowed" | "card_number" | "quiet_hours" | "yearly_limit" | "not_active" | "test_only";
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
  // Abraham, Nov 27, 2026 (option B): promotional texts also wait out Shabbes and Yom Tov, and go out after
  return inRecipientPromoHours(to, now, customerTimeZone) && !restNow(now);
}

/** Shabbes or Yom Tov right now (from candle lighting until the hotline opens again after). */
export function restNow(now = new Date()): boolean {
  return smsBookingLock(now).locked;
}

/**
 * Extra check G8 (Nov 27, 2026): the Shabbes and Yom Tov holds for texts use Admin's calendar settings (candle
 * lighting minutes, reopen time, location), the same as the phone, not the built-in defaults. The settings are read
 * once a minute at most (sendMessage and the held-texts run refresh them); until the first read, the defaults.
 */
let calendarCache: { s: Parameters<typeof bookingLock>[1]; at: number } | null = null;
export async function refreshSmsCalendar(force = false) {
  if (!force && calendarCache && Date.now() - calendarCache.at < 60_000) return;
  try {
    const { getSettings } = await import("@/lib/settings");
    calendarCache = { s: (await getSettings()) as unknown as Parameters<typeof bookingLock>[1], at: Date.now() };
  } catch {
    // no database (some tests): the defaults
  }
}
function smsBookingLock(now: Date) {
  return calendarCache ? bookingLock(now, calendarCache.s) : bookingLock(now);
}

/** Staff and Owner alert texts wait out Shabbes and Yom Tov (Abraham, Nov 27, 2026); sign-in codes never wait. */
export const STAFF_ALERTS_HELD = new Set(["owner_alert", "owner_forward", "compliance_alert", "info_email_alert"]);

/** Every promotional text begins with "Hup Up Attractions: Reply STOP to opt out." and then the offer. */
export function marketingBody(body: string, v2 = smsTermsV2Active()): string {
  if (v2) return marketingBodyV2(body);
  let offer = body.trim();
  if (offer.startsWith(PROMO_OPENING)) return offer;
  offer = offer.replace(/^hup up attractions\s*[:\-]\s*/i, "");
  offer = offer.replace(/\s*reply stop to opt out\.?\s*$/i, "");
  return `${PROMO_OPENING} ${offer}`.trim();
}

/** SMS Terms v2/v3: "Hup Up Attractions: <offer> Reply NOPROMO to stop promos, STOP to stop all texts." (shared with the Campaigns screen) */
export const marketingBodyV2 = promoTextV2;

/** Start of the current calendar year in New York. */
function yearStart(now = new Date()): Date {
  const y = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now));
  // Jan 1 00:00 New York is 05:00 UTC (EST)
  return new Date(Date.UTC(y, 0, 1, 5, 0, 0));
}

/**
 * Promotional texts accepted for sending to this number this calendar year (Jan 1 - Dec 31, New York time), all
 * campaigns combined. A text counts once it is accepted (queued, held for the morning, sent, delivered, even if the
 * carrier later fails it); only texts we blocked or canceled before sending don't count, so retries never add more.
 */
/** The yearly promo limit (Admin setting promosPerYear, 5), read through the same connection as the send. */
async function yearlyLimit(exec: Pick<typeof db, "select"> = db): Promise<number> {
  const [r] = await exec.select({ v: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, "promosPerYear")).limit(1);
  const n = Math.round(Number(r?.v ?? PROMOS_PER_YEAR));
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : PROMOS_PER_YEAR;
}

export async function promosThisYear(phone: string, now = new Date(), exec: Pick<typeof db, "select"> = db): Promise<number> {
  const [r] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.contactPhone, phone),
        eq(schema.messages.kind, "marketing"),
        eq(schema.messages.direction, "out"),
        gte(schema.messages.createdAt, yearStart(now)),
        // Extra check J4: a promotion that never reached the customer (failed, e.g. a picture text resent as plain text) doesn't count
        sql`${schema.messages.status} not in ('blocked', 'canceled', 'failed', 'undelivered')`,
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
/** True when this number agreed to order texts and no order text went out since (the first text after consent). */
export async function needsConsentFooter(phone: string): Promise<boolean> {
  const [c] = await db
    .select({ at: schema.smsConsents.createdAt, action: schema.smsConsents.action })
    .from(schema.smsConsents)
    .where(and(eq(schema.smsConsents.phone, phone), eq(schema.smsConsents.scope, "transactional")))
    .orderBy(desc(schema.smsConsents.createdAt), desc(schema.smsConsents.id))
    .limit(1);
  if (!c || c.action !== "opt_in") return false;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.contactPhone, phone),
        eq(schema.messages.kind, "transactional"),
        eq(schema.messages.direction, "out"),
        gte(schema.messages.createdAt, c.at),
        sql`${schema.messages.status} not in ('blocked', 'failed', 'undelivered', 'canceled')`,
      ),
    );
  return (r?.n ?? 0) === 0;
}

/** "Msg frequency varies. Msg and data rates may apply. Reply STOP to opt out, HELP for help. Terms: {link}" (Admin-editable). */
export async function consentFooter(): Promise<string> {
  const { messageText } = await import("@/lib/ivr/prompts");
  return messageText("msg_first_text_footer", { link: `${config.siteUrl()}/sms-terms` });
}

/** Abraham, Nov 27, 2026 (item 5): the ending of the first text a number ever gets from us, word for word. */
export const FIRST_TEXT_STOP_HELP = " Reply STOP to stop, or HELP for help.";
/** Customer texts that get the first-text ending: order and payment texts, and the catalog and other texts a customer asked for. */
const FIRST_TEXT_SYSTEM_EVENTS = new Set(["catalog_request", "catalog_reply", "menu_key_request", "confirmation_resend", "join_invite"]);
function FIRST_TEXT_KINDS(kind: MessageKind, event: string | undefined): boolean {
  return kind === "transactional" || (kind === "system" && FIRST_TEXT_SYSTEM_EVENTS.has(event ?? ""));
}
/** The text already tells how to stop and get help (the sign-up confirmation, for one). */
export const hasStopAndHelp = (body: string) => /\bSTOP\b/.test(body) && /\bHELP\b/.test(body);
export function withFirstTextLine(body: string): string {
  return `${body.trimEnd()}${FIRST_TEXT_STOP_HELP}`;
}
/** True when no text from us has ever gone out to this number (blocked, failed and canceled ones do not count). */
export async function neverTexted(phone: string): Promise<boolean> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(and(eq(schema.messages.contactPhone, phone), eq(schema.messages.direction, "out"), sql`${schema.messages.status} not in ('blocked', 'failed', 'undelivered', 'canceled')`));
  return (r?.n ?? 0) === 0;
}

export function withOrderStopLine(body: string, needed: boolean): string {
  const b = body.trim();
  if (!needed || /\bSTOP\b/i.test(b)) return b;
  return `${b} ${ORDER_STOP_LINE}`;
}

async function customerByPhone(phone: string) {
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  return c ?? null;
}

/** Every text goes through the Twilio Messaging Service (Abraham, Nov 16, 2026); never straight from the number on
 * the live site. Off the live site (local tests) the number is used. */
function senderParams(): { from?: string; messagingServiceSid?: string } {
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID };
  return config.isProd() ? {} : { from: process.env.TWILIO_PHONE_NUMBER };
}

/** The texting test window (Abraham, Nov 16, 2026): until he opens it, only the test numbers get customer texts. */
export async function testWindowBlocks(to: string, event: string | undefined): Promise<boolean> {
  if (process.env.VERCEL_ENV !== "production" || STAFF_EVENTS.has(event ?? "")) return false;
  // A catalog the person asked for (key 8 or texting CATALOG) is not held by the test window (Abraham, Nov 18, 2026:
  // a catalog request from (845) 395-5264 was held and never reached Twilio)
  if (REQUESTED_EVENTS.has(event ?? "")) return false;
  const { getSettings } = await import("@/lib/settings");
  const s = await getSettings();
  if (!s.smsTestOnly) return false;
  const list = String(s.smsTestNumbers).split(/[\n,;]+/).map((x) => x.replace(/\D/g, "").slice(-10)).filter(Boolean);
  return !list.includes(to.replace(/\D/g, "").slice(-10));
}

/**
 * Automatic (non-customer-program) messages: each purpose must be listed here, so "system" can't be used to
 * get around consent. Only the two marked `afterStop` may reach a number that replied STOP.
 */
export const SYSTEM_EVENTS: Record<string, { afterStop: boolean }> = {
  login_code: { afterStop: false }, // staff sign-in codes
  switch_code: { afterStop: false }, // Owner safety-check codes before turning on a sensitive switch (Hark review item 9)
  owner_forward: { afterStop: false }, // copy of an incoming text to the owner
  owner_alert: { afterStop: false }, // "new paid order" to the owner
  info_email_alert: { afterStop: false }, // every info@ email, texted to the owner (Abraham, Nov 17, 2026)
  compliance_alert: { afterStop: false }, // compliance report to the owner
  consent_confirmation: { afterStop: false }, // confirmation right after a customer opts in
  seasonal_join_confirm: { afterStop: false }, // Nov 27, 2026: the approved seasonal offers sign-up confirmation, once per number (src/lib/seasonal-confirm.ts)
  opt_out_confirmation: { afterStop: true }, // the single permitted confirmation of an opt-out
  reenroll_request: { afterStop: true }, // the START confirmation asking the customer to reply YES
  promo_confirm_request: { afterStop: false }, // SMS Terms v2: asks for a YES reply (written promotional consent)
  catalog_request: { afterStop: false }, // key 8: the caller asked for our catalog by text (one text, never a promo sign-up)
  confirmation_resend: { afterStop: false }, // box 148, press 1: the payment confirmation to the number the caller entered
  catalog_reply: { afterStop: false }, // texting CATALOG: the reply with the catalog (Nov 18, 2026: was refused as an order text)
  join_invite: { afterStop: false }, // JOIN invitation: once per customer, separate text, only while JOIN_INVITE_ON (off until Abraham picks the wording)
  menu_key_request: { afterStop: false }, // a key set in Admin (Nov 26, 2026): the caller asked for this text with a key; never after STOP
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
/** Did any customer record with this phone number reply STOP? */
async function numberOptedOut(to: string, exec: Pick<typeof db, "select"> = db): Promise<boolean> {
  if (!to) return false;
  const rows = await exec.select({ phone: schema.customers.phone, optOut: schema.customers.smsOptOut }).from(schema.customers).where(and(eq(schema.customers.phone, to), eq(schema.customers.smsOptOut, true))).limit(1);
  return rows.some((r) => r.optOut === true && r.phone === to);
}

export async function checkEligibility(input: { to: string; kind: MessageKind; event?: string | null; customer: Customer | null; now?: Date; heldRecheck?: boolean; exec?: Pick<typeof db, "select"> }): Promise<Blocked | null> {
  const { to, kind, customer } = input;
  // Deep check Nov 27 (item 14): STOP counts for the number, whichever customer record it was saved on (two records
  // with the same phone could let a text through to a number that replied STOP)
  const stopped = async () => Boolean(customer?.smsOptOut) || (await numberOptedOut(to, input.exec));
  if (kind === "system") {
    const rule = input.event ? SYSTEM_EVENTS[input.event] : undefined;
    if (!rule) return "not_allowed";
    if (!rule.afterStop && (await stopped())) return "opted_out";
    return null;
  }
  if (await stopped()) return "opted_out";
  if (kind === "transactional") return (await hasTransactionalConsent(to)) ? null : "no_transactional_consent";
  if (!customer?.marketingOptIn) return "no_marketing_consent";
  if (!input.heldRecheck && (await promosThisYear(to, input.now, input.exec)) >= (await yearlyLimit(input.exec))) return "yearly_limit";
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
  await refreshSmsCalendar();
  const kind = input.kind ?? "transactional";
  const log = input.log !== false;
  // Extra check J4: a plain-text resend after a failed picture text keeps the words already prepared (no second footer)
  if (kind === "marketing" && !input.mmsResend) input = { ...input, body: marketingBody(input.body) };
  // Abraham, Nov 27, 2026 (item 5): the FIRST text a number ever gets from us carries STOP and HELP (the website's grey
  // lines say only "Message and data rates may apply."). Catalog, order and payment link texts to a number that never
  // got a text from us end with exactly " Reply STOP to stop, or HELP for help."; later texts do not.
  const first = !input.mmsResend && FIRST_TEXT_KINDS(kind, input.event) && !hasStopAndHelp(input.body) && (await neverTexted(to));
  if (first) input = { ...input, body: withFirstTextLine(input.body) };
  else if (kind === "transactional" && !input.mmsResend) {
    // The first text after a texting consent carries the full disclosure and the terms link (Abraham, Nov 24, 2026)
    const footer = (await needsConsentFooter(to)) ? await consentFooter() : null;
    input = { ...input, body: footer ? `${input.body.trim()} ${footer}` : withOrderStopLine(input.body, await needsOrderStopLine(to, input.now)) };
  }

  if (containsCardNumber(input.body)) {
    return { sent: false, blocked: "card_number", error: "Message looks like it contains a card number and was not sent." };
  }
  input = { ...input, body: withSiteLinks(input.body), ...(input.mediaUrls?.length ? { mediaUrls: input.mediaUrls.map((u) => withSiteLinks(u)) } : {}) };
  // Never a test payment link (Hark's audit item 4, Nov 24, 2026): /paid?...&dev=1 skipped the card step
  if (containsTestPayLink(input.body)) {
    return { sent: false, blocked: "not_allowed", error: "Message contains a test payment link and was not sent." };
  }

  const customer = input.customerId
    ? (await db.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)))[0] ?? null
    : await customerByPhone(to);

  // Texting is approved (A2P, Nov 15, 2026). On the live site every text goes through the Messaging Service, so none
  // goes out until its ID is in Vercel; then the test window holds customer texts to the test numbers only.
  const a2pOff = process.env.VERCEL_ENV === "production" && !process.env.TWILIO_MESSAGING_SERVICE_SID;
  const testOnly = !a2pOff && (await testWindowBlocks(to, input.event));

  // Promotions: the count and the save happen under a lock on this number, so campaigns running at the same time can
  // never push a customer past the yearly limit.
  const decideAndSave = async (exec: typeof db) => {
    if (kind === "marketing" && typeof exec.execute === "function") await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${"promo:" + to}))`);
    let blocked: Blocked | null = a2pOff ? "not_active" : testOnly ? "test_only" : await checkEligibility({ to, kind, event: input.event, customer, now: input.now, exec });
    // Staff and Owner alerts during Shabbes or Yom Tov: held, then sent right after (customer-requested texts never wait)
    const lock = kind === "system" && !blocked && STAFF_ALERTS_HELD.has(String(input.event)) ? smsBookingLock(input.now ?? new Date()) : null;
    if (lock?.locked) blocked = "quiet_hours";
    const held = blocked === "quiet_hours";
    const sendAfter = !held ? null : lock?.locked ? lock.opensAt : nextPromoWindow(to, input.now ?? new Date(), customer?.timeZone);
    if (held && sendAfter) await (await import("@/lib/wake-flags")).armWake("held-texts", sendAfter, { earliest: true });
    let messageId: number | undefined;
    if (log || held || kind === "marketing") {
      const [row] = await exec
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
    return { blocked, held, messageId };
  };
  const { blocked, held, messageId } = kind === "marketing" && typeof db.transaction === "function" ? await db.transaction((tx) => decideAndSave(tx as unknown as typeof db)) : await decideAndSave(db);
  if (blocked) return { sent: false, blocked, held, messageId, error: BLOCK_REASON[blocked] };
  return deliver({ messageId, to, body: input.body, mediaUrls: input.mediaUrls, customer, logBody: log, retry: () => sendMessage({ ...input, mediaUrls: [], mmsResend: true }) });
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

  // Deep check 0600 M58: our message number rides on the status address, so Twilio's first status notice ties its
  // message id to our row even if this run is cut off right after Twilio accepted the text (it is then never re-held
  // and sent a second time)
  const statusCallback = `${config.baseUrl()}/api/sms/status${messageId ? `?m=${messageId}` : ""}`;
  try {
    // Deep check 06:00 M58: a held text (claimed "sending") is marked just before it is handed to Twilio, so a run cut
    // off after this point is never sent again (its result is unknown); one cut off before it is held again (G4)
    if (messageId) await db.update(schema.messages).set({ status: "submitting" }).where(and(eq(schema.messages.id, messageId), eq(schema.messages.status, "sending")));
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
      // Twilio says the recipient unsubscribed: mirror it, like a STOP (extra check J3): every record with the number,
      // an opt-out record for each program, and nothing still waiting goes out
      // Deep check 06:00 M13: the number the text went to (an order's own text number can differ from the customer's
      // phone), never the customer's phone, which did not reply STOP
      const phone = toE164(m.to) ?? m.to;
      await db.update(schema.customers).set({ smsOptOut: true, marketingOptIn: false }).where(eq(schema.customers.phone, phone));
      if (phone) {
        for (const scope of ["transactional", "marketing"])
          await db.insert(schema.smsConsents).values({ customerId: m.customer.id, phone, scope, action: "opt_out", source: "carrier", method: "carrier", wording: "Twilio error 21610: the number replied STOP to the carrier" });
        await cancelQueuedMessages(phone).catch((e) => console.error("[21610] cancel waiting texts failed", e));
      }
    }
    return { sent: false, messageId, error: err.message || "SMS failed" };
  }
}

/**
 * Send promotions that were held for quiet hours and are now due. Each one is rechecked right before sending:
 * if the customer opted out or lost consent it is canceled (never sent); if it is still outside the window it is
 * moved to the next window.
 */
/** A held text is taken by one run only (Deep check Nov 27, item 17): held -> sending, or false when another run has it. */
async function claimHeld(id: number): Promise<boolean> {
  // send_after becomes the moment it was claimed, so a claim left by a run that was cut off can be told apart (G4)
  const [claimed] = await db.update(schema.messages).set({ status: "sending", sendAfter: new Date() }).where(and(eq(schema.messages.id, id), eq(schema.messages.status, "held"))).returning({ id: schema.messages.id });
  return Boolean(claimed);
}

/** Held texts sent per run (Extra check G4): a big campaign goes out over a few runs, within the time limit. */
export const HELD_TEXTS_PER_RUN = 200;
/** A held text claimed ("sending") this long ago whose run was cut off goes back to "held" (Extra check G4). */
export const STUCK_SENDING_MS = 15 * 60_000;

export async function processHeldPromotions(now = new Date()): Promise<{ sent: number; canceled: number; rescheduled: number }> {
  await refreshSmsCalendar(true);
  // Deep check 06:00 M58: cut off while being handed to Twilio: Twilio may have sent it, so it is never sent again
  await db
    .update(schema.messages)
    .set({ status: "failed", errorMessage: "Cut off while being handed to Twilio: the result is unknown, so it was not sent again (check Twilio's log)." })
    .where(
      and(
        eq(schema.messages.status, "submitting"),
        isNull(schema.messages.twilioSid),
        inArray(schema.messages.kind, ["marketing", "system"]),
        lte(schema.messages.sendAfter, new Date(now.getTime() - STUCK_SENDING_MS)),
      ),
    );
  // Extra check G4 (Nov 27, 2026): a held text claimed by a run that was cut off (time limit) is "sending" with no
  // Twilio id; 15 minutes after it was claimed it is held again, so it goes out instead of waiting forever
  await db
    .update(schema.messages)
    .set({ status: "held" })
    .where(
      and(
        eq(schema.messages.status, "sending"),
        isNull(schema.messages.twilioSid),
        inArray(schema.messages.kind, ["marketing", "system"]),
        lte(schema.messages.sendAfter, new Date(now.getTime() - STUCK_SENDING_MS)),
      ),
    );
  const due = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.status, "held"), inArray(schema.messages.kind, ["marketing", "system"]), lte(schema.messages.sendAfter, now)))
    .orderBy(asc(schema.messages.sendAfter), asc(schema.messages.id)) // oldest first
    .limit(HELD_TEXTS_PER_RUN);
  const out = { sent: 0, canceled: 0, rescheduled: 0 };
  for (const m of due) {
    const to = m.toNumber || m.contactPhone || "";
    const customer = m.customerId ? ((await db.select().from(schema.customers).where(eq(schema.customers.id, m.customerId)))[0] ?? null) : await customerByPhone(to);
    if (m.kind === "system") {
      // a staff alert held for Shabbes or Yom Tov
      const lock = smsBookingLock(now);
      if (lock.locked) {
        await db.update(schema.messages).set({ sendAfter: lock.opensAt }).where(eq(schema.messages.id, m.id));
        out.rescheduled++;
      } else if ((await claimHeld(m.id)) && (await deliver({ messageId: m.id, to, body: m.body, mediaUrls: m.mediaUrls ?? [], customer, logBody: true })).sent) out.sent++;
      continue;
    }
    let blocked = await checkEligibility({ to, kind: "marketing", customer, now, heldRecheck: true });
    // The yearly limit again, at sending (Abraham, Nov 27, 2026): this held text already counts, so the others must be under it
    if (!blocked && (await promosThisYear(to, now)) - 1 >= (await yearlyLimit())) blocked = "yearly_limit";
    if (blocked === "quiet_hours") {
      await db.update(schema.messages).set({ sendAfter: nextPromoWindow(to, now, customer?.timeZone) }).where(eq(schema.messages.id, m.id));
      out.rescheduled++;
    } else if (blocked) {
      await db.update(schema.messages).set({ status: "canceled", errorMessage: `Canceled before sending: ${BLOCK_REASON[blocked]}` }).where(eq(schema.messages.id, m.id));
      out.canceled++;
    } else {
      // Deep check Nov 27 (item 17): claimed first, so two runs at the same moment never send the same text twice
      if (!(await claimHeld(m.id))) continue;
      const r = await deliver({ messageId: m.id, to, body: m.body, mediaUrls: m.mediaUrls ?? [], customer, logBody: true });
      if (r.sent) out.sent++;
    }
  }
  // the free timer: when the next held text is due (or nothing waiting)
  const wake = await import("@/lib/wake-flags");
  const nextHeld = async () => (await db.select({ at: schema.messages.sendAfter }).from(schema.messages).where(eq(schema.messages.status, "held")).orderBy(asc(schema.messages.sendAfter)).limit(1))[0]?.at ?? null;
  const next = await nextHeld();
  await wake.armWake("held-texts", next);
  // Extra check G10 (Nov 27, 2026): a text held while this run was finishing could be overwritten by a later time;
  // read again after writing and move the timer earlier if needed (never later)
  const again = await nextHeld();
  if (again && (!next || again.getTime() < next.getTime())) await wake.armWake("held-texts", again, { earliest: true });
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
  return cancelPending(phone, ["marketing"]);
}

/** SMS v3 STOP: cancel every outgoing text to this number that hasn't gone out yet (order texts and promos). */
export async function cancelQueuedMessages(phone: string): Promise<number> {
  return cancelPending(phone, ["marketing", "transactional", "system"]);
}

async function cancelPending(phone: string, kinds: string[]): Promise<number> {
  const pending = await db
    .select({ id: schema.messages.id, sid: schema.messages.twilioSid, status: schema.messages.status })
    .from(schema.messages)
    .where(and(eq(schema.messages.contactPhone, phone), inArray(schema.messages.kind, kinds), eq(schema.messages.direction, "out"), inArray(schema.messages.status, PENDING_STATUSES)));
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

/** A test link (dev=1) in a message: never sent, anywhere (Abraham, Nov 25, 2026: one reached a customer). */
export function containsTestPayLink(body: string, _env: Record<string, string | undefined> = process.env): boolean {
  return /[?&]dev=1\b/.test(body);
}

/**
 * Every customer link uses the real site address (Abraham, Nov 25, 2026): on the live site a vercel.app address in a
 * text is replaced by https://hupupattractions.com (the same pages answer there).
 */
export function withSiteLinks(body: string, env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV !== "production") return body;
  const site = (env.PUBLIC_SITE_URL || "https://hupupattractions.com").replace(/\/$/, "");
  return body.replace(/https?:\/\/[a-z0-9-]+\.vercel\.app/gi, site);
}

/**
 * One check for every customer text and email (item 7, Abraham Nov 25, 2026): vercel.app addresses become the real site
 * on the live site, and a message holding a test link (dev=1) is never sent.
 */
export function customerSafe(body: string, env: Record<string, string | undefined> = process.env): { body: string; blocked: boolean } {
  const out = withSiteLinks(body, env);
  return { body: out, blocked: containsTestPayLink(out, env) };
}

export const NO_TEXT_CONSENT = "No text consent; call or email.";
/** SMS v3: the exact note on every texting screen until Twilio approves texting. */
export const TEXTING_NOT_ACTIVE = "Not active yet: waiting for Twilio A2P approval";
/** Texts to our own staff (not customers): allowed before A2P approval. */
const STAFF_EVENTS = new Set(["owner_alert", "owner_forward", "compliance_alert", "login_code", "switch_code", "info_email_alert"]);
const REQUESTED_EVENTS = new Set(["catalog_request", "catalog_reply", "menu_key_request", "seasonal_join_confirm"]); // + a text the caller asked for with a key set in Admin (Nov 26, 2026)

const BLOCK_REASON: Record<Blocked, string> = {
  opted_out: "Customer replied STOP. They must text START and reply YES to receive order texts again.",
  no_marketing_consent: "Customer has not opted in to promotional texts.",
  no_transactional_consent: NO_TEXT_CONSENT,
  not_allowed: "This kind of automatic message is not allowed.",
  card_number: "Message looks like it contains a card number and was not sent.",
  quiet_hours: "Held: promotional texts are sent only between 8 AM and 9 PM in the customer's local time.",
  yearly_limit: `Not sent: this customer already got ${PROMOS_PER_YEAR} promotional texts this year (the most allowed).`,
  not_active: TEXTING_NOT_ACTIVE,
  test_only: "Not sent: texting is in its test window, so only the test numbers get texts until Abraham opens it to everyone.",
};

async function markFailed(messageId: number | undefined, code: unknown, message: string | undefined) {
  if (!messageId) return;
  await db
    .update(schema.messages)
    .set({ status: "failed", errorCode: code === undefined ? null : String(code), errorMessage: message ?? null })
    .where(eq(schema.messages.id, messageId));
}

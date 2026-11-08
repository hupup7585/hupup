import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isSelectableTimeZone } from "@/lib/area-code-tz";
import { cancelQueuedPromotions } from "@/lib/sms";

/**
 * SMS consent (A2P 10DLC). Every consent decision is written to `sms_consents`, an append-only table
 * (a DB trigger rejects UPDATE/DELETE), with the phone number, scope, decision, method, exact language
 * presented, its version, and the time. Promotional consent is only ever recorded from an explicit "yes".
 */

/** Version id of the default consent language. Bump when the default wording changes. */
export const CONSENT_WORDING_VERSION = "2026-11-05";

export type ConsentScope = "transactional" | "marketing";
export type ConsentAction = "opt_in" | "opt_out" | "declined";
export type ConsentMethod = "keypad" | "speech" | "keyword" | "checkbox" | "staff" | "sms_reply";
export type ConsentAnswer = "yes" | "no" | "unclear";

/** Spoken answers below this Twilio confidence are asked again instead of being recorded. */
export const MIN_SPEECH_CONFIDENCE = 0.6;

/** The version stored with a consent: the dated default, or custom-<hash> when the text was edited in admin. */
export function wordingVersion(presented: string, defaultText: string): string {
  if (presented.trim() === defaultText.trim()) return CONSENT_WORDING_VERSION;
  return `custom-${createHash("sha256").update(presented.trim()).digest("hex").slice(0, 12)}`;
}

/**
 * A spoken "yes" counts only when the whole answer is one of these clear affirmative replies to the
 * yes/no consent question. "Sure", "okay", "I guess", or a yes inside a longer sentence are not consent.
 */
const AFFIRMATIVE = new Set(["yes", "yeah", "yep", "yes please", "yes i agree", "i agree", "agree", "i do", "yes i do", "yes i do agree", "yes agree"]);
const NO = ["no", "nope", "not", "dont", "don't", "skip", "decline", "never", "stop", "nah"];

/**
 * Keypad 1 = yes, 2 = no. Speech: a clear affirmative reply (whole answer, confident) is yes; any negative
 * word is no; everything else (silence, uncertainty, mixed or unrelated answers) is "unclear", which the
 * flow treats as no consent.
 */
export function parseConsentAnswer(input: { digits?: string | null; speech?: string | null; confidence?: string | number | null }): ConsentAnswer {
  const d = (input.digits ?? "").trim();
  if (d === "1") return "yes";
  if (d === "2") return "no";
  if (d) return "unclear";
  const said = (input.speech ?? "").toLowerCase().replace(/[^a-z' ]/g, " ");
  if (!said.trim()) return "unclear";
  const words = said.split(/\s+/).filter(Boolean);
  const phrase = words.join(" ");
  const negative = words.some((w) => NO.includes(w));
  const conf = input.confidence === undefined || input.confidence === null || input.confidence === "" ? null : Number(input.confidence);
  const confident = !(conf !== null && Number.isFinite(conf) && conf < MIN_SPEECH_CONFIDENCE);
  if (AFFIRMATIVE.has(phrase) && !negative && confident) return "yes";
  if (negative && !AFFIRMATIVE.has(phrase) && !words.includes("yes")) return confident ? "no" : "unclear";
  return "unclear";
}

export type ConsentState = Record<ConsentScope, { action: ConsentAction; at: Date } | null>;

/** Latest recorded decision per scope for a phone number. */
export async function consentState(phone: string): Promise<ConsentState> {
  const latest = async (scope: ConsentScope) => {
    const [row] = await db
      .select({ action: schema.smsConsents.action, at: schema.smsConsents.createdAt })
      .from(schema.smsConsents)
      .where(and(eq(schema.smsConsents.phone, phone), eq(schema.smsConsents.scope, scope)))
      .orderBy(desc(schema.smsConsents.createdAt), desc(schema.smsConsents.id))
      .limit(1);
    return row ? { action: row.action as ConsentAction, at: row.at } : null;
  };
  return { transactional: await latest("transactional"), marketing: await latest("marketing") };
}

/** Promotional question is skipped for 12 months after a "no" or an opt-out. */
export function shouldAskMarketing(state: ConsentState, customer: { smsOptOut: boolean; marketingOptIn: boolean } | null, now = new Date()) {
  if (customer?.smsOptOut || customer?.marketingOptIn) return false;
  const m = state.marketing;
  if (m && m.action !== "opt_in" && now.getTime() - m.at.getTime() < 365 * 24 * 3600 * 1000) return false;
  return true;
}

export type RecordConsentInput = {
  phone: string;
  scope: ConsentScope;
  action: ConsentAction;
  source: "phone" | "pos" | "staff" | "keyword" | "web" | "sms_reply";
  method: ConsentMethod;
  wording: string;
  wordingVersion: string;
  response?: string | null;
  speechConfidence?: number | null;
  callerPhone?: string | null;
  callSid?: string | null;
  orderId?: number | null;
  userId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  disclosureRead?: boolean | null;
  /** Only the START -> YES confirmation may re-enroll a number that replied STOP. */
  viaStartConfirmation?: boolean;
  /** SMS Terms v2: a YES reply to the promotional confirmation text (the written promotional consent). */
  viaPromoConfirmation?: boolean;
};

/**
 * Approved enrollment processes (policy section 11). An opt-in may only come from:
 *  - the website form (checkbox), the phone menu (keypad or clear spoken yes), or staff after reading the full
 *    disclosure; or
 *  - the carrier-standard START keyword, for order and service texts only (never promotions).
 */
export function assertApprovedEnrollment(input: Pick<RecordConsentInput, "action" | "scope" | "source" | "method" | "disclosureRead" | "viaStartConfirmation" | "viaPromoConfirmation">) {
  if (input.action !== "opt_in") return;
  if (input.source === "sms_reply") {
    if (input.scope !== "marketing" || !input.viaPromoConfirmation) throw new Error("A text reply only enrolls as a YES to the promotional confirmation text.");
    return;
  }
  if (input.source === "keyword" && input.scope === "marketing") throw new Error("Promotional texts can't be re-enrolled by keyword; new consent is required.");
  if (input.source === "keyword" && !input.viaStartConfirmation) throw new Error("A keyword alone can't enroll anyone: START must be confirmed with YES.");
  if ((input.source === "staff" || input.source === "pos") && !input.disclosureRead) throw new Error("Staff consent requires the entire disclosure to be read first.");
  if (!["web", "phone", "staff", "pos", "keyword"].includes(input.source)) throw new Error("Not an approved enrollment process.");
}

/** Database handle: the shared connection or an open transaction (keyword processing locks the customer row). */
export type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ConsentBlockedError extends Error {}

/** Append a consent row (creating a minimal customer record for the number if needed) and update current state. */
export async function recordConsent(input: RecordConsentInput, exec: Exec = db): Promise<number> {
  return (await recordConsentDetailed(input, exec)).customerId;
}

export async function recordConsentDetailed(input: RecordConsentInput, exec: Exec = db): Promise<{ customerId: number; consentId: number }> {
  assertApprovedEnrollment(input);
  // Re-enrollment after a withdrawal is documented as its own row that points at that withdrawal.
  let reenrollsAfterId: number | null = null;
  if (input.action === "opt_in") {
    const [last] = await exec
      .select({ id: schema.smsConsents.id, action: schema.smsConsents.action })
      .from(schema.smsConsents)
      .where(and(eq(schema.smsConsents.phone, input.phone), eq(schema.smsConsents.scope, input.scope)))
      .orderBy(desc(schema.smsConsents.createdAt), desc(schema.smsConsents.id))
      .limit(1);
    if (last?.action === "opt_out") reenrollsAfterId = last.id;
  }
  let [customer] = await exec.select().from(schema.customers).where(eq(schema.customers.phone, input.phone)).limit(1);
  if (!customer) [customer] = await exec.insert(schema.customers).values({ phone: input.phone, name: null }).returning();
  // STOP can only be undone by START + YES. No form, staff action, correction or automation may opt in a number
  // that replied STOP (the YES confirmation path clears the block itself, in the same locked transaction).
  if (input.action === "opt_in" && customer.smsOptOut && !input.viaStartConfirmation) {
    throw new ConsentBlockedError("This customer replied STOP. They must text START and reply YES to receive order texts again; promotions need a new sign-up after that.");
  }
  const [row] = await exec.insert(schema.smsConsents).values({
    customerId: customer.id,
    phone: input.phone,
    scope: input.scope,
    action: input.action,
    source: input.source,
    method: input.method,
    wording: input.wording,
    wordingVersion: input.wordingVersion,
    response: input.response ?? null,
    speechConfidence: input.speechConfidence ?? null,
    callerPhone: input.callerPhone ?? null,
    callSid: input.callSid ?? null,
    orderId: input.orderId ?? null,
    userId: input.userId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    pageUrl: input.pageUrl ?? null,
    disclosureRead: input.disclosureRead ?? null,
    reenrollsAfterId,
  }).returning({ id: schema.smsConsents.id });
  if (input.scope === "marketing") {
    // Only an explicit opt-in turns promotions on; anything else leaves/turns them off.
    const on = input.action === "opt_in";
    await exec
      .update(schema.customers)
      .set({ marketingOptIn: on, marketingOptInAt: on ? new Date() : customer.marketingOptInAt })
      .where(eq(schema.customers.id, customer.id));
    // A promotional "no" cancels every promotion still waiting to go out.
    if (!on && exec === db) await cancelQueuedPromotions(input.phone);
  }
  return { customerId: customer.id, consentId: row.id };
}

/**
 * Opt-in confirmation for the promotional program. Contains no offer or advertising: it only confirms the
 * enrollment and gives frequency, rates, HELP and STOP.
 */
export const MARKETING_CONFIRMATION_SMS =
  "Hup Up Attractions: You're now enrolled in promotional text messages. Msg frequency varies. Msg & data rates may apply. Reply HELP for help. Reply STOP to opt out, or NOPROMO to stop promotional texts only.";

/** Opt-in confirmation text for order and service texts (sent after a website sign-up). */
export const TRANSACTIONAL_CONFIRMATION_SMS =
  "Hup Up Attractions: You're now enrolled in order and service texts about your reservations, orders, payments, deliveries, and pickups. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

/** Footer on transactional texts sent after phone consent. */
export const TRANSACTIONAL_FOOTER = "Reply HELP for help, STOP to opt out.";

/* ------------------------------------------------------------------ staff-recorded consent */

export type StaffResponse = "clear_yes" | "said_no" | "unclear_or_silent";

/**
 * Staff (phone or in person) record a customer's answer after reading the ENTIRE approved disclosure.
 * Only a clear yes after a full reading is an opt-in. Silence, uncertainty or an unclear answer is recorded
 * as "declined" (no consent). Without the full reading, nothing can be recorded as consent.
 */
export async function recordStaffConsent(input: {
  phone: string;
  scope: ConsentScope;
  response: StaffResponse;
  disclosureRead: boolean;
  wording: string;
  wordingVersion: string;
  userId: number | null;
  orderId?: number | null;
  timeZone?: string | null;
}) {
  if (input.response === "clear_yes" && !input.disclosureRead) {
    throw new Error("Read the entire disclosure to the customer before recording consent.");
  }
  const optIn = input.response === "clear_yes" && input.disclosureRead;
  const customerId = await recordConsent({
    phone: input.phone,
    scope: input.scope,
    action: optIn ? "opt_in" : "declined",
    source: "staff",
    method: "staff",
    wording: input.wording,
    wordingVersion: input.wordingVersion,
    response: { clear_yes: "customer clearly said yes", said_no: "customer said no", unclear_or_silent: "no clear answer or silence" }[input.response],
    userId: input.userId,
    orderId: input.orderId ?? null,
    disclosureRead: input.disclosureRead,
  });
  if (optIn && input.scope === "marketing" && input.timeZone) await setCustomerTimeZone(input.phone, input.timeZone, "staff");
  return customerId;
}

/* ------------------------------------------------------------------ corrections */

/**
 * Consent records are never edited or deleted (a database trigger enforces it). A mistake is corrected with a
 * new, timestamped row that points at the original, says why, and records who made it. The newest row is the
 * customer's current consent; the original stays as it was.
 */
export async function correctConsent(input: { originalId: number; action: ConsentAction; reason: string; userId: number }) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A correction needs a reason.");
  if (!input.userId) throw new Error("A correction must record who made it.");
  // No manual overrides: a correction can only take consent away. New consent always needs the customer's own
  // affirmative decision through an approved process (website, phone menu, staff reading the full disclosure).
  if (input.action === "opt_in") throw new ConsentBlockedError("A correction can't create consent. Record the customer's new consent through an approved process instead.");
  const [orig] = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.id, input.originalId)).limit(1);
  if (!orig) throw new Error("Consent record not found.");
  await db.insert(schema.smsConsents).values({
    customerId: orig.customerId,
    phone: orig.phone,
    scope: orig.scope,
    action: input.action,
    source: "staff",
    method: "staff",
    wording: orig.wording,
    wordingVersion: orig.wordingVersion,
    response: `correction of record ${orig.id}`,
    userId: input.userId,
    correctsConsentId: orig.id,
    correctionReason: reason,
  });
  if (orig.scope === "marketing" && orig.customerId) {
    await db.update(schema.customers).set({ marketingOptIn: false }).where(eq(schema.customers.id, orig.customerId));
    await cancelQueuedPromotions(orig.phone); // a correction to "no" cancels promotions still waiting
  }
}

/* ------------------------------------------------------------------ customer time zone */

/** Store the time zone the customer told us (only zones from the selectable list are accepted). */
export async function setCustomerTimeZone(phone: string, zone: string, source: "web_form" | "phone" | "staff") {
  if (!isSelectableTimeZone(zone)) return false;
  await db.update(schema.customers).set({ timeZone: zone, timeZoneSource: source, timeZoneSetAt: new Date() }).where(eq(schema.customers.phone, phone));
  return true;
}

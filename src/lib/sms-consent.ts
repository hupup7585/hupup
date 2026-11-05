import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * SMS consent (A2P 10DLC). Every consent decision is written to `sms_consents`, an append-only table
 * (a DB trigger rejects UPDATE/DELETE), with the phone number, scope, decision, method, exact language
 * presented, its version, and the time. Promotional consent is only ever recorded from an explicit "yes".
 */

/** Version id of the default consent language. Bump when the default wording changes. */
export const CONSENT_WORDING_VERSION = "2026-11-05";

export type ConsentScope = "transactional" | "marketing";
export type ConsentAction = "opt_in" | "opt_out" | "declined";
export type ConsentMethod = "keypad" | "speech" | "keyword" | "checkbox" | "staff";
export type ConsentAnswer = "yes" | "no" | "unclear";

/** Spoken answers below this Twilio confidence are asked again instead of being recorded. */
export const MIN_SPEECH_CONFIDENCE = 0.5;

/** The version stored with a consent: the dated default, or custom-<hash> when the text was edited in admin. */
export function wordingVersion(presented: string, defaultText: string): string {
  if (presented.trim() === defaultText.trim()) return CONSENT_WORDING_VERSION;
  return `custom-${createHash("sha256").update(presented.trim()).digest("hex").slice(0, 12)}`;
}

const YES = ["yes", "yeah", "yep", "yup", "sure", "agree", "ok", "okay", "absolutely", "correct", "please"];
const NO = ["no", "nope", "not", "dont", "don't", "skip", "decline", "never", "stop", "nah"];

/** Keypad 1 = yes, 2 = no. Speech must be clearly one or the other (and confident), otherwise "unclear". */
export function parseConsentAnswer(input: { digits?: string | null; speech?: string | null; confidence?: string | number | null }): ConsentAnswer {
  const d = (input.digits ?? "").trim();
  if (d === "1") return "yes";
  if (d === "2") return "no";
  if (d) return "unclear";
  const said = (input.speech ?? "").toLowerCase().replace(/[^a-z' ]/g, " ");
  if (!said.trim()) return "unclear";
  const words = said.split(/\s+/).filter(Boolean);
  const yes = words.some((w) => YES.includes(w));
  const no = words.some((w) => NO.includes(w));
  if (yes === no) return "unclear"; // neither, or both ("I don't agree", "yes no")
  const conf = input.confidence === undefined || input.confidence === null || input.confidence === "" ? null : Number(input.confidence);
  if (conf !== null && Number.isFinite(conf) && conf < MIN_SPEECH_CONFIDENCE) return "unclear";
  return yes ? "yes" : "no";
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
  source: "phone" | "pos" | "staff" | "keyword" | "web";
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
};

/** Append a consent row (creating a minimal customer record for the number if needed) and update current state. */
export async function recordConsent(input: RecordConsentInput) {
  let [customer] = await db.select().from(schema.customers).where(eq(schema.customers.phone, input.phone)).limit(1);
  if (!customer) [customer] = await db.insert(schema.customers).values({ phone: input.phone, name: null }).returning();
  await db.insert(schema.smsConsents).values({
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
  });
  if (input.scope === "marketing") {
    // Only an explicit opt-in turns promotions on; anything else leaves/turns them off.
    const on = input.action === "opt_in";
    await db
      .update(schema.customers)
      .set({ marketingOptIn: on, marketingOptInAt: on ? new Date() : customer.marketingOptInAt })
      .where(eq(schema.customers.id, customer.id));
  }
  return customer.id;
}

/** Opt-in confirmation text for the promotional program (CTIA). */
export const MARKETING_CONFIRMATION_SMS =
  "Hup Up Attractions: You're subscribed to promotional texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

/** Opt-in confirmation text for order and service texts (sent after a website sign-up). */
export const TRANSACTIONAL_CONFIRMATION_SMS =
  "Hup Up Attractions: You'll receive texts about your reservations, orders, payments, deliveries and pickups. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

/** Footer on transactional texts sent after phone consent. */
export const TRANSACTIONAL_FOOTER = "Reply HELP for help, STOP to opt out.";

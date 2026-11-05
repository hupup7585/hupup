import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatPhone, toE164 } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { cancelQueuedPromotions, sendMessage } from "@/lib/sms";
import { recordConsent } from "@/lib/sms-consent";

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
export const START_WORDS = ["START", "UNSTOP", "YES"];
export const HELP_WORDS = ["HELP", "INFO"];
export const NOPROMO_WORDS = ["NOPROMO"];

export type Keyword = "stop" | "start" | "help" | "nopromo" | null;

/** Unambiguous opt-out words that also count anywhere in a short message ("unsubscribe me", "opt me out"). */
const OPT_OUT_IN_PHRASE = ["STOPALL", "UNSUBSCRIBE", "OPTOUT", "REVOKE"];
/** "Stop" alone is ambiguous ("stop by at 5?"), so in a phrase it only counts in these shapes. */
const STOP_PHRASE = /^(?:(?:PLEASE|OK|OKAY|JUST)\s+)*STOP(?:\s+(?:TEXTING|MESSAGING|SENDING|CONTACTING|TEXT|TEXTS|MESSAGES|IT|NOW|PLEASE|ALL|THIS|THESE)\b.*)?$|\bSTOP\s*$/;
/** Other reasonable ways people ask us to stop texting (Requirement 5). Matched on the whole short message. */
const STOP_REQUESTS = [
  /\b(?:DONT|DO NOT|PLEASE DONT|PLEASE DO NOT)\s+(?:TEXT|MESSAGE|SMS|CONTACT)\b/,
  /\bNO MORE\s+(?:TEXTS|TEXT|MESSAGES|MESSAGE|SMS)\b/,
  /\b(?:REMOVE|DELETE|TAKE)\s+(?:ME|MY NUMBER|THIS NUMBER)\s*(?:OFF|FROM)?\s*(?:YOUR|THE|THIS)?\s*(?:LIST|TEXTS|TEXT LIST|MAILING LIST|CONTACTS)?\s*$/,
  /\bTAKE ME OFF\b/,
  /\b(?:I )?(?:DONT|DO NOT) WANT (?:ANY )?(?:MORE )?(?:TEXTS|MESSAGES|THESE)\b/,
  /\bWRONG NUMBER\b.*\bSTOP\b|\bLEAVE ME ALONE\b/,
];
const MAX_PHRASE_WORDS = 8;

/**
 * Exact keyword match (the whole message is the keyword, ignoring case, spaces and punctuation), or an
 * opt-out word inside a short message. `exact` is false for the phrase case: Twilio's carrier-level opt-out
 * only reacts to exact keywords, so the app must block and confirm those itself.
 */
export function detectKeywordDetail(body: string): { keyword: Keyword; exact: boolean } {
  const w = body.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (STOP_WORDS.includes(w)) return { keyword: "stop", exact: true };
  if (START_WORDS.includes(w)) return { keyword: "start", exact: true };
  if (HELP_WORDS.includes(w)) return { keyword: "help", exact: true };
  if (NOPROMO_WORDS.includes(w)) return { keyword: "nopromo", exact: true };
  const words = body.toUpperCase().replace(/\bOPT[\s-]+(?:ME[\s-]+)?OUT\b/g, "OPTOUT").replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
  const joined = words.join(" ").replace(/\bDON T\b/g, "DONT");
  if (words.length <= MAX_PHRASE_WORDS && (words.some((x) => OPT_OUT_IN_PHRASE.includes(x)) || STOP_PHRASE.test(joined) || STOP_REQUESTS.some((r) => r.test(joined))))
    return { keyword: "stop", exact: false };
  return { keyword: null, exact: false };
}

export function detectKeyword(body: string): Keyword {
  return detectKeywordDetail(body).keyword;
}

/** Sent when an opt-out was recognized in a phrase (Twilio confirms exact keywords itself). */
/** Reply to NOPROMO (only when the number has not replied STOP). */
export const NOPROMO_CONFIRMATION =
  "Hup Up Attractions: You won't receive promotional texts anymore. You'll still get texts about your orders. Reply STOP to stop all texts.";

/** The single non-promotional confirmation allowed after an opt-out (Requirement 5). */
export const OPT_OUT_CONFIRMATION = "Hup Up Attractions: You're unsubscribed and won't receive more texts from us. Reply START to resubscribe.";

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

  const { keyword, exact } = detectKeywordDetail(text);
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
      db.insert(schema.smsConsents).values({ customerId: customer.id, phone: from, scope, action, source: "keyword", method: "keyword", keyword: text.trim().toUpperCase(), wording: text });
    if (keyword === "stop") {
      // Twilio blocks all messages after STOP, so both scopes are opted out.
      await db.update(schema.customers).set({ smsOptOut: true, marketingOptIn: false }).where(eq(schema.customers.id, customer.id));
      await consent("transactional", "opt_out");
      await consent("marketing", "opt_out");
      // Immediately: no promotion that was already queued or scheduled may still go out.
      await cancelQueuedPromotions(from);
      if (!exact) reply = OPT_OUT_CONFIRMATION;
    } else if (keyword === "start") {
      // New affirmative consent for order texts only (carrier-standard re-enrollment), recorded as its own row
      // linked to the earlier withdrawal. Promotions are NOT restored: they need new consent on the website,
      // phone menu, or with staff.
      await db.update(schema.customers).set({ smsOptOut: false }).where(eq(schema.customers.id, customer.id));
      await recordConsent({ phone: from, scope: "transactional", action: "opt_in", source: "keyword", method: "keyword", wording: text, wordingVersion: "keyword", response: `texted "${text.trim()}"` });
    } else if (keyword === "nopromo") {
      // Internal keyword: promotions only. It never clears or weakens a STOP (smsOptOut stays as it is).
      await db.update(schema.customers).set({ marketingOptIn: false }).where(eq(schema.customers.id, customer.id));
      await consent("marketing", "opt_out");
      await cancelQueuedPromotions(from);
      if (!customer.smsOptOut) reply = NOPROMO_CONFIRMATION;
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatPhone, toE164 } from "@/lib/phone";
import { LIVE_PUBLIC_EMAIL, NEW_EMAIL_LIVE, NEW_PUBLIC_EMAIL } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { emailIncomingText } from "@/lib/owner-alerts";
import { cancelQueuedMessages, cancelQueuedPromotions, sendMessage } from "@/lib/sms";
import { TRANSACTIONAL_CONFIRMATION_SMS } from "@/lib/sms-consent";
import { PROMO_ENROLLED_SMS, promoConfirmRequestSms, smsTermsV2Active } from "@/lib/sms-terms-v2";
import { START_CONFIRMATION_SMS } from "@/lib/sms-consent-copy";
import { isCatalogText, replyToCatalogText } from "@/lib/catalog-send";
import { cancelPendingReenroll, handleStart, handleYes, requestPromoConfirmation } from "@/lib/sms-reenroll";

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
export const START_WORDS = ["START", "UNSTOP"];
/** YES only counts as a reply to an active START confirmation (see sms-reenroll.ts). */
export const YES_WORDS = ["YES"];
export const HELP_WORDS = ["HELP", "INFO"];
export const NOPROMO_WORDS = ["NOPROMO"];
/** SMS Terms v2 (Abraham, Nov 9, 2026): JOIN asks for (or confirms) the promotional program. */
export const JOIN_WORDS = ["JOIN"];

export type Keyword = "stop" | "start" | "yes" | "help" | "nopromo" | "join" | null;

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
const WRONG_NUMBER = /^(?:(?:SORRY|HI|HELLO|PLEASE)\s+)*(?:THIS IS (?:THE |A )?)?WRONG (?:NUMBER|NUMBR|NUM|PERSON)\b/;

/**
 * Exact keyword match (the whole message is the keyword, ignoring case, spaces and punctuation), or an
 * opt-out word inside a short message. `exact` is false for the phrase case: Twilio's carrier-level opt-out
 * only reacts to exact keywords, so the app must block and confirm those itself.
 */
export function detectKeywordDetail(body: string, v2 = smsTermsV2Active()): { keyword: Keyword; exact: boolean } {
  const w = body.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (STOP_WORDS.includes(w)) return { keyword: "stop", exact: true };
  // SMS Terms v2 (section 7): a reply of WRONG NUMBER removes the number, like STOP. Twilio doesn't treat it as a
  // carrier keyword, so the app blocks it and sends the one opt-out confirmation itself.
  if (v2 && WRONG_NUMBER.test(body.trim().toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim())) return { keyword: "stop", exact: false };
  if (START_WORDS.includes(w)) return { keyword: "start", exact: true };
  if (YES_WORDS.includes(w)) return { keyword: "yes", exact: true };
  if (HELP_WORDS.includes(w)) return { keyword: "help", exact: true };
  if (NOPROMO_WORDS.includes(w)) return { keyword: "nopromo", exact: true };
  if (v2 && JOIN_WORDS.includes(w)) return { keyword: "join", exact: true };
  const words = body.toUpperCase().replace(/\bOPT[\s-]+(?:ME[\s-]+)?OUT\b/g, "OPTOUT").replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
  const joined = words.join(" ").replace(/\bDON T\b/g, "DONT");
  if (words.length <= MAX_PHRASE_WORDS && (words.some((x) => OPT_OUT_IN_PHRASE.includes(x)) || STOP_PHRASE.test(joined) || STOP_REQUESTS.some((r) => r.test(joined))))
    return { keyword: "stop", exact: false };
  return { keyword: null, exact: false };
}

export function detectKeyword(body: string): Keyword {
  return detectKeywordDetail(body).keyword;
}

/** The default HELP reply; a custom text is used only if it still names the business and both contacts. */
/** HELP uses the same email as the SMS Terms and Privacy Policy on the live site: info@ once NEW_EMAIL_LIVE, gmail until then. */
export const HELP_EMAIL = NEW_EMAIL_LIVE ? NEW_PUBLIC_EMAIL : LIVE_PUBLIC_EMAIL;
export const HELP_REPLY = `Hup Up Attractions: For help, call (845) 777-7585 or email ${HELP_EMAIL}. Msg & data rates may apply. Reply STOP to opt out.`;

export function helpReply(custom?: string | null): string {
  const t = (custom ?? "").trim();
  return t && /hup up attractions/i.test(t) && t.includes("(845) 777-7585") && t.includes(HELP_EMAIL) ? t : HELP_REPLY;
}

/** Reply to NOPROMO (only when the number has not replied STOP). */
export const NOPROMO_CONFIRMATION =
  "Hup Up Attractions: You won't receive promotional texts anymore. You'll still get texts about your orders. Reply STOP to stop all texts.";

/** The single non-promotional confirmation allowed after an opt-out (sent when an opt-out was recognized in a phrase; Twilio confirms exact keywords itself). */
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

  // Consent changes run in one transaction that locks this customer's row, so a STOP and a START/YES arriving at
  // the same time are applied one after the other and a YES can never restore consent after a STOP.
  const effects = { cancelAll: false, cancelPromos: false, sendStartConfirmation: false, sendReenrolled: false, sendPromoEnrolled: false, sendPromoConfirm: false };
  if (customer && keyword) {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.customers).where(eq(schema.customers.id, customer.id)).for("update");
      const consent = (scope: string, action: string) =>
        tx.insert(schema.smsConsents).values({ customerId: c.id, phone: from, scope, action, source: "keyword", method: "keyword", keyword: text.trim().toUpperCase(), wording: text });
      if (keyword === "stop") {
        // STOP blocks both programs until the customer re-enrolls in each one.
        await tx.update(schema.customers).set({ smsOptOut: true, marketingOptIn: false }).where(eq(schema.customers.id, c.id));
        await consent("transactional", "opt_out");
        await consent("marketing", "opt_out");
        await cancelPendingReenroll(tx, from); // a pending START confirmation dies; a late YES does nothing
        effects.cancelPromos = true;
        effects.cancelAll = smsTermsV2Active(); // SMS v3: STOP cancels every queued and scheduled message
        if (!exact) reply = OPT_OUT_CONFIRMATION;
      } else if (keyword === "start") {
        // START alone enrolls no one: it asks the customer to confirm with YES (order/service texts only).
        effects.sendStartConfirmation = (await handleStart(tx, c, from, text)).sendConfirmation;
      } else if (keyword === "yes") {
        // YES restores order/service consent only as a reply to an active START confirmation; otherwise nothing.
        // SMS Terms v2: YES also confirms a pending promotional confirmation text (written promotional consent).
        const r = await handleYes(tx, c, from, text);
        if (r.confirmed && r.scope === "marketing") effects.sendPromoEnrolled = true;
        else effects.sendReenrolled = r.confirmed;
      } else if (keyword === "join") {
        // SMS v3: JOIN only requests the confirmation text; it never confirms. Only YES within 24 hours signs up.
        // A request already waiting isn't repeated (no duplicate confirmations); never after STOP.
        effects.sendPromoConfirm = (await requestPromoConfirmation(tx, c, from, `texted "${text.trim()}"`)).sendConfirmation;
      } else if (keyword === "nopromo") {
        // Internal keyword: promotions only. It never clears or weakens a STOP (smsOptOut stays as it is).
        await tx.update(schema.customers).set({ marketingOptIn: false }).where(eq(schema.customers.id, c.id));
        await consent("marketing", "opt_out");
        effects.cancelPromos = true;
        if (!c.smsOptOut) reply = NOPROMO_CONFIRMATION;
      } else if (keyword === "help") {
        // Always answered (SMS Terms): identifies Hup Up Attractions and gives the support phone and email.
        reply = helpReply(settings.smsHelpText);
      }
    });
  }
  // Immediately after the opt-out is saved: no promotion that was queued, held or scheduled may still go out.
  if (effects.cancelAll) await cancelQueuedMessages(from);
  else if (effects.cancelPromos) await cancelQueuedPromotions(from);
  if (effects.sendStartConfirmation && customer)
    await sendMessage({ to: from, body: START_CONFIRMATION_SMS, kind: "system", event: "reenroll_request", customerId: customer.id });
  if (effects.sendReenrolled && customer)
    await sendMessage({ to: from, body: TRANSACTIONAL_CONFIRMATION_SMS, kind: "system", event: "consent_confirmation", customerId: customer.id });
  if (effects.sendPromoConfirm && customer)
    await sendMessage({ to: from, body: promoConfirmRequestSms(), kind: "system", event: "promo_confirm_request", customerId: customer.id });
  if (effects.sendPromoEnrolled && customer)
    await sendMessage({ to: from, body: PROMO_ENROLLED_SMS, kind: "system", event: "consent_confirmation", customerId: customer.id });

  // Section 18: CATALOG gets the catalog text back (not active until Twilio approves texting; never a promo sign-up)
  if (!keyword && isCatalogText(text)) {
    await replyToCatalogText(from, {
      optedOut: Boolean(customer?.smsOptOut),
      send: (to, b) => sendMessage({ to, body: b, kind: "transactional", event: "catalog_reply", customerId: customer?.id }),
    }).catch((e) => console.error("catalog text reply failed", e));
  }

  // Forward a copy to the owner (not for STOP/START, which Twilio handles, and not the owner's own texts).
  let forwarded = false;
  const fwd = toE164(settings.smsForwardPhone);
  if (settings.smsForwardEnabled && fwd && fwd !== from && keyword !== "stop" && keyword !== "start" && !((keyword === "yes" || keyword === "join") && (effects.sendReenrolled || effects.sendPromoEnrolled || effects.sendPromoConfirm))) {
    const who = customer?.name ? `${customer.name} ${formatPhone(from)}` : formatPhone(from);
    const r = await sendMessage({
      to: fwd,
      body: `Text to Hup Up Attractions from ${who}: ${text || "(no text)"}${mediaUrls.length ? ` [${mediaUrls.length} photo${mediaUrls.length > 1 ? "s" : ""}, see admin]` : ""}`,
      kind: "system",
      event: "owner_forward",
    });
    forwarded = r.sent;
  }

  // Owner alert (Abraham): an email copy of every text to the hotline (not STOP/START/YES/JOIN keywords), photos as a link
  if (!keyword || keyword === "help") await emailIncomingText({ from, body: text, mediaUrls, at: new Date() }).catch((e) => console.error("incoming text email failed", e));
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

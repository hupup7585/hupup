import { PROMO_ENDING_V2, PROMO_PREFIX_V2 } from "@/lib/sms-consent-copy";

/**
 * Promo text building blocks shared by the server and the Campaigns screen (no database here), so the live counter
 * and preview always match exactly what is sent. Abraham (all-in-one, section 7).
 */

/** Twilio's maximum message length; the count includes the required start and ending. */
export const PROMO_MAX_CHARS = 1600;
export const PROMO_MAX_PICTURES = 2;
/** Each picture is made about this wide and at most about this big (AT&T and Verizon: about 1 MB per text). */
export const PICTURE_WIDTH = 1080;
export const PICTURE_TARGET_BYTES = 500_000;
/** Server-side ceiling for a phone-ready picture (a little room over the target; far under Twilio's 5 MB). */
export const PICTURE_MAX_BYTES = 600_000;

/** Our Rentals section on the homepage. */
export const rentalsUrl = (base: string) => `${base.replace(/\/$/, "")}/#rentals`;

/** The offer as written, plus the Rentals page link when chosen. */
export function offerWithLink(body: string, rentalsLink: boolean, base: string): string {
  const offer = body.replace(/\s+/g, " ").trim();
  return rentalsLink ? `${offer} ${rentalsUrl(base)}`.trim() : offer;
}

/** "Hup Up Attractions: <offer> Reply NOPROMO to stop promos, STOP to stop all texts." (SMS Terms v3) */
export function promoTextV2(body: string): string {
  let offer = body.trim();
  offer = offer.replace(/^hup up attractions\s*[:\-]\s*/i, "");
  offer = offer.replace(/\s*reply stop to opt out\.?\s*/i, " ").trim();
  if (offer.endsWith(PROMO_ENDING_V2)) offer = offer.slice(0, -PROMO_ENDING_V2.length).trim();
  return `${PROMO_PREFIX_V2} ${offer} ${PROMO_ENDING_V2}`;
}

/** GSM-7 text: 160 characters in one segment, 153 per segment after that (anything else: 70 / 67). */
export function segments(text: string): { chars: number; segments: number } {
  const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const [one, many] = gsm ? [160, 153] : [70, 67];
  return { chars: text.length, segments: text.length <= one ? 1 : Math.ceil(text.length / many) };
}

/**
 * Cost estimate per customer, from Twilio's US list prices plus typical carrier fees (estimates only; the Twilio
 * bill is exact): SMS about $0.0083 a segment + about $0.003 carrier fee; MMS about $0.022 + about $0.01 carrier fee.
 */
export const SMS_SEGMENT_COST = 0.0083 + 0.003;
export const MMS_COST = 0.022 + 0.01;

export function promoCostEstimate(finalText: string, pictures: number, customers: number) {
  const mms = pictures > 0;
  const perCustomer = mms ? MMS_COST : segments(finalText).segments * SMS_SEGMENT_COST;
  return { kind: mms ? ("MMS" as const) : ("SMS" as const), perCustomer, total: perCustomer * customers };
}

export const dollars = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

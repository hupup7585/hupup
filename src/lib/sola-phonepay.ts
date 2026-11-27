import { signingSecret } from "@/lib/secret";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import { orderPath } from "@/lib/order-path";

/**
 * Pay by card on the phone through Sola PhonePay (Abraham, Nov 14, 2026). Replaces Stripe as the main phone payment;
 * the Stripe keypad payment stays built as an Owner-only backup that is off.
 *
 * Approved plan (Abraham, Nov 15, 2026):
 * 1. After the order read-back the hotline hands the call to the payment subaccount over SIP (PCI mode is on there,
 *    never on the main account). No payment link is offered in this flow.
 * 2. The subaccount dials Sola's free PhonePay line and sends, by itself, our PIN and pound, the order total in cents
 *    and pound, and 1 to confirm. The caller only keys the card. Star brings the caller back to our line at any time.
 * 3. Back on our line, the Sola call is hung up for sure, then Sola's reporting API is checked for this try's charge:
 *    the order total = Paid; another amount = voided automatically and the Owner is emailed; none = try again.
 * 4. Try again is a menu on our line (press 1), never on Sola's line: a new Sola call with the same order amount.
 *    Six tries at most; the Owner is emailed on the fifth and sixth. Every try is logged on the order.
 * We never hear, record or store card digits: only status, amount, last 4, card type, Sola reference and time.
 */
export const PHONEPAY_NUMBER_DEFAULT = "+18334343354";
export const PHONEPAY_BACKUP_DEFAULT = "+18444227356";
/** Default digits: wait 5 seconds, the PIN, pound. Abraham sets the real sequence after his test call. */
export const PHONEPAY_DIGITS_DEFAULT = "wwwwwwwwww{pin}#wwwwwwwwwwwwwwwwwwwwwwww{amount}#wwwwwwwwww1";

export type PhonePaySettings = {
  solaPhonePayOn: boolean;
  solaPhonePayOwnerOnly: boolean;
  solaPhonePayNumber: string;
  solaPhonePayBackup: string;
  solaPhonePayDigits: string;
  paymentTestNumbers?: string;
};

/** The payment test list: the Owner's phone plus each number in Admin (one per line). */
export function paymentTestList(s: Partial<PhonePaySettings>, env: Record<string, string | undefined> = process.env): string[] {
  const list = String(s.paymentTestNumbers ?? "").split(/[\n,;]+/).map((x) => toE164(x.trim())).filter((x): x is string => Boolean(x));
  const owner = toE164(env.ADMIN_PHONE) ?? "+18457777585";
  return [...new Set([owner, ...list])];
}

/** Is PhonePay offered to this caller right now? Off by default; Owner-test only by default. */
export function phonePayOffered(caller: string | null | undefined, s: Partial<PhonePaySettings>, env: Record<string, string | undefined> = process.env): boolean {
  if (!s.solaPhonePayOn) return false;
  // The hotline dials PhonePay itself (Abraham, Nov 17, 2026): only the PIN is needed, no payment subaccount
  if (!env.SOLA_PHONEPAY_PIN) return false;
  if (s.solaPhonePayOwnerOnly !== false) {
    const c = toE164(caller);
    return Boolean(c && paymentTestList(s, env).includes(c));
  }
  return true;
}

/**
 * The digits sent to PhonePay (Twilio sendDigits). Tokens: {pin}, {amount} (dollars and cents with no point, 230.00
 * = 23000), {dollars} (whole dollars, 230), {order} (order number, 1438). "w" waits half a second. Only 0-9, * , # and
 * w may remain; anything else is refused so a typo can never send stray tones.
 */
export function buildSendDigits(template: string, v: { pin: string; amountCents: number; orderNumber: string }): string {
  const out = (template || PHONEPAY_DIGITS_DEFAULT)
    .replace(/\s+/g, "")
    .replace(/\{pin\}/gi, v.pin.replace(/\D/g, ""))
    .replace(/\{amount\}/gi, String(Math.round(v.amountCents)))
    .replace(/\{dollars\}/gi, String(Math.floor(v.amountCents / 100)))
    .replace(/\{order\}/gi, v.orderNumber.replace(/\D/g, ""));
  if (!/^[0-9*#wW]*$/.test(out)) throw new Error("The PhonePay digits may hold only numbers, star, pound, w (half a second wait) and {pin}, {amount}, {dollars}, {order}.");
  if (out.length > 120) throw new Error("The PhonePay digits are too long (120 at most).");
  return out;
}

/** Check a template before saving (Admin). Returns an error or null. */
export function digitsTemplateError(template: string): string | null {
  try {
    buildSendDigits(template, { pin: "1234", amountCents: 23000, orderNumber: "1438" });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** The order travels to the subaccount in SIP headers, signed so it can't be changed on the way. */
export type PayKind = "order" | "custom";
const sig = (orderId: number, callSid: string, cents: number, kind: PayKind) =>
  createHmac("sha256", signingSecret()).update(`sola-phonepay:${kind}:${orderId}:${callSid}:${cents}`).digest("hex").slice(0, 32);

/** orderId 0 = an Owner custom charge with no order number. */
export function phonePaySipUri(orderId: number, callSid: string, cents: number, env: Record<string, string | undefined> = process.env, kind: PayKind = "order"): string {
  return `sip:phonepay@${env.TWILIO_PAY_SIP_DOMAIN}?X-Hup-Mode=phonepay&X-Hup-Kind=${kind}&X-Hup-Order=${orderId}&X-Hup-Call=${encodeURIComponent(callSid)}&X-Hup-Cents=${cents}&X-Hup-Sig=${sig(orderId, callSid, cents, kind)}`;
}

export function verifyPhonePaySip(body: Record<string, string>): { orderId: number; mainCallSid: string; cents: number; kind: PayKind } | null {
  if (body["SipHeader_X-Hup-Mode"] !== "phonepay") return null;
  const kind: PayKind = body["SipHeader_X-Hup-Kind"] === "custom" ? "custom" : "order";
  const orderId = Number(body["SipHeader_X-Hup-Order"]);
  const cents = Number(body["SipHeader_X-Hup-Cents"]);
  const mainCallSid = body["SipHeader_X-Hup-Call"] ?? "";
  const got = Buffer.from(body["SipHeader_X-Hup-Sig"] ?? "");
  if (!Number.isInteger(orderId) || orderId < (kind === "custom" ? 0 : 1) || !Number.isInteger(cents) || cents <= 0 || !mainCallSid) return null;
  const want = Buffer.from(sig(orderId, mainCallSid, cents, kind));
  return want.length === got.length && timingSafeEqual(want, got) ? { orderId, mainCallSid, cents, kind } : null;
}

/* ---- Owner custom charge (owner voicemail menu, key 7; Abraham, Nov 14, 2026) ---- */

/** Typed as dollars and cents with no point: 12500 = $125.00. Allowed: $1.00 up to the cap from Admin. */
export function parseCustomAmount(digits: string | null | undefined, capCents: number): number | null {
  const d = (digits ?? "").trim();
  if (!/^\d{3,7}$/.test(d)) return null;
  const cents = Number(d);
  return cents >= 100 && cents <= capCents ? cents : null;
}

/** For the read-back: "125 dollars and 0 cents". */
export function amountParts(cents: number) {
  return { dollars: Math.floor(cents / 100), cents: cents % 100 };
}

/* ---- Attempts (Admin shows the last 20; never any card data) ---- */

export async function startAttempt(orderId: number | null, callSid: string, amountCents: number, kind: PayKind = "order") {
  const [row] = await db.insert(schema.phonepayAttempts).values({ orderId: orderId || null, callSid, amountCents, kind }).returning();
  return row;
}

export async function finishAttempt(id: number, r: { matched: boolean; solaRef?: string | null; last4?: string | null; cardType?: string | null; note?: string | null }) {
  await db
    .update(schema.phonepayAttempts)
    .set({ endedAt: new Date(), matched: r.matched, solaRef: r.solaRef ?? null, last4: r.last4 && /^\d{4}$/.test(r.last4) ? r.last4 : null, cardType: r.cardType?.slice(0, 30) ?? null, note: r.note?.slice(0, 300) ?? null })
    .where(eq(schema.phonepayAttempts.id, id));
}

export async function recentAttempts(limit = 20) {
  return db.select().from(schema.phonepayAttempts).orderBy(desc(schema.phonepayAttempts.startedAt)).limit(limit);
}

export async function openAttemptFor(callSid: string, orderId: number) {
  const [row] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.callSid, callSid)).orderBy(desc(schema.phonepayAttempts.id)).limit(1);
  return row && (row.orderId ?? 0) === orderId && !row.endedAt ? row : null;
}

/* ---- Finding the payment in Sola ---- */

/** "2026-11-14 15:04:05" in New York time (Sola's reports) to a real time, daylight saving included. */
export function easternToDate(s: string): Date {
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  // also "11/14/2026 3:04:05 PM" (US style), in case Sola's report uses it
  const us = m ? null : /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s.trim());
  if (us) {
    let h = +us[4] % (us[7] ? 12 : 24);
    if (us[7]?.toUpperCase() === "PM") h += 12;
    m = ["", us[3], us[1].padStart(2, "0"), us[2].padStart(2, "0"), String(h), us[5], us[6]] as unknown as RegExpExecArray;
  }
  if (!m) return new Date(NaN);
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const off = (d: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(new Date(d)).find((x) => x.type === "timeZoneName")?.value ?? "GMT-05:00";
    const mm = /GMT([+-])(\d{2}):(\d{2})/.exec(p);
    return mm ? (mm[1] === "-" ? -1 : 1) * (+mm[2] * 60 + +mm[3]) : -300;
  };
  return new Date(asUtc - off(asUtc) * 60_000);
}

export type SolaTxn = { refNum: string; amountCents: number; at: Date; invoice: string | null; last4: string | null; cardType: string | null; approved: boolean };

/**
 * Sola (Cardknox) reporting API: POST https://x1.cardknox.com/reportjson, xCommand "Report:Approved" with xBeginDate
 * and xEndDate (Eastern time, "YYYY-MM-DD HH:MM:SS"). Read-only; uses SOLA_API_KEY. Confirm the field names against
 * Sola's docs on the first real test (Abraham's test call).
 */
export async function solaApprovedBetween(from: Date, to: Date, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<SolaTxn[]> {
  const key = env.SOLA_API_KEY;
  if (!key) throw new Error("Not active yet: SOLA_API_KEY isn't in Vercel.");
  const et = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" }).replace("T", " ");
  const res = await fetcher("https://x1.cardknox.com/reportjson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xKey: key, xVersion: "5.0.0", xSoftwareName: BUSINESS_NAME, xSoftwareVersion: "1.0", xCommand: "Report:Approved", xBeginDate: et(from), xEndDate: et(to) }),
  });
  const j = (await res.json().catch(() => ({}))) as { xResult?: string; xError?: string; xReportData?: Record<string, string>[] };
  if (j.xResult && j.xResult !== "S") throw new Error(`Sola report: ${j.xError || j.xResult}`);
  return (j.xReportData ?? []).map((r) => ({
    refNum: String(r.xRefNum ?? ""),
    amountCents: Math.round(Number(r.xAmount ?? 0) * 100),
    at: easternToDate(String(r.xEnteredDate ?? "")),
    invoice: r.xInvoice ? String(r.xInvoice) : null,
    last4: (String(r.xMaskedCardNumber ?? "").match(/(\d{4})\s*$/) ?? [])[1] ?? null,
    cardType: r.xCardType ? String(r.xCardType) : null,
    approved: String(r.xResponseResult ?? r.xStatus ?? "Approved").toLowerCase().startsWith("approv") || !r.xResponseResult,
  }));
}

/**
 * Which Sola payment is this caller's? Same amount to the cent, made during the call window; the order number wins
 * when PhonePay passes one. Two equal candidates and no order number = no match (staff check it; never a guess).
 */
export function pickMatch(txns: SolaTxn[], want: { amountCents: number; orderNumber: string; from: Date; to: Date }, alreadyUsed: Set<string> = new Set()): { match: SolaTxn | null; reason: "found" | "not_found" | "amount_mismatch" | "ambiguous" } {
  const inWindow = txns.filter((t) => t.approved && t.refNum && !alreadyUsed.has(t.refNum) && t.at >= new Date(want.from.getTime() - 60_000) && t.at <= new Date(want.to.getTime() + 120_000));
  const byInvoice = inWindow.filter((t) => t.invoice && t.invoice.replace(/\D/g, "") === want.orderNumber);
  if (byInvoice.length === 1) return byInvoice[0].amountCents === want.amountCents ? { match: byInvoice[0], reason: "found" } : { match: null, reason: "amount_mismatch" };
  // Code audit M7 (Nov 24, 2026): matching by amount never takes a payment made for another order (its Invoice is
  // one of our order numbers: a website link or the staff POS), so a custom charge cannot claim a customer's payment
  const byAmount = inWindow.filter((t) => t.amountCents === want.amountCents && isPhonePayInvoice(t.invoice));
  if (byAmount.length === 1) return { match: byAmount[0], reason: "found" };
  if (byAmount.length > 1) return { match: null, reason: "ambiguous" };
  return { match: null, reason: inWindow.some((t) => isPhonePayInvoice(t.invoice)) ? "amount_mismatch" : "not_found" };
}

export async function usedSolaRefs(): Promise<Set<string>> {
  const rows = await db.select({ ref: schema.phonepayAttempts.solaRef }).from(schema.phonepayAttempts);
  // Code audit M7: a Sola payment already recorded on any order is used too (website link or staff POS payments)
  const paid = await db.select({ ref: schema.orders.solaRefNum }).from(schema.orders).where(isNotNull(schema.orders.solaRefNum));
  return new Set([...rows.map((r) => r.ref), ...paid.map((r) => r.ref)].filter((r): r is string => Boolean(r)));
}

export const phonePayAdminUrl = () => `${config.baseUrl()}/admin/phone/phonepay`;

/** PhonePay payments are Sola payments: refunds, the books and reports treat them like any Sola payment. */
export const PHONEPAY_METHOD = "sola_phonepay";
export const isSolaMethod = (m: string | null | undefined) => m === "sola" || m === PHONEPAY_METHOD || m === "sola_phonepay_custom";
export const PHONEPAY_CUSTOM_METHOD = "sola_phonepay_custom";
export const paymentSourceLabel = (m: string | null | undefined) =>
  m === PHONEPAY_CUSTOM_METHOD ? "Phone, custom charge (owner)" : m === PHONEPAY_METHOD ? "Phone (Sola PhonePay)" : m === "sola" ? "Sola payment link" : m === "stripe" ? "Phone (Stripe keypad)" : m ? m.charAt(0).toUpperCase() + m.slice(1) : "";

/**
 * After the caller is back from PhonePay: look for the payment in Sola (Sola may take a few seconds to list it, so it
 * looks up to 3 times). Found = Paid with status, amount, last 4, card type, Sola reference and time. Not found, a
 * decline or a different amount = Payment pending: a high-priority callback task, an email to the Owner, and the
 * caller gets the secure payment link.
 */
export async function matchPhonePay(orderId: number, attemptId: number, dueCents: number, deps: { fetcher?: typeof fetch; waitMs?: number; now?: () => Date } = {}): Promise<{ paid: boolean; reason: string }> {
  const { getPaymentGroup, markGroupPaid, orderNumber } = await import("@/lib/orders");
  const [attempt] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
  const started = attempt?.startedAt ?? new Date(Date.now() - 15 * 60_000);
  // Deep check 06:00 M10: an earlier try of this order whose charge Sola could not be checked (check_failed) may have
  // gone through. Its time is looked at too, so that charge is found (paid once) or, with a second charge, both are
  // set aside as unclear (Owner emailed, voided after a later payment); never left unseen and never voided.
  const unchecked = await db
    .select({ startedAt: schema.phonepayAttempts.startedAt })
    .from(schema.phonepayAttempts)
    .where(and(eq(schema.phonepayAttempts.orderId, orderId), eq(schema.phonepayAttempts.result, "check_failed"), gte(schema.phonepayAttempts.startedAt, new Date(started.getTime() - 60 * 60_000))));
  const from = new Date(Math.min(started.getTime(), ...unchecked.map((u) => u.startedAt.getTime())));
  const num = orderNumber(orderId);
  let reason = "not_found";
  let found: SolaTxn | null = null;
  for (let i = 0; i < 3 && !found; i++) {
    if (i) await new Promise((r) => setTimeout(r, deps.waitMs ?? 3000));
    try {
      const txns = await solaApprovedBetween(new Date(from.getTime() - 60_000), deps.now?.() ?? new Date(), deps.fetcher);
      const r = pickMatch(txns, { amountCents: dueCents, orderNumber: num, from, to: deps.now?.() ?? new Date() }, await usedSolaRefs());
      reason = r.reason;
      found = r.match;
    } catch (e) {
      reason = `lookup_failed: ${(e as Error).message}`.slice(0, 200);
    }
  }
  if (found) {
    if (attemptId) await finishAttempt(attemptId, { matched: true, solaRef: found.refNum, last4: found.last4, cardType: found.cardType, note: "Paid" });
    const counted = await markGroupPaid(orderId, found.amountCents, PHONEPAY_METHOD, found.refNum);
    const group = await getPaymentGroup(orderId);
    const ids = group?.orders.map((d) => d.order.id) ?? [orderId];
    const { recordPaymentResult, paymentReceivedNotices } = await import("@/lib/payment-result");
    await recordPaymentResult(ids, "approved", found.last4, found.refNum, found.at);
    if (newlyCounted(counted)) await paymentReceivedNotices(orderId, found.amountCents);
    return { paid: true, reason: "found" };
  }
  if (attemptId) await finishAttempt(attemptId, { matched: false, note: reason });
  const why = reason === "amount_mismatch" ? "a Sola payment was found, but not for the order total" : reason === "ambiguous" ? "two Sola payments with the same amount were found" : reason.startsWith("lookup_failed") ? "Sola could not be checked" : "no Sola payment was found";
  await db.insert(schema.tasks).values({
    title: `Call back: phone payment not confirmed, order #${num}`,
    notes: `The caller went to Sola PhonePay for $${(dueCents / 100).toFixed(2)}, but ${why}. Check Sola, then mark the order paid or call the customer. The secure payment link was sent.`,
    priority: "high",
    dueDate: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
  });
  const to = config.adminEmail();
  if (to) {
    const { sendEmail } = await import("@/lib/notify");
    await sendEmail(to, `Hup Up Attractions: phone payment not confirmed, order #${num}`, `A caller paid by phone through Sola PhonePay for order #${num} ($${(dueCents / 100).toFixed(2)}), but ${why}.\n\nThe order is Payment pending and the customer was sent the secure payment link. A callback task is in Admin > Tasks.\n\n${config.baseUrl()}${orderPath(orderId)}`).catch(() => null);
  }
  return { paid: false, reason };
}

/* ---- Card payment on the phone line, approved plan (Abraham, Nov 15, 2026) ---- */


/**
 * Which Sola charge belongs to this card try? PhonePay sends no invoice number, and after an invalid card Sola asks for
 * the amount again, so the caller could key a different amount. This try's charges are the approved Sola charges made
 * between the start of the try and now (plus 2 minutes), not used before, with no invoice number (the website link
 * and the staff POS always send our order number, so a charge without one is a PhonePay charge).
 * - one or more for exactly the order total: the first is the payment ("paid"); any others are wrong
 * - none for the order total but some for other amounts: "wrong_amount" (they are voided)
 * - none: "none"
 */
export function classifyTry(
  txns: SolaTxn[],
  want: { amountCents: number; from: Date; to: Date; phone?: string | null },
  used: Set<string>,
): { kind: "paid" | "ambiguous" | "wrong_amount" | "none"; paid: SolaTxn | null; matches: SolaTxn[]; wrong: SolaTxn[]; byPhone: boolean } {
  // This try's own window: from when its call to Sola started to now (Abraham, Nov 18, 2026: never guess)
  let mine = txns
    .filter((t) => t.approved && t.refNum && !used.has(t.refNum) && isPhonePayInvoice(t.invoice) && t.at >= new Date(want.from.getTime() - 30_000) && t.at <= new Date(want.to.getTime() + 60_000))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  // The customer's phone in Sola's Invoice field: only charges with that phone are this caller's
  const phone = (want.phone ?? "").replace(/\D/g, "").slice(-10);
  const byPhone = Boolean(phone) && mine.some((t) => (t.invoice ?? "").replace(/\D/g, "").slice(-10) === phone);
  if (byPhone) mine = mine.filter((t) => (t.invoice ?? "").replace(/\D/g, "").slice(-10) === phone);
  const withPhone = <T extends object>(r: T) => ({ ...r, byPhone });
  // Safer check (Abraham, Nov 15, 2026): the exact order total, and only one such charge
  const matches = mine.filter((t) => t.amountCents === want.amountCents);
  const wrong = mine.filter((t) => t.amountCents !== want.amountCents);
  if (matches.length > 1) return withPhone({ kind: "ambiguous" as const, paid: null, matches, wrong });
  if (matches.length === 1) return withPhone({ kind: "paid" as const, paid: matches[0], matches, wrong });
  return withPhone({ kind: wrong.length ? ("wrong_amount" as const) : ("none" as const), paid: null, matches, wrong });
}

/**
 * Is this a PhonePay charge by its Invoice field? Empty, or a phone number (Sola fills in the calling number; our call
 * to Sola comes from the hotline). Never one of our order numbers (the website link and the staff POS send those).
 * Abraham, Nov 17, 2026: Sola puts a phone number in Invoice, so "empty only" would miss every PhonePay payment.
 */
export function isPhonePayInvoice(invoice: string | null | undefined): boolean {
  const d = (invoice ?? "").replace(/\D/g, "");
  return d.length === 0 || d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

/** Void a Sola charge (Sola gateway, cc:void). Only used for a PhonePay charge that is not the order total. */
export async function solaVoid(refNum: string, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<{ ok: boolean; error: string | null }> {
  const key = env.SOLA_API_KEY;
  if (!key) return { ok: false, error: "SOLA_API_KEY isn't in Vercel." };
  try {
    const res = await fetcher("https://x1.cardknox.com/gatewayjson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xKey: key, xVersion: "5.0.0", xSoftwareName: BUSINESS_NAME, xSoftwareVersion: "1.0", xCommand: "cc:void", xRefNum: refNum }),
    });
    const j = (await res.json().catch(() => ({}))) as { xResult?: string; xError?: string; xStatus?: string };
    return j.xResult === "A" ? { ok: true, error: null } : { ok: false, error: j.xError || j.xStatus || `Sola answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Deep check 06:00 M26: did this call count the payment (not only find it already counted)? Then the paid notice goes out. */
function newlyCounted(rows: object[]): boolean {
  return rows.some((r) => !("duplicate" in r && r.duplicate));
}

/** Make sure the payments subaccount's call to Sola is fully hung up (and anything it dialed). Best effort, quiet. */
export async function endPayLeg(paySid: string | null | undefined, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env) {
  const acct = env.TWILIO_PAY_ACCOUNT_SID;
  const tok = env.TWILIO_PAY_AUTH_TOKEN;
  if (!paySid || !acct || !tok) return;
  const auth = `Basic ${Buffer.from(`${acct}:${tok}`).toString("base64")}`;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${acct}/Calls`;
  const end = (sid: string) =>
    fetcher(`${base}/${sid}.json`, { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ Status: "completed" }) }).catch(() => null);
  try {
    const kids = (await (await fetcher(`${base}.json?ParentCallSid=${paySid}&Status=in-progress`, { headers: { authorization: auth } })).json().catch(() => ({}))) as { calls?: { sid: string }[] };
    for (const c of kids.calls ?? []) await end(c.sid);
    const me = (await (await fetcher(`${base}/${paySid}.json`, { headers: { authorization: auth } })).json().catch(() => ({}))) as { status?: string };
    if (me.status && !["completed", "canceled", "failed", "busy", "no-answer"].includes(me.status)) await end(paySid);
  } catch {
    /* the call is already over */
  }
}

/**
 * After one card try (the caller pressed star or Sola hung up): look in Sola for this try's charge, up to 3 times.
 * paid = the order is marked paid; wrong_amount = voided, not paid, the Owner is emailed; none = no charge.
 * Every try is logged on the order (time and result; never card numbers).
 */
export async function checkPhonePayTry(orderId: number, attemptId: number, dueCents: number, deps: { fetcher?: typeof fetch; waitMs?: number; now?: () => Date } = {}): Promise<{ result: "paid" | "wrong_amount" | "none" | "check_failed" | "unclear" }> {
  const { getPaymentGroup, markGroupPaid, orderNumber } = await import("@/lib/orders");
  const { recordPaymentResult, paymentReceivedNotices } = await import("@/lib/payment-result");
  const [attempt] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
  const started = attempt?.startedAt ?? new Date(Date.now() - 15 * 60_000);
  // Deep check 06:00 M10: an earlier try of this order whose charge Sola could not be checked (check_failed) may have
  // gone through. Its time is looked at too, so that charge is found (paid once) or, with a second charge, both are
  // set aside as unclear (Owner emailed, voided after a later payment); never left unseen and never voided.
  const unchecked = await db
    .select({ startedAt: schema.phonepayAttempts.startedAt })
    .from(schema.phonepayAttempts)
    .where(and(eq(schema.phonepayAttempts.orderId, orderId), eq(schema.phonepayAttempts.result, "check_failed"), gte(schema.phonepayAttempts.startedAt, new Date(started.getTime() - 60 * 60_000))));
  const from = new Date(Math.min(started.getTime(), ...unchecked.map((u) => u.startedAt.getTime())));
  const num = orderNumber(orderId);
  const group = await getPaymentGroup(orderId);
  const ids = group?.orders.map((d) => d.order.id) ?? [orderId];
  let c: ReturnType<typeof classifyTry> | null = null;
  let failed = "";
  for (let i = 0; i < 3 && c?.kind !== "paid"; i++) {
    if (i) await new Promise((r) => setTimeout(r, deps.waitMs ?? 3000));
    try {
      const now = deps.now?.() ?? new Date();
      c = classifyTry(await solaApprovedBetween(new Date(from.getTime() - 60_000), now, deps.fetcher), { amountCents: dueCents, from, to: now, phone: attempt?.callerPhone }, await usedSolaRefs());
      failed = "";
    } catch (e) {
      failed = (e as Error).message.slice(0, 200);
    }
  }
  const mail = async (subject: string, text: string) => {
    const to = config.adminEmail();
    if (!to) return;
    const { sendEmail } = await import("@/lib/notify");
    await sendEmail(to, subject, `${text}\n\n${config.baseUrl()}${orderPath(orderId)}`).catch(() => null);
  };
  // Never guess (Abraham, Nov 18, 2026). Not certain = two or more charges of exactly this amount in this try's window,
  // or one charge without this caller's phone in Invoice while another caller was paying the same amount at the same
  // time. Then nothing is marked paid or voided now; the caller hears box 147 and may try again. The unclear charges
  // are kept on this try and voided automatically once a later try goes through (paid branch below).
  const sameTime = await db
    .select({ callSid: schema.phonepayAttempts.callSid, amountCents: schema.phonepayAttempts.amountCents, startedAt: schema.phonepayAttempts.startedAt, endedAt: schema.phonepayAttempts.endedAt })
    .from(schema.phonepayAttempts)
    .where(gte(schema.phonepayAttempts.startedAt, new Date(from.getTime() - 15 * 60_000)));
  const rivalSameAmount = sameTime.some((o) => o.callSid !== attempt?.callSid && o.amountCents === dueCents && (!o.endedAt || o.endedAt >= from));
  if (c && (c.kind === "ambiguous" || (c.kind === "paid" && !c.byPhone && rivalSameAmount))) {
    const refs = c.matches.map((t) => t.refNum);
    await db.update(schema.phonepayAttempts).set({ result: "unclear", unclearRefs: refs.join(",") }).where(eq(schema.phonepayAttempts.id, attemptId));
    await finishAttempt(attemptId, { matched: false, note: "Payment could not be confirmed (box 147)" });
    await mail(
      `Hup Up Attractions: phone payment could not be confirmed, order #${num}`,
      `A caller paying order #${num} ($${(dueCents / 100).toFixed(2)}) by phone could not be matched for certain:\n\n${c.matches.map((t) => `$${(t.amountCents / 100).toFixed(2)}, Sola reference ${t.refNum}, card ending ${t.last4 ?? "?"}, Invoice ${t.invoice ?? "(empty)"}`).join("\n")}\n\nNothing was marked paid. The caller was asked to try again; if a later try goes through, these charges are voided automatically and you get another email.`,
    );
    return { result: "unclear" };
  }
  // A charge that is not the order total: voided automatically only when it is the only one in this try's window and
  // no other caller was paying by phone at the same time; otherwise left alone and the Owner is emailed
  const others = await db
    .select({ id: schema.phonepayAttempts.id, callSid: schema.phonepayAttempts.callSid, endedAt: schema.phonepayAttempts.endedAt })
    .from(schema.phonepayAttempts)
    .where(gte(schema.phonepayAttempts.startedAt, new Date(from.getTime() - 15 * 60_000)));
  const someoneElse = others.some((o) => o.callSid !== attempt?.callSid && (!o.endedAt || o.endedAt >= from));
  const safeToVoid = (c?.wrong.length ?? 0) === 1 && !someoneElse;
  const voids: string[] = [];
  for (const t of c?.wrong ?? []) {
    if (!safeToVoid) {
      voids.push(`$${(t.amountCents / 100).toFixed(2)} (Sola reference ${t.refNum}): NOT voided, because ${someoneElse ? "another caller was paying by phone at the same time" : "more than one such charge was found"}. Please check it in Sola`);
      continue;
    }
    const v = await solaVoid(t.refNum, deps.fetcher);
    voids.push(`$${(t.amountCents / 100).toFixed(2)} (Sola reference ${t.refNum}): ${v.ok ? "voided" : `could NOT be voided (${v.error}), please void or refund it in Sola`}`);
  }
  if (voids.length) await mail(`Hup Up Attractions: wrong phone payment amount, order #${num}`, `A caller paying order #${num} by phone was charged an amount that is not the order total ($${(dueCents / 100).toFixed(2)}).\n\n${voids.join("\n")}\n\nThat charge does not count as payment.`);
  if (c?.kind === "paid" && c.paid) {
    await db.update(schema.phonepayAttempts).set({ result: "paid" }).where(eq(schema.phonepayAttempts.id, attemptId));
    await finishAttempt(attemptId, { matched: true, solaRef: c.paid.refNum, last4: c.paid.last4, cardType: c.paid.cardType, note: `${voids.length ? "Paid; a second charge was voided" : "Paid"}${c.paid.invoice ? ` (Sola Invoice field: ${c.paid.invoice})` : ""}` });
    const counted = await markGroupPaid(orderId, c.paid.amountCents, PHONEPAY_METHOD, c.paid.refNum);
    await recordPaymentResult(ids, "approved", c.paid.last4, c.paid.refNum, c.paid.at);
    if (newlyCounted(counted)) await paymentReceivedNotices(orderId, c.paid.amountCents);
    await voidUnclearAfterPaid(orderId, c.paid.refNum, mail, deps.fetcher);
    return { result: "paid" };
  }
  const result = failed && !c ? "check_failed" : c?.kind === "wrong_amount" ? "wrong_amount" : "none";
  const label = result === "check_failed" ? `Sola could not be checked (${failed})` : result === "wrong_amount" ? "Wrong amount, voided" : "No charge";
  await db.update(schema.phonepayAttempts).set({ result: result === "wrong_amount" ? (voids.every((v) => v.includes(": voided")) ? "wrong_amount_voided" : "wrong_amount_not_voided") : result === "check_failed" ? "check_failed" : "declined" }).where(eq(schema.phonepayAttempts.id, attemptId));
  await finishAttempt(attemptId, { matched: false, note: label });
  // Hark's 2nd phone check, A1: "Sola could not be checked" is never recorded as declined on the order
  if (result !== "check_failed") await recordPaymentResult(ids, "declined", null, null);
  if (result === "check_failed") await mail(`Hup Up Attractions: phone payment could not be checked, order #${num}`, `A caller tried to pay order #${num} ($${(dueCents / 100).toFixed(2)}) by phone, but Sola could not be checked (${failed}). Please look in Sola before the caller tries again.`);
  return { result };
}

/**
 * Box 147 follow-up (Abraham, Nov 18, 2026): once a later try for the same order goes through, the charges set aside
 * as unclear on earlier tries are voided if Sola shows them approved, and the Owner gets an email.
 */
export async function voidUnclearAfterPaid(orderId: number, paidRef: string, mail: (subject: string, text: string) => Promise<void>, fetcher?: typeof fetch) {
  const earlier = (await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.orderId, orderId))).filter((a) => a.unclearRefs);
  const refs = [...new Set(earlier.flatMap((a) => (a.unclearRefs ?? "").split(",").filter(Boolean)))].filter((r) => r !== paidRef);
  if (!refs.length) return;
  const since = new Date(Math.min(...earlier.map((a) => a.startedAt.getTime())) - 60_000);
  const approved = await solaApprovedBetween(since, new Date(Date.now() + 60_000), fetcher).catch(() => null);
  const used = await usedSolaRefs();
  const lines: string[] = [];
  for (const ref of refs) {
    const t = approved?.find((x) => x.refNum === ref);
    if (!approved) lines.push(`Sola reference ${ref}: Sola could not be checked, please look at it in Sola`);
    else if (!t) lines.push(`Sola reference ${ref}: not approved in Sola, nothing to void`);
    else if (used.has(ref)) lines.push(`Sola reference ${ref}: it is another order's payment, so it was left alone`);
    else {
      const v = await solaVoid(ref, fetcher);
      lines.push(`$${(t.amountCents / 100).toFixed(2)} (Sola reference ${ref}): ${v.ok ? "voided" : `could NOT be voided (${v.error}), please void or refund it in Sola`}`);
    }
  }
  await db.update(schema.phonepayAttempts).set({ unclearRefs: null }).where(inArray(schema.phonepayAttempts.id, earlier.map((a) => a.id)));
  const { orderNumber } = await import("@/lib/orders");
  await mail(`Hup Up Attractions: unclear phone payment checked, order #${orderNumber(orderId)}`, `Order #${orderNumber(orderId)} is now paid (Sola reference ${paidRef}). The earlier charges that could not be confirmed:\n\n${lines.join("\n")}`);
}

/** How many card tries this call has made for this order (the next try number is this plus 1). */
export async function triesSoFar(callSid: string, orderId: number) {
  const rows = await db.select({ id: schema.phonepayAttempts.id }).from(schema.phonepayAttempts).where(and(eq(schema.phonepayAttempts.callSid, callSid), eq(schema.phonepayAttempts.orderId, orderId)));
  return rows.length;
}

/**
 * Sola PhonePay, dialed straight from the main hotline account (Abraham, Nov 17, 2026). The old hand-off through the
 * payment subaccount's SIP domain could never work: Twilio only lets an account dial its own SIP domains (error
 * 32214), so no call ever reached the subaccount. Same digits as before (PIN, the order amount, then 1), sent only once
 * PhonePay answers. Never recorded; no PCI mode is needed on the main account because we never collect card digits:
 * the caller keys them to Sola. Star (hangupOnStar) or Sola hanging up runs the action, back in our flow.
 */
export function phonePayDirectDial(
  vr: { dial: (attrs: Record<string, unknown>) => DialTarget },
  input: { number: string; digits: string; action: string; hangupOnStar?: boolean },
) {
  const dial = vr.dial({ action: input.action, method: "POST", timeout: 30, timeLimit: 900, answerOnBridge: true, record: "do-not-record", ...(input.hangupOnStar ? { hangupOnStar: true } : {}) });
  dial.number({ sendDigits: input.digits }, toE164(input.number) ?? input.number);
  return vr;
}

/** Dial results where PhonePay never answered: the backup number is tried once on the same card try. */
export const PHONEPAY_NOT_REACHED = ["failed", "busy", "no-answer", "canceled"];

/** The payment call on the main account ends for sure (it normally already has when the Dial action runs). */
export async function endMainPayLeg(sid: string | null | undefined) {
  if (!sid) return;
  try {
    const { getTwilio } = await import("@/lib/twilio-client");
    const c = getTwilio();
    const leg = c ? await c.calls(sid).fetch() : null;
    if (c && leg && !["completed", "canceled", "failed", "busy", "no-answer"].includes(leg.status)) await c.calls(sid).update({ status: "completed" });
  } catch {
    /* already over */
  }
}

type DialTarget = { number: (attrs: { sendDigits?: string }, phone: string) => unknown };
type DialHost = { dial: (attrs: Record<string, unknown>) => DialTarget };

/**
 * In the payment subaccount: dial PhonePay and send the digits once it answers. Never recorded. With an action URL,
 * an unanswered or failed call goes on to the backup number.
 */
export function phonePayDialTwiml(vr: DialHost, phone: string, digits: string, action: string | null) {
  const dial = vr.dial({ timeout: 30, timeLimit: 900, record: "do-not-record", ...(action ? { action, method: "POST" } : {}) });
  dial.number({ sendDigits: digits }, toE164(phone) ?? phone);
  return vr;
}


/**
 * Owner custom charge, after PhonePay hangs up: find the payment in Sola the same way. With an order number that is a
 * real order, a found payment is recorded on that order ("Phone, custom charge (owner)"). Without one, it is only
 * logged on the attempt. No card data, ever.
 */
/**
 * Owner custom charge without our amount (Abraham, Nov 24, 2026): the one approved Sola charge made during this call
 * to Sola (from the dial to the caller's return) is the match. More than one in that time = not certain (no match).
 */
export function pickWindowMatch(txns: SolaTxn[], want: { from: Date; to: Date }, alreadyUsed: Set<string> = new Set()): { match: SolaTxn | null; reason: "found" | "not_found" | "ambiguous" } {
  const inWindow = txns.filter((t) => t.approved && t.refNum && !alreadyUsed.has(t.refNum) && t.at >= new Date(want.from.getTime() - 60_000) && t.at <= new Date(want.to.getTime() + 120_000));
  if (inWindow.length === 1) return { match: inWindow[0], reason: "found" };
  return { match: null, reason: inWindow.length ? "ambiguous" : "not_found" };
}

/** cents = null: no amount entered on our line, the charge is matched by the time of the call to Sola (pickWindowMatch). */
export async function matchCustomCharge(attemptId: number, cents: number | null, orderId: number | null, deps: { fetcher?: typeof fetch; waitMs?: number; now?: () => Date; madeBy?: string } = {}): Promise<{ found: boolean; reason: string; orderId?: number | null }> {
  const { orderNumber, markGroupPaid } = await import("@/lib/orders");
  const [attempt] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
  const from = attempt?.startedAt ?? new Date(Date.now() - 15 * 60_000);
  const num = orderId ? orderNumber(orderId) : "";
  let reason = "not_found";
  let found: SolaTxn | null = null;
  for (let i = 0; i < 3 && !found; i++) {
    if (i) await new Promise((r) => setTimeout(r, deps.waitMs ?? 3000));
    try {
      const now = deps.now?.() ?? new Date();
      const txns = await solaApprovedBetween(new Date(from.getTime() - 60_000), now, deps.fetcher);
      const r = cents === null ? pickWindowMatch(txns, { from, to: now }, await usedSolaRefs()) : pickMatch(txns, { amountCents: cents, orderNumber: num || "none", from, to: now }, await usedSolaRefs());
      reason = r.reason;
      found = r.match;
    } catch (e) {
      reason = `lookup_failed: ${(e as Error).message}`.slice(0, 200);
    }
  }
  if (!found) {
    await finishAttempt(attemptId, { matched: false, note: reason });
    return { found: false, reason };
  }
  // No order number (Abraham, Nov 14, 2026): a new order is made for this payment, every detail left empty, marked as
  // made on the hotline by the Owner or the Secretary with the phone number used
  if (!orderId) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const [o] = await db
      .insert(schema.orders)
      .values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: today, pickupDate: today, subtotalCents: found.amountCents, totalCents: found.amountCents, notes: `Custom charge made on the hotline by ${deps.madeBy ?? "the Owner"}. Fill in the customer and rental details.` })
      .returning({ id: schema.orders.id });
    orderId = o.id;
    await db.update(schema.phonepayAttempts).set({ orderId }).where(eq(schema.phonepayAttempts.id, attemptId));
  }
  if (cents === null) await db.update(schema.phonepayAttempts).set({ amountCents: found.amountCents }).where(eq(schema.phonepayAttempts.id, attemptId));
  await finishAttempt(attemptId, { matched: true, solaRef: found.refNum, last4: found.last4, cardType: found.cardType, note: "Paid" });
  if (orderId) {
    await markGroupPaid(orderId, found.amountCents, PHONEPAY_CUSTOM_METHOD, found.refNum);
    const { recordPaymentResult } = await import("@/lib/payment-result");
    await recordPaymentResult([orderId], "approved", found.last4, found.refNum, found.at);
  }
  return { found: true, reason: "found", orderId };
}

/** Who made a custom charge on the hotline: "the Owner from (845) 777-7585" or "Secretary Sara from (845) 555-0123". */
export async function customChargeMadeBy(fromNumber: string | null | undefined, env: Record<string, string | undefined> = process.env): Promise<string> {
  const { formatPhone } = await import("@/lib/phone");
  const phone = toE164(fromNumber);
  const shown = phone ? formatPhone(phone) : "a withheld number";
  if (phone && phone === toE164(env.ADMIN_PHONE)) return `the Owner from ${shown}`;
  if (phone) {
    const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.phone, phone)).limit(1);
    if (u) return `${u.role === "owner" ? "the Owner" : u.role === "secretary" ? "the Secretary" : "staff member"} ${u.name} from ${shown}`;
  }
  return `staff from ${shown}`;
}

/**
 * Music while connecting to the payment line (Abraham, Nov 17, 2026, items 4 and 10): the caller waits in a private
 * queue with the Owner's music, while a separate call to Sola PhonePay enters the merchant code and the amount; then
 * that call joins the caller, so the caller never hears the key tones. Same cost as before (one call to Sola).
 * Returns false when the call to Sola could not be started (the caller then gets the direct way, as before).
 */
export const payQueueName = (callerSid: string) => `pay-${callerSid}`;
export async function startPayLegWithMusic(input: { callerSid: string; number: string; attemptId: number; baseUrl: string; redial?: boolean; waitMs?: number }): Promise<boolean> {
  try {
    // A second call right after the first one can be dropped by Sola (Nov 23, 2026): a short wait first
    if (input.waitMs) await new Promise((r) => setTimeout(r, input.waitMs));
    const { getTwilio } = await import("@/lib/twilio-client");
    const c = getTwilio();
    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!c || !from) return false;
    const leg = await c.calls.create({
      to: toE164(input.number) ?? input.number,
      from,
      url: `${input.baseUrl}/api/voice/pay-leg?a=${input.attemptId}`,
      method: "POST",
      statusCallback: `${input.baseUrl}/api/voice/pay-leg-status?a=${input.attemptId}${input.redial ? "&r=1" : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed"],
      timeout: 30,
      timeLimit: 900,
    });
    await db.update(schema.phonepayAttempts).set({ payLegSid: leg.sid }).where(eq(schema.phonepayAttempts.id, input.attemptId));
    return true;
  } catch (e) {
    console.error("payment line call could not start", e);
    return false;
  }
}

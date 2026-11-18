import bcrypt from "bcryptjs";
import twilio from "twilio";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { addDays, spokenLongDate, todayISO } from "@/lib/dates";
import { spokenMoney } from "@/lib/money";
import { formatPhone, last4, spokenDigits, toE164 } from "@/lib/phone";
import { logStamp, phonePromoMode, phonePromoOn, readBack, tenDigitNumber } from "@/lib/phone-promo";
import { checkBookable, pickupDateFor } from "@/lib/availability";
import { checkEventDate } from "@/lib/jewish-calendar";
import { officeOpenNow, websiteHoursLines } from "@/lib/business-hours";
import {
  PAYMENT_HOLD_MINUTES,
  PHONE_HOLD_MINUTES,
  cancelHold,
  getOrderWithItems,
  getPaymentGroup,
  minutesFromNow,
  orderNumber,
  refreshOrderTotals,
  reserveItem,
  upsertCustomer,
} from "@/lib/orders";
import { payPageLink } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";
import { sendEmail, sendSms } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { totalsWithFee } from "@/lib/pricing";
import { deliveryQuote } from "@/lib/delivery-areas";
import { DEFAULT_ZIP, townForZip } from "@/lib/orange-zips";
import { nextPiece, placeTracks } from "@/lib/music";
import { deliveryFeeFor } from "@/lib/offer-delivery";
import { CURRENT_TERMS_VERSION, recordTermsAcceptance, termsActive } from "@/lib/rental-terms";
import { sendMessage } from "@/lib/sms";
import { STEP_LABELS, track, trackStep } from "@/lib/call-journey";
import { alertMissedCall } from "@/lib/owner-alerts";
import { promoConfirmRequestSms, smsTermsV2Active } from "@/lib/sms-terms-v2";
import { requestPromoConfirmation } from "@/lib/sms-reenroll";
import {
  MARKETING_CONFIRMATION_SMS,
  TRANSACTIONAL_FOOTER,
  consentState,
  parseConsentAnswer,
  recordConsent,
  shouldAskMarketing,
  wordingVersion,
} from "@/lib/sms-consent";
import { ensureSession, getSession, updateSession, type CallSession } from "./session";
import { stripePhonePayMode, keypadPayFor, keypadPayOn, paySipUri } from "@/lib/phone-pay";
import { blockIfTooManyCalls, isPhonePayBlocked, phonePayLimits, startPayWatch, startSolaListen } from "@/lib/phonepay-watch";
import { PHONEPAY_NOT_REACHED, amountParts, buildSendDigits, checkPhonePayTry, customChargeMadeBy, endMainPayLeg, endPayLeg, matchCustomCharge, parseCustomAmount, payQueueName, phonePayDirectDial, phonePayOffered, startPayLegWithMusic, startAttempt, triesSoFar } from "@/lib/sola-phonepay";
import { pauseRecording, resumeRecording } from "@/lib/call-recording";

/** Pay prompts that must all be approved before keypad payment goes live for every caller. */
const PHONEPAY_PROMPTS = ["phonepay_intro", "phonepay_back", "phonepay_paid", "phonepay_retry", "phonepay_retry_last", "phonepay_failed", "phonepay_unclear"] as const;
const PAY_PROMPTS = ["pay_start", "pay_card_number", "pay_expiration", "pay_security_code", "pay_postal_code", "pay_processing", "pay_success", "pay_declined"] as const;
import { normalizeSpokenAddress, normalizeSpokenEmail, normalizeSpokenName, parseDateInput } from "./parse";
import { liveVoiceLink, voicemailPlayLink } from "@/lib/signed-link";
import { infoCatalogAutoreplyOn, catalogText, recordCatalogRequest, sendCatalogEmail } from "@/lib/catalog-send";
import { CATALOG_ENDINGS, decodeCatalogKeys, spellOut, spokenEmail, spokenLetters, validDomain, validLocal } from "./catalog-keys";
import { boxById, boxForKey, finalizeCallRecordings, mainBox, recordingFinished, saveRecording, saveTranscription, setRecordingState, textingActive } from "@/lib/voicemail";
import { RING_KEYS, extensionName, lineRingsNow, ringAttempts, ringListFor, staffAnnouncement, type RingKey } from "./routing";
import { calendarNow } from "@/lib/clock";
import { bookingLock, erevCandleLighting, isShabbosOrYomTov, localISO } from "@/lib/jewish-calendar";
import { matchBlock, parseBlockList } from "./caller-filter";
import { PROMPTS, composeClips, fill, googleLiveOn, loadPromptOverrides, promptAudio, promptText, promptWaiting, type PromptKey, type PromptOverrides } from "./prompts";
import { messageDate } from "@/lib/dual-date";
import { decodeMultitap, titleCase } from "./multitap";
import { startRecording } from "@/lib/call-recording";
import { categoryProducts, itemFreeOn, nearestFreeDay, nearestSize } from "@/lib/alternatives";
import { BOX_BY_NUMBER, CALLBACK_CALLER_ID, VM_ACCESS_KEYS, VM_ACCESS_KEY_GAP, VM_PIN_TRIES, callOutActive, callOutNumber, callbackNumber, checkVmPin, lockVmAccess, logVmAccess, vmAccessActive, vmLockedUntil, vmPinChangedByPhone, validPin } from "@/lib/vm-access";
import { STT_HOLD_FILE, STT_MAX_WAITS, googleReadback, runLater, sttActive, transcribeAnswer } from "@/lib/speech-to-text";

const { categories, products, orders, orderItems } = schema;
type VR = InstanceType<typeof twilio.twiml.VoiceResponse>;
type Gather = ReturnType<VR["gather"]>;

export type Ctx = {
  action: string;
  query: URLSearchParams;
  body: Record<string, string>;
  callSid: string;
  from: string | null;
  session: CallSession | null;
  prompts: PromptOverrides;
};

/* ------------------------------------------------------------------ helpers */

const MAX_NO_INPUT = 3;

function voice() {
  return { voice: config.voice() as never, language: "en-US" as never };
}

export function url(action: string, params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const q = qs.toString();
  return `${config.baseUrl()}/api/voice/${action}${q ? `?${q}` : ""}`;
}

function say(target: VR | Gather, text: string) {
  target.say(voice(), text);
}

/** Speak a catalog prompt: uploaded recording if there is one, otherwise the (editable) text. */
function sp(target: VR | Gather, ctx: { prompts: PromptOverrides }, key: PromptKey, vars?: Record<string, string | number>, opts: { draftOk?: boolean } = {}) {
  // Abraham (Phone Recordings): a line waiting for his OK never plays. draftOk: steps only the Owner's own test calls
  // reach (keypad payment in owner_test mode), so he hears the drafts he is reviewing.
  if (promptWaiting(ctx.prompts, key) && !(opts.draftOk && !keypadPayOn())) return;
  const audio = promptAudio(ctx.prompts, key);
  if (audio) return void target.play(audio);
  // Achird for the whole line (Owner switch): put together from Hark's recordings when every part is recorded
  const clips = vars ? composeClips(ctx.prompts, key, vars) : null;
  if (clips) return void clips.forEach((u) => target.play(u));
  // Option B (Owner switch, off): Google speaks the line in Achird; otherwise the live voice (Puck)
  if (vars && googleLiveOn(ctx.prompts)) return void target.play(liveVoiceLink(promptText(ctx.prompts, key, vars)));
  say(target, promptText(ctx.prompts, key, vars));
}

function pause(target: VR | Gather, seconds = 1) {
  target.pause({ length: seconds });
}

function keypad(vr: VR, action: string, opts: { numDigits?: number; timeout?: number; finishOnKey?: string } = {}) {
  return vr.gather({
    input: ["dtmf"],
    numDigits: opts.numDigits ?? 1,
    timeout: opts.timeout ?? 6,
    finishOnKey: opts.finishOnKey ?? "",
    action,
    method: "POST",
    // On timeout Twilio falls through to the next verb (our noInput redirect).
  });
}

/** "Sunday, November twenty-second": every date the phone reads (Abraham, Nov 18, 2026: the day as an ordinal). */
export function spokenDate(iso: string): string {
  return spokenLongDate(iso);
}

/** Booking steps (Abraham, Nov 11): no key pressed -> the same step again; 9 minutes idle the warning, 10 minutes end. */
function bookNoInput(vr: VR, ctx: Ctx, retryAction: string, retryParams: Record<string, string | number | undefined> = {}) {
  return idleNoKey(vr, ctx, retryAction, retryParams);
}

/** The item is free on that day, and the day is open (not past, not Shabbes/Yom Tov/closed, pickup rules applied). */
/**
 * A line still waiting for Abraham's OK: plays on preview for his test, and on the live line only once approved
 * (unlike draftOk, which also plays on the live line in the Owner-only payment steps).
 */
function spPreviewDraft(target: VR | Gather, ctx: { prompts: PromptOverrides }, key: PromptKey, vars?: Record<string, string | number>) {
  if (process.env.VERCEL_ENV === "production" && promptWaiting(ctx.prompts, key)) return;
  if (promptWaiting(ctx.prompts, key)) say(target, promptText(ctx.prompts, key, vars));
  else sp(target, ctx, key, vars);
}

/** Speech (plus optional keypad) gather tuned for phone audio. */
function speech(vr: VR, action: string, hints: string, opts: { dtmf?: boolean; numDigits?: number; finishOnKey?: string; partial?: string } = {}) {
  return vr.gather({
    ...(opts.partial ? { partialResultCallback: opts.partial, partialResultCallbackMethod: "POST" } : {}),
    input: opts.dtmf ? ["speech", "dtmf"] : ["speech"],
    action,
    method: "POST",
    language: "en-US",
    speechModel: "phone_call",
    enhanced: true,
    speechTimeout: "auto",
    timeout: 7,
    hints,
    profanityFilter: false,
    actionOnEmptyResult: true,
    ...(opts.dtmf ? { finishOnKey: opts.finishOnKey ?? "#", numDigits: opts.numDigits } : {}),
  });
}

/** Inside a booking (Abraham, Nov 11): no key -> "Sorry, I didn't catch that..." and the same step again (idle rule). */
function noInput(vr: VR, ctx: Ctx, retryAction: string, retryParams: Record<string, string | number | undefined> = {}) {
  sp(vr, ctx, "no_input");
  return idleNoKey(vr, ctx, retryAction, retryParams);
}

/*
 * No key pressed (Abraham, Nov 11, 2026).
 * Menus (main menu, information menus, voicemail options, the bookings menu before a booking starts): the whole menu
 * plays again. The call ends only after 3 full plays with no key AND at least 20 seconds since the first play began.
 * Inside a booking (items, between items, details, cart, payment): no 3-play hang-up. After 9 minutes with no key the
 * warning plays; after 10 minutes the call ends. Hanging up in voicemail still keeps the message.
 */
export const MENU_PLAYS_BEFORE_END = 3;
export const MENU_MIN_SECONDS = 20;
export const IDLE_WARN_MS = 9 * 60_000;
export const IDLE_END_MS = 10 * 60_000;

const encodeTo = (action: string, params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return { to: action, q: q.toString() || undefined };
};

/** Menus: the fallthrough after a play with no key. np = plays finished, t0 = when the first play started. */
function repeatMenu(vr: VR, ctx: Ctx, action: string, params: Record<string, string | number | undefined> = {}) {
  const np = Number(ctx.query.get("np") || 0) + 1;
  const t0 = Number(ctx.query.get("t0")) || Date.now();
  vr.redirect({ method: "POST" }, url("no-key", { ...encodeTo(action, params), np, t0 }));
  return vr;
}

/** Inside a booking: the fallthrough after a step with no key (the idle clock decides). */
function idleNoKey(vr: VR, ctx: Ctx, action: string, params: Record<string, string | number | undefined> = {}) {
  vr.redirect({ method: "POST" }, url("idle", encodeTo(action, params)));
  return vr;
}

/** Milliseconds since the caller last pressed a key (or said something), or since the call started. */
function idleMs(ctx: Ctx, now = Date.now()) {
  const last = Number(ctx.session?.data.lastKeyAt) || (ctx.session?.startedAt ? new Date(ctx.session.startedAt).getTime() : now);
  return now - last;
}

/** Back to a step, carrying the menu's no-key count. */
function toStep(vr: VR, ctx: Ctx, extra: Record<string, string | number | undefined> = {}) {
  const to = ctx.query.get("to") || "menu";
  const params = Object.fromEntries(new URLSearchParams(ctx.query.get("q") || ""));
  vr.redirect({ method: "POST" }, url(to, { ...params, ...extra }));
  return vr;
}

/** Main menu (Abraham): seconds to wait for a choice after the last menu line. */
export const MENU_WAIT_SECONDS = 3;

/** No choice after the main menu: the main menu prompt again, without the greeting (3 plays and 20 seconds rule). */
function menuNoChoice(vr: VR, ctx: Ctx) {
  return repeatMenu(vr, ctx, "menu");
}

/**
 * A prompt of several lines (the main menu): an uploaded recording plays as one file; spoken from the text, each
 * sentence is said on its own with a half-second pause between them.
 */
function spLines(target: VR | Gather, ctx: { prompts: PromptOverrides }, key: PromptKey) {
  if (promptWaiting(ctx.prompts, key)) return;
  const audio = promptAudio(ctx.prompts, key);
  if (audio) return void target.play(audio);
  const lines = promptText(ctx.prompts, key).split(/(?<=[.!?])\s+|\n+/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((l, i) => {
    say(target, l);
    if (i < lines.length - 1) halfPause(target);
  });
}

/**
 * Shabbes and Yom Tov (Abraham, Nov 14, 2026, choice A): the whole hotline is closed. The closed greeting with the day
 * and time we open again, then the tone; the message goes to the general voicemail (key 9's box). Draft wording: on
 * preview now, on the live line once Abraham approves it. Returns null when the hotline is open (or the greeting waits).
 */
async function hotlineClosed(ctx: Ctx, vr: VR): Promise<VR | null> {
  const lock = bookingLock(calendarNow(), await getSettings());
  const closedKey = lock.reason === "Yom Tov" ? "closed_yomtov_greeting" : "closed_shabbos_greeting";
  if (!lock.locked || (process.env.VERCEL_ENV === "production" && promptWaiting(ctx.prompts, closedKey))) return null;
  const opens = lock.opensAt ?? new Date();
  sp(vr, ctx, closedKey, {
    day: opens.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" }),
    time: opens.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }),
  }, { draftOk: true });
  await updateSession(ctx.callSid, { outcome: "voicemail", data: { missed: "closed" } }, ctx.session);
  return vmRecord(vr, await vmBox("9"), "closed");
}

/** Item lists with 10 or more items: seconds to wait for a second key after the first (Abraham, Nov 17, 2026). */
export const MULTI_KEY_WAIT_SECONDS = 2;

/** Items in a hidden add-on group (ocean balls, laser tag extra packs), in size order. */
async function addOnProducts(categoryName: string) {
  return db
    .select({ id: products.id, name: products.name })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(categories.name, categoryName), eq(products.active, true)))
    .orderBy(asc(products.sizeOrder), asc(products.id));
}
/** The three ocean ball sets (a hidden category "Ocean balls", sizes 1 to 3: 200, 500 and 700 balls). */
const oceanBallProducts = () => addOnProducts(OCEAN_BALLS_CATEGORY);
export const OCEAN_BALLS_CATEGORY = "Ocean balls";
export const LASER_ADDONS_CATEGORY = "Laser tag add-ons";

/** A maze or laser guns (the laser tag category, not its hidden extra packs). */
async function isLaserBase(categoryId: number) {
  const [cat] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId));
  return Boolean(cat && /laser/i.test(cat.name) && cat.name !== LASER_ADDONS_CATEGORY);
}

type ResumeLine = NonNullable<CallSession["data"]["resumeLines"]>[number];

const RESUME_PROMPTS = ["resume_offer"] as const;

/** Unfinished-cart offer: once Abraham approves its two lines; on preview it runs for his test. */
function resumeActive(ctx: Ctx, env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV !== "production" || RESUME_PROMPTS.every((k) => !promptWaiting(ctx.prompts, k));
}

/**
 * The cart from this number's most recent earlier call that ended without an order (the hold was released when they
 * hung up). Offered until its booking day has passed (Abraham, Nov 15, 2026), and not once the caller has booked on
 * a later call.
 */
async function unfinishedCart(ctx: Ctx): Promise<{ productId: number; name: string; qty: number; date: string }[]> {
  const from = toE164(ctx.session?.fromNumber ?? ctx.from);
  if (!from) return [];
  const today = todayISO();
  const res = await db.execute(sql`
    SELECT cs.call_sid FROM call_sessions cs
    WHERE cs.from_number = ${from} AND cs.call_sid <> ${ctx.callSid}
      AND EXISTS (SELECT 1 FROM orders o WHERE o.call_sid = cs.call_sid AND o.status = 'CANCELLED' AND o.paid_cents = 0 AND o.event_date >= ${today}::date)
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.call_sid = cs.call_sid AND o.status <> 'CANCELLED')
      AND NOT EXISTS (
        SELECT 1 FROM call_sessions later JOIN orders o2 ON o2.call_sid = later.call_sid
        WHERE later.from_number = ${from} AND later.started_at > cs.started_at AND o2.status <> 'CANCELLED')
    ORDER BY cs.started_at DESC LIMIT 1`);
  const last = (res.rows[0] as { call_sid: string } | undefined)?.call_sid;
  if (!last) return [];
  const rows = await db
    .select({ productId: orderItems.productId, qty: orderItems.qty, date: orders.eventDate, name: products.name })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orders.callSid, last), eq(orders.status, "CANCELLED")));
  return rows.filter((r) => r.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date));
}

/** The directions step plays once Abraham approves its two lines; on preview it runs for his test. */
function directionsActive(ctx: Ctx, env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV !== "production" || (!promptWaiting(ctx.prompts, "ask_directions") && !promptWaiting(ctx.prompts, "directions_saved"));
}

/** The address in steps (Abraham, Nov 17, 2026): on preview now; on the live line once every draft step is approved. */
export const ADDRESS_STEP_DRAFTS: PromptKey[] = ["addr_house", "addr_unit", "addr_zip", "addr_zip_enter", "addr_zip_bad", "addr_outside", "addr_not_found", "addr_readback", "addr_price"];
function addrStepsActive(ctx: Ctx, env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV !== "production" || ADDRESS_STEP_DRAFTS.every((k) => !promptWaiting(ctx.prompts, k));
}

/** A line's wording with its changing parts still in braces (Admin edits included). */
function lineTemplate(ctx: Ctx, key: PromptKey) {
  return ctx.prompts[key]?.text?.trim() || PROMPTS[key].text;
}

/** A spoken answer typed up on THIS call (never another caller's). */
async function callSpokenAnswer(ctx: Ctx, id: number) {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [row] = await db.select().from(schema.spokenAnswers).where(and(eq(schema.spokenAnswers.id, id), eq(schema.spokenAnswers.callSid, ctx.callSid))).limit(1);
  return row;
}

/** Spoken letters for the catalog email: hints so Google hears single letters and the symbol words. */
const CATALOG_LETTER_HINTS = "a b c d e f g h i j k l m n o p q r s t u v w x y z dot underscore dash".split(" ");

function back(vr: VR, action: string, params: Record<string, string | number | undefined> = {}) {
  vr.redirect({ method: "POST" }, url(action, params));
  return vr;
}

async function phoneCategories() {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.active, true), isNotNull(categories.ivrDigit)))
    .orderBy(asc(categories.ivrDigit));
}

async function phoneProducts(categoryId: number) {
  // Every item (Abraham, Nov 17, 2026): item 10 is "press 10" (two keys); lists of 10 or more wait briefly for a second key
  return (await categoryProducts(categoryId)).slice(0, 99);
}

async function getProduct(id: number) {
  const [p] = await db.select().from(products).where(eq(products.id, id));
  return p ?? null;
}

/** The caller's live held order, if any. */
async function currentOrder(ctx: Ctx) {
  const id = ctx.session?.orderId;
  if (!id) return null;
  const full = await getOrderWithItems(id);
  if (!full || full.order.status !== "HOLD") return null;
  return full;
}

/** Every held order on this call (one per rental day), earliest day first. */
async function callOrders(ctx: Ctx) {
  const ids = [...new Set([...(ctx.session?.data.dayOrderIds ?? []), ...(ctx.session?.orderId ? [ctx.session.orderId] : [])])];
  const out: NonNullable<Awaited<ReturnType<typeof getOrderWithItems>>>[] = [];
  for (const id of ids) {
    const full = await getOrderWithItems(id);
    if (full && full.order.status === "HOLD" && full.items.length) out.push(full);
  }
  return out.sort((a, b) => a.order.eventDate.localeCompare(b.order.eventDate) || a.order.id - b.order.id);
}

const money = (cents: number) => (cents / 100).toFixed(2);

function itemPhrase(qty: number, name: string) {
  return qty === 1 ? `one ${name}` : `${qty} ${name}`;
}



async function customerByPhone(phone: string) {
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  return c ?? null;
}

/** The three types of attraction on keys 2 and 3 (Abraham W). */
const ATTRACTIONS = {
  "1": { label: "jumping balloons", instr: "instr_balloons", learn: "learn_balloons", match: /balloon|bounce|jump|inflatable(?!.*maze)/i },
  "2": { label: "laser tag", instr: "instr_laser", learn: "learn_laser", match: /laser/i },
  "3": { label: "paddle boats", instr: "instr_paddle", learn: "learn_paddle", match: /paddle|boat/i },
} as const;

function attractionMenu(ctx: Ctx, vr: VR, m: "i" | "l") {
  const g = keypad(vr, url("attraction-choice", { m }));
  if (m === "i") {
    sp(g, ctx, "instr_menu"); // Abraham, Phone Menu v3, word for word (recorded information, day and night)
    return repeatMenu(vr, ctx, "instructions", { again: 1 });
  }
  if (!ctx.query.get("again")) sp(g, ctx, "learn_intro");
  sp(g, ctx, "attraction_choice");
  sp(g, ctx, "attraction_menu_back");
  return repeatMenu(vr, ctx, "learn", { again: 1 });
}

/** The Admin category for a type (by name, so a rename in Admin still works; else the one on that booking key). */
async function attractionCategory(t: "1" | "2" | "3") {
  const cats = await phoneCategories();
  return cats.find((c) => ATTRACTIONS[t].match.test(c.name)) ?? cats.find((c) => String(c.ivrDigit) === t) ?? null;
}

/** Is this item in the bounce house (jumping balloons) category? */
async function isBounceHouse(categoryId: number) {
  const [cat] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId));
  return Boolean(cat && ATTRACTIONS["1"].match.test(cat.name));
}

/** "a, b and c" */
function listPhrase(names: string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Call log labels for main-menu keys (not spoken). */
const MAIN_KEY_LABELS: Record<string, string> = {
  "1": "book a rental",
  "2": "instructions",
  "3": "customer service",
  "4": "learn about our rentals",
  "5": "questions or problems during a rental",
  "6": "delivery and pickup",
  "7": "hours of operation",
  "8": "catalog by text or email",
  "9": "general voicemail",
  "0": "speak to someone",
  "*": "repeat the main menu",
};

/** Store a phone consent decision with the exact language the caller heard. */
async function recordPhoneConsent(ctx: Ctx, scope: "transactional" | "marketing", action: "opt_in" | "declined", phone: string, keyOverride?: PromptKey) {
  const key: PromptKey = keyOverride ?? (scope === "transactional" ? "consent_transactional" : smsTermsV2Active() ? "consent_marketing_v2" : "consent_marketing");
  const wording = promptText(ctx.prompts, key);
  const digits = ctx.body.Digits || "";
  const said = (ctx.body.SpeechResult || "").trim();
  const conf = ctx.body.Confidence ? Number(ctx.body.Confidence) : null;
  return recordConsent({
    phone,
    scope,
    action,
    source: "phone",
    method: digits ? "keypad" : "speech",
    wording,
    wordingVersion: wordingVersion(wording, PROMPTS[key].text),
    response: digits ? `pressed ${digits}` : said ? `said "${said}"` : "no answer",
    speechConfidence: !digits && conf !== null && Number.isFinite(conf) ? conf : null,
    callerPhone: toE164(ctx.from),
    callSid: ctx.callSid,
    orderId: ctx.session?.orderId ?? ctx.session?.data.placedOrderId ?? null,
  });
}

/**
 * Promo texts by phone: send the approved confirmation text (word for word) to the chosen number and log the request:
 * source phone, which number (caller's or entered), and the date, time and year. Only a YES from that number within
 * 24 hours signs it up (handled by the text system).
 */
async function promoSend(ctx: Ctx, vr: VR, to: string, chosen: "caller" | "entered") {
  const caller = toE164(ctx.from);
  const how =
    `phone (keys only): pressed 1 for promo texts, then ${chosen === "caller" ? "1 for the number calling" : `2 and entered ${to}, confirmed with 1`}; ` +
    `number chosen: ${chosen === "caller" ? "caller's number" : "entered number"} ${to}; caller ID ${caller ?? "withheld"}; call ${ctx.callSid}; ${logStamp()}; ` +
    `heard: "${promptText(ctx.prompts, "promo_ask")}"`;
  const r = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.customers).where(eq(schema.customers.phone, to)).limit(1).for("update");
    return requestPromoConfirmation(tx, c ?? null, to, how);
  });
  if (r.reason === "opted_out") {
    sp(vr, ctx, "consent_stopped");
    return back(vr, "goodbye");
  }
  if (!r.sendConfirmation) return back(vr, "goodbye"); // already signed up, or a confirmation is already waiting
  const c = await customerByPhone(to);
  const res = await sendMessage({ to, body: promoConfirmRequestSms(), kind: "system", event: "promo_confirm_request", customerId: c?.id ?? null, callSid: ctx.callSid });
  // Live: "We just sent a text" only when it really went out. Owner test calls hear every line even while texting is off.
  if (!res.sent && phonePromoMode() === "live") return back(vr, "goodbye");
  sp(vr, ctx, "promo_final");
  sp(vr, ctx, "promo_disclosure");
  return back(vr, "goodbye");
}

/**
 * A 0.75-second pause. Twilio's <Pause> only takes whole seconds and the Chirp3-HD voice doesn't support SSML
 * <break>, so this plays a 750 ms silent clip served from our own site (public/audio/pause-750ms.wav).
 */
export const SHORT_PAUSE_FILE = "/audio/pause-750ms.wav";
function shortPause(target: VR | Gather) {
  target.play(`${config.baseUrl()}${SHORT_PAUSE_FILE}`);
}

/** Abraham (Nov 11, 2026 menu): pauses between greeting and menu lines are half a second or less. */
export const HALF_PAUSE_FILE = "/audio/pause-500ms.wav";
function halfPause(target: VR | Gather) {
  target.play(`${config.baseUrl()}${HALF_PAUSE_FILE}`);
}

/** The website hours lines, as spoken: "11:30 AM - 7:00 PM" -> "11:30 AM to 7:00 PM", one sentence per line. */
export function hoursForSpeech(s: Parameters<typeof websiteHoursLines>[0]): string[] {
  return websiteHoursLines(s).flatMap((l) => l.split("\n")).map((l) => `${l.replace(/ - /g, " to ").trim()}.`);
}

/** The caller ID staff see on a forwarded call: the caller's own number, or the hotline when blocked or unknown. */
export function staffCallerId(from: string | null | undefined, env: Record<string, string | undefined> = process.env): string | undefined {
  return toE164(from) ?? env.TWILIO_PHONE_NUMBER ?? undefined;
}

/** Ring one step of a key's list (one after another) or everyone at once. */
function dialTargets(vr: VR, list: ReturnType<typeof ringListFor>, k: RingKey, i: number, from?: string | null): VR {
  const simultaneous = list.mode === "simultaneous";
  // Abraham (Phone Menu v3): the list rings several times over (3 by default); step i goes round the list
  const ring = simultaneous ? list.targets : [list.targets[i % list.targets.length]];
  const dial = vr.dial({
    callerId: staffCallerId(from), // Abraham: staff phones show the customer's own number (hotline if blocked or unknown)
    timeout: Math.max(...ring.map((t) => t.ringSeconds)),
    action: url("operator-done", { i, k }),
    method: "POST",
  });
  for (const t of ring) {
    if (list.accept) dial.number({ url: url("whisper", { k }), method: "POST" }, t.phone);
    else dial.number(t.phone);
  }
  return vr;
}

/** This day becomes the one being shopped for on the call; an order already held for the same day is reused. */
async function chooseDay(ctx: Ctx, date: string) {
  const sameDay = (await callOrders(ctx)).find((o) => o.order.eventDate === date);
  await updateSession(ctx.callSid, { orderId: sameDay?.order.id ?? null, data: { day: date } }, ctx.session);
}

/** The voicemail box for a menu key: an extension's own box (named after it in Admin), otherwise Main. */
async function vmBox(x: string | null | undefined) {
  if (x && ((RING_KEYS as readonly string[]).includes(x) || x === "9") && x !== "0") return boxForKey(x, extensionName(await getSettings(), x as RingKey | "9"));
  return mainBox();
}

/**
 * Key 9 (general voicemail) has its own feedback greeting. Every other box: the standard greeting while the office is
 * open, and Abraham's "office is closed" greeting after hours, Shabbes and Yom Tov (same hours as the website and key 7).
 */
async function vmGreeting(x: string | null | undefined, prompts: PromptOverrides): Promise<PromptKey> {
  if (x === "9") return "vm9_greeting";
  if (officeOpenNow(new Date(), await getSettings())) return "vm_greeting";
  // Abraham's draft after-hours greeting replaces the closed greeting only once he approves it in Admin
  return promptWaiting(prompts, "vm_after_hours") ? "vm_closed" : "vm_after_hours";
}
const vmSent = (x: string | null | undefined) => (x === "9" ? "vm9_sent" : "vm_sent");

/** The tone, then recording until # or hang-up (Twilio posts the recording back to vm-recorded). */
function vmRecord(vr: VR, box: { id: number; maxLengthSec: number; transcribe: boolean }, x: string | null | undefined) {
  vr.record({
    maxLength: Math.min(Math.max(box.maxLengthSec, 10), 600),
    playBeep: true,
    finishOnKey: "#",
    timeout: 6,
    action: url("vm-recorded", { b: box.id, x: x ?? undefined, t: box.transcribe ? 1 : 0 }),
    method: "POST",
    recordingStatusCallback: url("vm-recording", { b: box.id, t: box.transcribe ? 1 : 0 }),
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    transcribe: box.transcribe,
    ...(box.transcribe ? { transcribeCallback: url("vm-transcription", { b: box.id }) } : {}),
  });
  // Reached only if the caller stayed silent and nothing was recorded.
  return vr;
}

/** Staff voicemail access: signed in with the PIN on THIS call. */
const vmaSignedIn = (ctx: Ctx) => vmAccessActive() && ctx.session?.data.vmaOk === 1;

/**
 * A staff menu line with a call-out choice: while calling out is off on the live line (until Abraham approves the
 * price), that one sentence is left out so it is never offered. Otherwise the line plays as usual.
 */
function spCallOut(target: VR | Gather, ctx: Ctx, key: PromptKey, callOutSentence: string) {
  if (callOutActive()) return sp(target, ctx, key);
  const text = promptText(ctx.prompts, key).replace(callOutSentence, "").replace(/\s{2,}/g, " ").trim();
  say(target, text);
}

/** A box's messages for staff by phone: sent (not hidden), newest first. */
async function vmaMessages(boxId: number) {
  if (!Number.isInteger(boxId)) return [];
  return db
    .select()
    .from(schema.voicemails)
    .where(and(eq(schema.voicemails.boxId, boxId), eq(schema.voicemails.state, "submitted"), isNull(schema.voicemails.deletedAt)))
    .orderBy(desc(schema.voicemails.createdAt))
    .limit(100);
}

function vmaWhen(d: Date) {
  const tz = process.env.BUSINESS_TIMEZONE || "America/New_York";
  return {
    date: spokenLongDate(d.toLocaleDateString("en-CA", { timeZone: tz })), // "Sunday, November twenty-second"
    time: d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
  };
}

/** Key 8 helpers. */
const catPart = (ctx: Ctx, part: "local" | "domain") => (part === "domain" ? ctx.session?.data.catDomain : ctx.session?.data.catLocal) ?? "";
const catalogEmailOf = (ctx: Ctx) => {
  const l = ctx.session?.data.catLocal ?? "";
  const d = ctx.session?.data.catDomain ?? "";
  return validLocal(l) && validDomain(d) ? `${l}@${d}`.toLowerCase() : null;
};
/** Texts really go out (Twilio approved), or this isn't the live site. */
const catalogTextReady = () => textingActive() || process.env.VERCEL_ENV !== "production";

async function catalogSendText(ctx: Ctx, vr: VR, to: string) {
  // Two messages when the Owner has set the pictures: picture 1 with the words, then picture 2 alone (Nov 17, 2026)
  const { sendCatalogMessages } = await import("@/lib/catalog-send");
  const r = await sendCatalogMessages(promptText(ctx.prompts, "msg_catalog_text"), (body, media) => sendMessage({ to, body, ...(media.length ? { mediaUrls: media } : {}), kind: "system", event: "catalog_request", callSid: ctx.callSid }));
  await logCatalogRequest(ctx, "text", to, r.sent, r.reason);
  if (!r.sent) {
    sp(vr, ctx, "catalog_text_not_yet");
    return back(vr, "catalog-email", { p: "cat" });
  }
  sp(vr, ctx, "catalog_texted");
  vr.hangup();
  return vr;
}

/** Every catalog request on the caller's contact (channel, date with year); a failed send alerts Abraham. */
async function logCatalogRequest(ctx: Ctx, channel: "text" | "email", to: string, sent: boolean, reason?: string) {
  await track(ctx.callSid, "step", sent ? `Catalog sent by ${channel}` : `Catalog ${channel} failed${reason ? `: ${reason}` : ""}`, { channel, to, sent });
  await recordCatalogRequest({ callerPhone: toE164(ctx.from), channel, to, sent, source: "phone", reason });
}

/** Does this line ring now (office hours, after-hours switch, key 6 hours, Shabbes and Yom Tov)? */
async function lineRingsNowFor(k: RingKey, settings: Awaited<ReturnType<typeof getSettings>>, at = new Date()) {
  const iso = localISO(at);
  return lineRingsNow(k, at, settings, { officeOpen: officeOpenNow(at, settings), shabbosOrYomTov: isShabbosOrYomTov(iso), candleLighting: erevCandleLighting(iso, settings) });
}

/**
 * The Sola payment link for a phone order (items + delivery + tax): emailed to the caller, and texted with order-text
 * consent once Twilio approves texting; then the line that says how it was sent.
 */
type LinkDay = { order: { id: number; eventDate: string; pickupDate: string; subtotalCents: number; deliveryFeeCents: number; taxCents: number; totalCents: number | null }; items: { qty: number; name: string }[] };

/**
 * Send the payment link for the whole reservation by text or email (Abraham, Nov 17, 2026). The booking is held 10
 * minutes from now (box 146); opening the link gives 4 more minutes once (see late-payment). True when it went out.
 */
async function deliverPayLink(ctx: Ctx, orderId: number, via: { phone?: string; email?: string }): Promise<boolean> {
  const group = await getPaymentGroup(orderId);
  const days: LinkDay[] = group?.orders ?? [];
  if (!days.length) return false;
  const sum = (f: (o: (typeof days)[number]["order"]) => number) => days.reduce((n, d) => n + f(d.order), 0);
  const totals = {
    subtotalCents: sum((o) => o.subtotalCents),
    deliveryFeeCents: sum((o) => o.deliveryFeeCents),
    taxCents: sum((o) => o.taxCents),
    totalCents: sum((o) => o.totalCents ?? o.subtotalCents),
  };
  const num = orderNumber(orderId);
  const link = payPageLink(orderId); // review-and-pay page for the whole reservation, then Sola
  const dayText = (o: (typeof days)[number]) => `${o.items.map((i) => `${i.qty} x ${i.name}`).join(", ")} for ${messageDate(o.order.eventDate)} (pickup ${messageDate(o.order.pickupDate)})`;
  const details = promptText(ctx.prompts, "msg_payment_link", {
    number: num,
    items: days.map(dayText).join("; "),
    rentals: money(totals.subtotalCents),
    delivery: money(totals.deliveryFeeCents),
    tax: money(totals.taxCents),
    total: money(totals.totalCents),
    minutes: PAYMENT_HOLD_MINUTES,
    link,
  });
  const customerId = group?.primary.customer?.id ?? null;
  let sent = false;
  if (via.phone) {
    // The STOP line is added by the text system on the first order text (or after 30 days without one)
    sent = (await sendSms(via.phone, details, { kind: "transactional", event: "order_payment_link", customerId, orderId, callSid: ctx.callSid })).sent;
  } else if (via.email) {
    sent = (await sendEmail(via.email, promptText(ctx.prompts, "msg_payment_link_subject", { number: num }), details)).sent;
    if (sent && customerId) await db.update(schema.customers).set({ email: via.email }).where(eq(schema.customers.id, customerId));
  }
  if (sent) {
    const ids = days.map((d) => d.order.id);
    await db.update(orders).set({ holdExpiresAt: minutesFromNow(PAYMENT_HOLD_MINUTES), linkOpenedAt: null, updatedAt: new Date() }).where(and(inArray(orders.id, ids), eq(orders.status, "PENDING_PAYMENT")));
  }
  await track(ctx.callSid, "step", `Payment link ${sent ? "sent" : "could not be sent"} by ${via.phone ? "text" : "email"} (order #${num})`, { orderId, sent });
  return sent;
}

/** What the shared text steps are for (boxes 142 to 144). */
function txPurpose(ctx: Ctx): "cat" | "pay" | "conf" {
  const p = ctx.query.get("p");
  return p === "pay" ? "pay" : p === "conf" ? "conf" : "cat";
}

/** The number is chosen: the catalog, or the payment link (after the caller's OK for order texts). */
async function txSend(ctx: Ctx, vr: VR, p: "cat" | "pay" | "conf", to: string) {
  if (p === "cat") return catalogSendText(ctx, vr, to);
  if (p === "conf") {
    // Box 148, press 1: the payment confirmation text to the number the caller entered (they asked for it)
    const o = Number(ctx.query.get("o"));
    if (o) {
      const { confirmationText } = await import("@/lib/payment-result");
      const body = await confirmationText(o);
      if (body) await sendMessage({ to, body, kind: "system", event: "confirmation_resend", orderId: o, callSid: ctx.callSid });
      await track(ctx.callSid, "step", `Payment confirmation texted to the number the caller entered`, { to });
    }
    return back(vr, "promo-consent");
  }
  const o = Number(ctx.query.get("o"));
  if (!o) return back(vr, "goodbye");
  return payTextTo(ctx, vr, o, to);
}

/** The payment link by text: needs order-text consent (asked once with the approved line); no texts = the email steps. */
async function payTextTo(ctx: Ctx, vr: VR, o: number, to: string, agreedNow = false) {
  await updateSession(ctx.callSid, { data: { txPhone: to } }, ctx.session);
  // Agreed on this call, or a recorded OK from before, for this same number
  const saidYes = (ctx.session?.data.smsConsent === "yes" || ctx.session?.data.smsConsent === "existing") && ctx.session?.data.phone === to;
  if (!agreedNow && !saidYes) {
    const customer = await customerByPhone(to);
    if (customer?.smsOptOut) {
      sp(vr, ctx, "consent_stopped");
      return back(vr, "catalog-email", { p: "pay", o });
    }
    const state = await consentState(to);
    if (state.transactional?.action !== "opt_in") return back(vr, "pay-consent", { o });
  }
  const sent = await deliverPayLink(ctx, o, { phone: to });
  if (!sent) {
    sp(vr, ctx, "catalog_text_not_yet"); // "Sorry, we cannot send it by text just yet. Let us send it by email instead."
    return back(vr, "catalog-email", { p: "pay", o });
  }
  sp(vr, ctx, "pay_link_sent");
  return back(vr, "promo-consent");
}

/** Star from the first email step: back to where the email steps started (key 8 menu, or box 141). */
function emailHome(ctx: Ctx, vr: VR) {
  const o = ctx.session?.data.emailFor === "pay" ? ctx.session.data.payOrder : undefined;
  return o ? back(vr, "paylink", { o }) : back(vr, "catalog");
}

/* ------------------------------------------------------------------ handlers */

type Handler = (ctx: Ctx, vr: VR) => Promise<VR> | VR;

const handlers: Record<string, Handler> = {
  /**
   * Music while a caller waits (Abraham, Nov 17, 2026): one piece at a time, like a radio (src/lib/music.ts). Used as
   * the wait music of a queue: Twilio asks again for the next piece when one ends. place = staff | pay.
   */
  async music(ctx, vr) {
    const place = ctx.query.get("place") === "pay" ? "pay" : "staff";
    const piece = await nextPiece(place);
    if (piece) vr.play(piece.url);
    else vr.pause({ length: 8 }); // no music chosen for this place: quiet
    return vr;
  },

  async incoming(ctx, vr) {
    // Blocked callers (Settings → Caller blocking) get a busy signal before anything else, and no session.
    const blocked = matchBlock(ctx.from, parseBlockList((await getSettings()).blockedCallers || ""));
    if (blocked) {
      console.log(`[hotline] blocked caller ${ctx.from ?? "withheld"} (${blocked.pattern})`);
      vr.reject({ reason: "busy" });
      return vr;
    }
    await ensureSession(ctx.callSid, ctx.from);
    // Shabbes and Yom Tov (Abraham, Nov 14, 2026, choice A): the whole hotline is closed. A closed greeting with the
    // day and time we open again, then the tone; every message goes to the general voicemail (key 9's box), without
    // that box's own greeting. Draft wording: on preview now, on the live line once Abraham approves it.
    const closed = await hotlineClosed(ctx, vr);
    if (closed) return closed;
    // Call recording (off unless the Owner turns it on): the greeting, then the notice; recording starts only after
    // the notice, then the rest of the start of the call. Recording only with its notice (Abraham, Nov 16, 2026).
    if ((await getSettings()).callRecording && !promptWaiting(ctx.prompts, "recording_notice")) {
      sp(vr, ctx, "greeting");
      halfPause(vr);
      sp(vr, ctx, "recording_notice");
      return back(vr, "record-start");
    }
    // The greeting is part of the main menu so callers can press a key at any time, even during the greeting.
    return back(vr, "menu", { first: 1 });
  },

  /** After the recording notice: start recording the call, then the main menu. */
  async "record-start"(ctx, vr) {
    const ok = await startRecording(ctx.callSid);
    await updateSession(ctx.callSid, { data: { recording: ok } }, ctx.session);
    return back(vr, "menu", { first: 1, gr: 1 }); // gr: the greeting already played (before the notice)
  },

  /** Twilio: a call recording finished. Saved on the call for the call log (recording itself stays in Twilio). */
  async "call-recording"(ctx, vr) {
    if (ctx.body.RecordingStatus === "completed" && ctx.body.RecordingSid) {
      await updateSession(ctx.callSid, { data: { recordingSid: ctx.body.RecordingSid, recordingUrl: ctx.body.RecordingUrl ?? null } }, ctx.session);
    }
    return vr;
  },

  /**
   * The start of the call and the main menu (Abraham, Nov 16, 2026). With ?first=1 (only the incoming call): the
   * greeting, the call recording notice (only when recording is on; played before this step, see incoming), the
   * office closed line (only when closed) and the catalog offer, then the main menu prompt. Every other time the menu
   * plays (star, after the hours, back to the main menu, a wrong key, no key) only the main menu prompt plays.
   * All of it is inside one Gather, so any key works at any time. After the last line it waits 3 seconds; after 3
   * plays with no key the disconnect line plays and the call ends.
   */
  async menu(ctx, vr) {
    // Abraham: menus are keys only (no speech). finishOnKey "" makes # arrive as a key, so # is an invalid choice.
    const g = vr.gather({
      input: ["dtmf"],
      numDigits: 1,
      finishOnKey: "",
      timeout: MENU_WAIT_SECONDS, // Abraham: 3 seconds after the last line, then the menu plays again
      action: url("menu-choice", { np: ctx.query.get("np") || undefined, t0: ctx.query.get("t0") || Date.now() }),
      method: "POST",
    });
    if (ctx.query.get("first") === "1") {
      if (ctx.query.get("gr") !== "1") {
        sp(g, ctx, "greeting");
        halfPause(g);
      }
      // Booking by phone is available 24/7; outside office hours callers are told the office is closed.
      const open = officeOpenNow(new Date(), await getSettings());
      // Call journey (Abraham): what the system decided about office hours for this call
      await track(ctx.callSid, "step", open ? "Office open" : "Office closed", { open });
      if (!open) {
        sp(g, ctx, "office_closed");
        halfPause(g);
      }
      sp(g, ctx, "catalog_offer");
      halfPause(g);
    }
    spLines(g, ctx, "main_menu");
    return menuNoChoice(vr, ctx);
  },

  async "menu-choice"(ctx, vr) {
    const d = ctx.body.Digits; // keys only (Abraham): anything said is ignored
    if (!d) return menuNoChoice(vr, ctx);
    // Call analytics: remember each valid main-menu choice (not shown to callers, nothing spoken)
    if (/^[0-9*]$/.test(d) && ctx.session) {
      await updateSession(ctx.callSid, { data: { menuKeys: [...(ctx.session.data?.menuKeys ?? []), d] } }, ctx.session);
    }
    await track(ctx.callSid, "step", `Main menu key ${d}: ${MAIN_KEY_LABELS[d] ?? "not a menu choice"}`, { key: d }, "menu-choice");
    switch (d) {
      case "*": // Abraham (Nov 16, 2026): star replays the main menu prompt, without the greeting
        return back(vr, "menu");
      case "1":
        return back(vr, "book");
      case "2": // Abraham W: instructions for each type of attraction
        return back(vr, "instructions");
      case "3": // customer service: the line (ring list, voicemail, alerts) that was key 4
        return back(vr, "ring", { k: "4" });
      case "4": // learn about our rentals (was key 3)
        return back(vr, "learn");
      case "5":
      case "6":
      case "0":
        return back(vr, "ring", { k: d });
      case "8": // catalog by text or email
        return back(vr, "catalog");
      case "7": // hours of operation, read from Admin (never rings the operator)
        return back(vr, "hours");
      case "9":
        return back(vr, "voicemail", { x: "9" }); // feedback and comments: its own box, greeting and confirmation
      default:
        // Abraham: any key with no action says this, then the main menu plays again
        sp(vr, ctx, "not_valid");
        return back(vr, "menu");
    }
  },

  /** A menu played with no key: again, until 3 plays AND 20 seconds have passed; then goodbye. */
  "no-key"(ctx, vr) {
    const np = Number(ctx.query.get("np") || 0);
    const t0 = Number(ctx.query.get("t0")) || Date.now();
    if (np >= MENU_PLAYS_BEFORE_END && Date.now() - t0 >= MENU_MIN_SECONDS * 1000) {
      sp(vr, ctx, "no_input_final");
      vr.hangup(); // a voicemail waiting for 1, 2 or 3 is kept when the call ends
      return vr;
    }
    return toStep(vr, ctx, { np, t0 });
  },

  /** Inside a booking with no key: the same step; at 9 minutes the warning, at 10 minutes the call ends. */
  idle(ctx, vr) {
    const idle = idleMs(ctx);
    if (idle >= IDLE_END_MS) {
      sp(vr, ctx, "no_input_final");
      vr.hangup();
      return vr;
    }
    if (idle >= IDLE_WARN_MS) {
      const to = ctx.query.get("to") ?? undefined;
      const q = ctx.query.get("q") ?? undefined;
      const g = vr.gather({ input: ["dtmf"], numDigits: 1, finishOnKey: "", timeout: Math.max(5, Math.ceil((IDLE_END_MS - idle) / 1000)), action: url("idle-key", { to, q }), method: "POST" });
      sp(g, ctx, "idle_warning");
      vr.redirect({ method: "POST" }, url("idle", { to, q }));
      return vr;
    }
    return toStep(vr, ctx);
  },

  /** Any key after the warning: back to the same step. */
  "idle-key"(ctx, vr) {
    return toStep(vr, ctx);
  },

  /* ---- Key 8 (Abraham, Phone Menu v3): our catalog by text or email. Never a promo sign-up. ---- */

  catalog(ctx, vr) {
    const g = keypad(vr, url("catalog-choice"));
    sp(g, ctx, "catalog_menu");
    return repeatMenu(vr, ctx, "catalog");
  },

  async "catalog-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "menu");
    if (d === "1") {
      if (catalogTextReady()) return back(vr, "tx-which", { p: "cat" });
      sp(vr, ctx, "catalog_text_not_yet");
      return back(vr, "catalog-email", { p: "cat" });
    }
    if (d === "2") return back(vr, "catalog-email", { p: "cat" });
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog");
  },

  /** Older links to the key 8 text steps: the shared steps (boxes 142 to 144). */
  "catalog-text"(ctx, vr) {
    return back(vr, "tx-which", { p: "cat" });
  },

  /*
   * Every flow that texts the caller (Abraham, Nov 17, 2026, boxes 142 to 144): p = cat (key 8 catalog) or pay (the
   * payment link, o = the order). The caller's number is never read out.
   */
  "tx-which"(ctx, vr) {
    const p = txPurpose(ctx);
    const o = ctx.query.get("o") ?? undefined;
    const g = keypad(vr, url("tx-which-choice", { p, o }));
    sp(g, ctx, "text_which");
    return repeatMenu(vr, ctx, "tx-which", { p, o });
  },

  async "tx-which-choice"(ctx, vr) {
    const p = txPurpose(ctx);
    const o = ctx.query.get("o") ?? undefined;
    const d = ctx.body.Digits;
    if (d === "*") return p === "pay" ? back(vr, "paylink", { o }) : p === "conf" ? back(vr, "pay-approved", { o }) : back(vr, "catalog");
    if (d === "1") {
      const to = toE164(ctx.from);
      return to ? txSend(ctx, vr, p, to) : back(vr, "tx-enter", { p, o });
    }
    if (d === "2") return back(vr, "tx-enter", { p, o });
    sp(vr, ctx, "not_valid");
    return back(vr, "tx-which", { p, o });
  },

  "tx-enter"(ctx, vr) {
    const p = txPurpose(ctx);
    const o = ctx.query.get("o") ?? undefined;
    const g = keypad(vr, url("tx-heard", { p, o }), { numDigits: 11, timeout: 10, finishOnKey: "#" });
    sp(g, ctx, "text_enter");
    return repeatMenu(vr, ctx, "tx-enter", { p, o });
  },

  async "tx-heard"(ctx, vr) {
    const p = txPurpose(ctx);
    const o = ctx.query.get("o") ?? undefined;
    const digits = ctx.body.Digits || "";
    if (digits.includes("*")) return back(vr, "tx-which", { p, o }); // star: one step back
    const e164 = tenDigitNumber(digits);
    if (!e164) {
      sp(vr, ctx, "not_valid");
      return back(vr, "tx-enter", { p, o });
    }
    await updateSession(ctx.callSid, { data: { catPhone: e164 } }, ctx.session);
    return back(vr, "tx-heard-again", { p, o });
  },

  /** "I have {number}. If that is correct, press 1. To enter a different number, press 2." */
  "tx-heard-again"(ctx, vr) {
    const p = txPurpose(ctx);
    const o = ctx.query.get("o") ?? undefined;
    const n = ctx.session?.data.catPhone;
    if (!n) return back(vr, "tx-enter", { p, o });
    const g = keypad(vr, url("tx-confirm", { p, o }));
    sp(g, ctx, "text_heard", { number: readBack(n) });
    return repeatMenu(vr, ctx, "tx-heard-again", { p, o });
  },

  async "tx-confirm"(ctx, vr) {
    const p = txPurpose(ctx);
    const o = ctx.query.get("o") ?? undefined;
    const d = ctx.body.Digits;
    const to = ctx.session?.data.catPhone;
    if (d === "1" && to) return txSend(ctx, vr, p, to);
    if (d === "2") return back(vr, "tx-enter", { p, o });
    if (d === "*") return back(vr, "tx-which", { p, o });
    sp(vr, ctx, "not_valid");
    return back(vr, "tx-heard-again", { p, o });
  },

  /** Email: the info@ tip (once that auto-reply is on), then step 1, the first part of the address. */
  async "catalog-email"(ctx, vr) {
    // p = pay: the same email steps for a payment link (Abraham, Nov 17, 2026, box 145); p = cat: the catalog.
    // No p (start over inside the steps): keep what they are for.
    const p = ctx.query.get("p");
    const forPay = p === "pay" || (p !== "cat" && ctx.session?.data.emailFor === "pay");
    if (!forPay && infoCatalogAutoreplyOn()) sp(vr, ctx, "catalog_email_info");
    await updateSession(ctx.callSid, { data: { catLocal: "", catDomain: "", ...(p === "pay" ? { emailFor: "pay" as const, payOrder: Number(ctx.query.get("o")) || ctx.session?.data.payOrder } : p === "cat" ? { emailFor: undefined } : {}) } }, ctx.session);
    return back(vr, "catalog-part", { part: "local" });
  },

  /**
   * One part of the address (part = local or domain). A key within 3 seconds switches to keypad typing; no key plays
   * a tone and listens for spoken letters. add=1 keeps what was already entered.
   */
  "catalog-part"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const add = ctx.query.get("add") ?? undefined;
    const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 3, finishOnKey: "", action: url("catalog-key", { part, add }), method: "POST" });
    sp(g, ctx, part === "domain" ? "catalog_domain" : "catalog_email_local");
    vr.play(`${config.baseUrl()}/audio/tone.wav`);
    if (sttActive()) {
      // Speech to text (preview only): record the spoken letters, Google types them up while the soft clip plays
      vr.record({ maxLength: 15, timeout: 3, playBeep: false, finishOnKey: "#", trim: "trim-silence", action: url("catalog-stt-recorded", { part, add }), method: "POST" });
      return vr;
    }
    const s = vr.gather({ input: ["speech", "dtmf"], finishOnKey: "#", timeout: 6, speechTimeout: "auto", language: "en-US", hints: "a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z, dot, underscore, dash", action: url("catalog-said", { part, add }), method: "POST" });
    void s;
    return repeatMenu(vr, ctx, "catalog-part", { part, add });
  },

  /** The caller started typing: the directions, then the rest of the keys until pound. */
  async "catalog-key"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const add = ctx.query.get("add") ?? undefined;
    const first = ctx.body.Digits || "";
    if (first === "#") return back(vr, "catalog-got", { part }); // pound early: read back what we have
    await updateSession(ctx.callSid, { data: { catKeys: first } }, ctx.session);
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 20, action: url("catalog-typed", { part, add }), method: "POST" });
    sp(g, ctx, "catalog_keypad_help");
    return back(vr, "catalog-typed", { part, add });
  },

  async "catalog-typed"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const keep = ctx.query.get("add") === "1" ? catPart(ctx, part) : "";
    const r = decodeCatalogKeys(`${ctx.session?.data.catKeys ?? ""}${ctx.body.Digits ?? ""}`, keep);
    await updateSession(ctx.callSid, { data: { catKeys: "", [part === "domain" ? "catDomain" : "catLocal"]: r.text, catStt: undefined } }, ctx.session);
    if (r.back) return part === "domain" ? back(vr, "catalog-ending") : emailHome(ctx, vr); // star three times: one step back
    return back(vr, "catalog-got", { part });
  },

  /** Speech to text for the catalog email (preview only): save the recording, type it up in the background. */
  async "catalog-stt-recorded"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const add = ctx.query.get("add") ?? undefined;
    const secs = Number(ctx.body.RecordingDuration || 0);
    if (!ctx.body.RecordingUrl || secs < 1) return back(vr, "catalog-said", { part, add, empty: 1 });
    const [row] = await db
      .insert(schema.spokenAnswers)
      .values({ callSid: ctx.callSid, field: `catalog_${part}`, recordingSid: ctx.body.RecordingSid || null, recordingUrl: ctx.body.RecordingUrl, durationSec: secs })
      .returning({ id: schema.spokenAnswers.id });
    runLater(() => transcribeAnswer(row.id, CATALOG_LETTER_HINTS));
    vr.play(`${config.baseUrl()}${STT_HOLD_FILE}`);
    return back(vr, "catalog-stt-check", { part, add, a: row.id, w: 1 });
  },

  async "catalog-stt-check"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const add = ctx.query.get("add") ?? undefined;
    const a = Number(ctx.query.get("a"));
    const w = Number(ctx.query.get("w") || 1);
    const row = await callSpokenAnswer(ctx, a);
    if (row && row.status === "pending" && w < STT_MAX_WAITS) {
      vr.play(`${config.baseUrl()}${STT_HOLD_FILE}`);
      return back(vr, "catalog-stt-check", { part, add, a, w: w + 1 });
    }
    return back(vr, "catalog-said", { part, add, a: row?.id });
  },

  async "catalog-said"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const keep = ctx.query.get("add") === "1" ? catPart(ctx, part) : "";
    const typedUp = await callSpokenAnswer(ctx, Number(ctx.query.get("a")));
    const said = spokenLetters(typedUp ? typedUp.text || "" : ctx.body.SpeechResult || "");
    if (!said && !keep) return back(vr, "catalog-part", { part, add: ctx.query.get("add") ?? undefined });
    await updateSession(ctx.callSid, { data: { [part === "domain" ? "catDomain" : "catLocal"]: keep + said, catStt: typedUp ? 1 : undefined } }, ctx.session);
    return back(vr, "catalog-got", { part });
  },

  /** "We got y o s s i. To continue, press pound. To start over, press 1. To add more, press 2." */
  async "catalog-got"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const value = catPart(ctx, part);
    if (!value) {
      sp(vr, ctx, "email_unclear");
      return back(vr, "catalog-part", { part });
    }
    const g = keypad(vr, url("catalog-got-choice", { part }));
    const links = ctx.session?.data.catStt ? await googleReadback(lineTemplate(ctx, "catalog_got"), { letters: spellOut(value) }) : null;
    if (links) for (const l of links) g.play(l); // speech to text: read back in the Google voice, not Twilio's Say
    else sp(g, ctx, "catalog_got", { letters: spellOut(value) });
    return repeatMenu(vr, ctx, "catalog-got", { part });
  },

  async "catalog-got-choice"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const d = ctx.body.Digits;
    const value = catPart(ctx, part);
    if (d === "#") {
      const ok = part === "domain" ? validDomain(value) : validLocal(value);
      if (!ok) {
        sp(vr, ctx, "email_unclear");
        return back(vr, "catalog-part", { part });
      }
      return back(vr, part === "domain" ? "catalog-final" : "catalog-ending");
    }
    if (d === "1") return back(vr, "catalog-part", { part }); // start over
    if (d === "2") return back(vr, "catalog-part", { part, add: 1 }); // add more, keeping what was entered
    if (d === "*") return part === "domain" ? back(vr, "catalog-ending") : emailHome(ctx, vr);
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-got", { part });
  },

  "catalog-ending"(ctx, vr) {
    const g = keypad(vr, url("catalog-ending-choice"));
    sp(g, ctx, "catalog_ending");
    return repeatMenu(vr, ctx, "catalog-ending");
  },

  async "catalog-ending-choice"(ctx, vr) {
    const d = ctx.body.Digits ?? "";
    if (CATALOG_ENDINGS[d]) {
      await updateSession(ctx.callSid, { data: { catDomain: CATALOG_ENDINGS[d] } }, ctx.session);
      return back(vr, "catalog-final");
    }
    if (d === "5") return back(vr, "catalog-part", { part: "domain" });
    if (d === "*") return back(vr, "catalog-got", { part: "local" }); // one step back, the first part kept
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-ending");
  },

  "catalog-final"(ctx, vr) {
    const email = catalogEmailOf(ctx);
    if (!email) return back(vr, "catalog-email");
    const g = keypad(vr, url("catalog-final-choice"));
    sp(g, ctx, "catalog_final", { email: spokenEmail(email) });
    return repeatMenu(vr, ctx, "catalog-final");
  },

  async "catalog-final-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    const email = catalogEmailOf(ctx);
    if (d === "#" && email && ctx.session?.data.emailFor === "pay") {
      // The payment link by email (box 145), then box 146
      const o = ctx.session.data.payOrder;
      await updateSession(ctx.callSid, { data: { emailFor: undefined } }, ctx.session);
      const sent = o ? await deliverPayLink(ctx, o, { email }) : false;
      sp(vr, ctx, sent ? "pay_link_sent" : "link_failed");
      return back(vr, "promo-consent");
    }
    if (d === "#" && email) {
      const r = await sendCatalogEmail(email);
      await logCatalogRequest(ctx, "email", email, r.sent);
      if (!r.sent) {
        sp(vr, ctx, "went_wrong");
        return back(vr, "menu");
      }
      const g = keypad(vr, url("catalog-done"));
      sp(g, ctx, "catalog_emailed");
      vr.hangup(); // "Otherwise, you may hang up"
      return vr;
    }
    if (d === "1") return back(vr, "catalog-email"); // start over
    if (d === "*") return back(vr, "catalog-ending");
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-final");
  },

  "catalog-done"(ctx, vr) {
    if (ctx.body.Digits === "*") return back(vr, "catalog"); // star: one menu back (Abraham, Nov 18, 2026)
    vr.hangup();
    return vr;
  },

  /* ---- Keys 2 and 3 (Abraham W): instructions, and learn about our rentals. m = "i" (instructions) or "l" (learn). ---- */

  instructions(ctx, vr) {
    return attractionMenu(ctx, vr, "i");
  },

  learn(ctx, vr) {
    return attractionMenu(ctx, vr, "l");
  },

  async "attraction-choice"(ctx, vr) {
    const m = ctx.query.get("m") === "l" ? "l" : "i";
    const d = ctx.body.Digits;
    const menu = m === "l" ? "learn" : "instructions";
    if (!d) return repeatMenu(vr, ctx, menu, { again: 1 });
    if (d === "*") return back(vr, "menu");
    if (["1", "2", "3"].includes(d)) return back(vr, "attraction", { m, t: d });
    sp(vr, ctx, "not_valid"); // # or any other key
    return back(vr, menu, { again: 1 });
  },

  async attraction(ctx, vr) {
    const m = ctx.query.get("m") === "l" ? "l" : "i";
    const t = (["1", "2", "3"].includes(ctx.query.get("t") ?? "") ? ctx.query.get("t") : "1") as "1" | "2" | "3";
    const g = keypad(vr, url("attraction-after", { m, t }));
    const type = ATTRACTIONS[t];
    if (m === "i") {
      // A script still waiting for Abraham's OK never plays: straight back to the key 2 menu (no new wording)
      if (promptWaiting(ctx.prompts, type.instr)) return back(vr, "instructions", { again: 1 });
      sp(g, ctx, type.instr);
      await track(ctx.callSid, "category_heard", `Heard the instructions for ${type.label}`, { category: type.label, kind: "instructions" });
    } else {
      sp(g, ctx, type.learn);
      const cat = await attractionCategory(t);
      const items = cat ? await phoneProducts(cat.id) : [];
      if (cat && items.length) sp(g, ctx, "learn_items", { category: cat.spokenName || cat.name, items: listPhrase(items.map((p) => p.name)) });
      else sp(g, ctx, "learn_none");
      sp(g, ctx, "learn_deliver");
      await track(ctx.callSid, "category_heard", `Heard about ${cat?.name ?? type.label}`, { category: cat?.name ?? type.label, items: items.map((p) => p.name), kind: "learn" });
    }
    pause(g);
    sp(g, ctx, "attraction_after");
    return repeatMenu(vr, ctx, "attraction-options", { m, t });
  },

  "attraction-options"(ctx, vr) {
    const m = ctx.query.get("m") === "l" ? "l" : "i";
    const t = ctx.query.get("t") ?? "1";
    const g = keypad(vr, url("attraction-after", { m, t }));
    sp(g, ctx, "attraction_after");
    return repeatMenu(vr, ctx, "attraction-options", { m, t });
  },

  async "attraction-after"(ctx, vr) {
    const m = ctx.query.get("m") === "l" ? "l" : "i";
    const t = ctx.query.get("t") ?? "1";
    const d = ctx.body.Digits;
    if (!d) return repeatMenu(vr, ctx, "attraction-options", { m, t });
    if (d === "*") return back(vr, "attraction", { m, t }); // hear it again
    if (d === "1") return back(vr, m === "l" ? "learn" : "instructions", { again: 1 }); // another attraction
    if (d === "2") return back(vr, "menu"); // main menu
    sp(vr, ctx, "not_valid");
    return back(vr, "attraction-options", { m, t });
  },

  /** Key 1: the rentals to book (existing approved lines), the cart when it has items, star for the main menu. */
  /**
   * Key 1 (Abraham, Nov 8, 2026): the rental date first, then the items. After an item: "For the same day, press 1.
   * For another day, press 2." Each day is its own held order; checkout charges all of them together (one payment).
   * Every booking menu ends with "To go to your shopping cart, press 0."; star returns to the main menu.
   */
  /** Key 1 (Abraham, Nov 9, 2026): choose a category, then the item, then the date. */
  async book(ctx, vr) {
    // Shabbes and Yom Tov: the whole-hotline closed greeting replaces the main menu, so there is no "key 1 on
    // Shabbes" line (removed, Abraham, Nov 16, 2026). Booking stays locked: a call already in the menu when Shabbes
    // starts gets the closed greeting and the general voicemail; while that greeting waits for approval on the live
    // line, "not a valid selection" and the main menu.
    // Abraham, Nov 14, 2026: no booking on Shabbes or Yom Tov (candle lighting until Rabbeinu Tam), automatically
    const lock = bookingLock(calendarNow(), await getSettings());
    if (lock.locked) {
      await track(ctx.callSid, "step", `Booking closed (${lock.reason})`, { key: "1" });
      const closed = await hotlineClosed(ctx, vr);
      if (closed) return closed;
      sp(vr, ctx, "not_valid");
      return back(vr, "menu");
    }
    // Abraham, Nov 15, 2026: a caller back from the same number is offered last call's unfinished cart (once)
    if (resumeActive(ctx) && !ctx.session?.data.resumeAsked && !(await callOrders(ctx)).length && (await unfinishedCart(ctx)).length) return back(vr, "resume");
    const cats = await phoneCategories();
    const g = keypad(vr, url("book-choice")); // keys only (Abraham); # is an invalid choice
    // Abraham (Nov 11, 2026), word for word. Categories, their names and order come from Admin; numbered 1, 2, 3...
    // Abraham, Nov 18, 2026: the "Please note" line plays the first time only, not when the caller comes back to add more
    const adding = (await callOrders(ctx)).length > 0;
    if (!adding) {
      sp(g, ctx, "book_note");
      halfPause(g);
    }
    if (!cats.length) sp(g, ctx, "menu_empty");
    cats.forEach((c, i) => {
      sp(g, ctx, "menu_category", { category: c.spokenName || c.name, key: i + 1 });
      halfPause(g);
    });
    sp(g, ctx, "book_corporate");
    halfPause(g);
    sp(g, ctx, "book_back");
    // Before a booking starts this is a menu (3 plays and 20 seconds); with something held it follows the idle rule
    return (await callOrders(ctx)).length ? idleNoKey(vr, ctx, "book") : repeatMenu(vr, ctx, "book");
  },

  /** "Welcome back! On your last call you had ... To check if it is still available and continue, press 1." */
  async resume(ctx, vr) {
    const lines = await unfinishedCart(ctx);
    await updateSession(ctx.callSid, { data: { resumeAsked: 1 } }, ctx.session);
    if (!lines.length) return back(vr, "book");
    const g = keypad(vr, url("resume-choice"));
    // grouped by day: "one Castle and one Laser tag set for Tuesday, December 22"
    const byDay = [...new Set(lines.map((l) => l.date))].map((d) => `${lines.filter((l) => l.date === d).map((l) => itemPhrase(l.qty, l.name)).join(" and ")} for ${spokenDate(d)}`);
    sp(g, ctx, "resume_offer", { items: byDay.join(", and ") });
    return idleNoKey(vr, ctx, "book");
  },

  /**
   * Press 1: check every item again (Abraham, Nov 15, 2026). Free items are held for the caller, then go straight into
   * the cart (Nov 18, 2026); taken items get the nearest options.
   */
  async "resume-choice"(ctx, vr) {
    const rd = ctx.body.Digits;
    if (rd === "2" || !rd) return back(vr, "book"); // 2 (or no key): a new order
    if (rd !== "1") {
      sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      return back(vr, "resume");
    }
    const lines: ResumeLine[] = [];
    for (const l of (await unfinishedCart(ctx)).filter((x) => x.date >= todayISO())) {
      // each item its own hold, outside the cart, until the caller adds it
      const r = await reserveItem({ orderId: null, productId: l.productId, qty: l.qty, eventDate: l.date, channel: "PHONE", status: "HOLD", holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES), callSid: ctx.callSid });
      lines.push({ p: l.productId, name: l.name, qty: l.qty, d: l.date, holdId: r.ok ? r.orderId : null, state: r.ok ? "free" : "taken" });
    }
    await track(ctx.callSid, "step", `Unfinished cart checked again: ${lines.filter((l) => l.state === "free").length} free, ${lines.filter((l) => l.state === "taken").length} no longer free`, { lines });
    await updateSession(ctx.callSid, { data: { resumeLines: lines } }, ctx.session);
    return back(vr, "resume-items");
  },

  /**
   * Box 8, press 1 (Abraham, Nov 18, 2026; boxes 9 and 10 deleted): the old cart, one item at a time. A free item goes
   * straight into the cart with box 11 ("This item is successfully added to your cart."), and the ocean balls question
   * after a jumping balloon; a taken item gets box 11a (the same date or the nearest date). Then the cart.
   */
  async "resume-items"(ctx, vr) {
    const lines = [...(ctx.session?.data.resumeLines ?? [])];
    const i = lines.findIndex((l) => l.state === "free");
    if (i >= 0) {
      const l = lines[i];
      // its hold moves into the cart (the day's cart order if there is one)
      const session = ctx.session ?? (await ensureSession(ctx.callSid, ctx.from));
      const day = (await callOrders(ctx)).find((o) => o.order.eventDate === l.d);
      let cartOrder = l.holdId!;
      if (day) {
        await db.update(orderItems).set({ orderId: day.order.id }).where(eq(orderItems.orderId, l.holdId!));
        await cancelHold(l.holdId!);
        await refreshOrderTotals(day.order.id);
        cartOrder = day.order.id;
      }
      await db.update(orders).set({ holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES) }).where(eq(orders.id, cartOrder));
      lines[i] = { ...l, state: "added" };
      const ids = [...new Set([...(session.data?.dayOrderIds ?? []), cartOrder])];
      await updateSession(ctx.callSid, { orderId: cartOrder, outcome: "carted", data: { day: l.d, dayOrderIds: ids, resumeLines: lines } }, session);
      await track(ctx.callSid, "item_added", `Added ${itemPhrase(l.qty, l.name)} for ${spokenDate(l.d)} from the last call`, { item: l.name, productId: l.p, qty: l.qty, date: l.d, orderId: cartOrder });
      sp(vr, ctx, "item_added");
      const prod = await getProduct(l.p);
      if (prod && (await isBounceHouse(prod.categoryId))) return back(vr, "ocean", { d: l.d, n: "resume" });
      return back(vr, "resume-items");
    }
    const t = lines.findIndex((l) => l.state === "taken");
    if (t >= 0) {
      const l = lines[t];
      lines[t] = { ...l, state: "done" };
      await updateSession(ctx.callSid, { data: { resumeLines: lines } }, ctx.session);
      return back(vr, "booked-near", { p: l.p, d: l.d }); // box 11a: same date, or the nearest date it is free
    }
    return back(vr, (await callOrders(ctx)).length ? "cart" : "book");
  },

  /** Old menu (boxes 9 and 10, deleted): a call already in it goes on with the new way. */
  async "resume-pick"(_ctx, vr) {
    return back(vr, "resume-items");
  },

  async "book-choice"(ctx, vr) {
    const d = ctx.body.Digits; // keys only (Abraham)
    if (!d) return (await callOrders(ctx)).length ? idleNoKey(vr, ctx, "book") : repeatMenu(vr, ctx, "book");
    if (d === "*") return back(vr, "menu"); // star goes back one step
    if (d === "0") return back(vr, "ring", { k: "4" }); // customer service (main menu key 3's line)
    if (d === "9") return back(vr, "ring", { k: "8" }); // schools, corporate events and organizations
    const cat = (await phoneCategories())[Number(d) - 1];
    if (!cat || !/^[1-8]$/.test(d)) {
      sp(vr, ctx, "not_valid");
      return back(vr, "book");
    }
    return back(vr, "category", { c: cat.id });
  },

  async category(ctx, vr) {
    const c = Number(ctx.query.get("c"));
    const [cat] = await db.select().from(categories).where(eq(categories.id, c));
    const items = cat ? await phoneProducts(c) : [];
    if (!cat || !items.length) {
      sp(vr, ctx, "category_empty");
      return back(vr, "menu");
    }
    await track(ctx.callSid, "category_heard", `Listened to ${cat.name}`, { category: cat.name, items: items.map((p) => p.name) });
    // 10 or more items (Abraham, Nov 17, 2026): two-key choices (10, 11, 12) work; a single key acts after a short wait
    const g = keypad(vr, url("category-choice", { c }), items.length > 9 ? { numDigits: 2, timeout: MULTI_KEY_WAIT_SECONDS } : {});
    sp(g, ctx, "book_category_list", { category: cat.spokenName || cat.name });
    sp(g, ctx, "cart_key"); // Abraham (Phone Menu v3): the cart line before the items and again after them
    items.forEach((p, i) => sp(g, ctx, "category_item", { item: p.name, key: i + 1 }));
    sp(g, ctx, "cart_key");
    sp(g, ctx, "book_back"); // star goes back one step (to the bookings menu)
    return bookNoInput(vr, ctx, "category", { c });
  },

  async "category-choice"(ctx, vr) {
    const c = Number(ctx.query.get("c"));
    const d = ctx.body.Digits;
    if (!d) return bookNoInput(vr, ctx, "category", { c });
    if (d === "*") return back(vr, "book"); // one step back: the bookings menu
    if (d === "0") return back(vr, "cart", { c }); // after the cart, the same item list plays again
    const items = await phoneProducts(c);
    const p = /^\d{1,2}$/.test(d) && !d.startsWith("0") ? items[Number(d) - 1] : undefined;
    if (!p) {
      sp(vr, ctx, "not_valid");
      return back(vr, "category", { c });
    }
    await track(ctx.callSid, "item_heard", `Chose ${p.name}`, { item: p.name, productId: p.id });
    // Item first, then the date (Abraham). Adding more items for a day already chosen on this call skips the date.
    const day = ctx.session?.data.day;
    return day ? back(vr, "qty", { p: p.id, d: day }) : back(vr, "date", { p: p.id });
  },

  async product(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p || !p.active) return back(vr, "menu");
    const g = keypad(vr, url("product-choice", { p: p.id }));
    if (!ctx.query.get("again")) {
      sp(g, ctx, "product_intro", { item: p.name, price: spokenMoney(p.priceCents) });
      await track(ctx.callSid, "item_heard", `Listened to ${p.name}`, { item: p.name, productId: p.id });
    }
    sp(g, ctx, "product_options");
    sp(g, ctx, "cart_key");
    return noInput(vr, ctx, "product", { p: p.id, again: 1 });
  },

  async "product-choice"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p) return back(vr, "menu");
    const d = ctx.body.Digits;
    if (!d) return noInput(vr, ctx, "product", { p: p.id, again: 1 });
    if (d === "*") return back(vr, "category", { c: p.categoryId });
    if (d === "0") return back(vr, "cart");
    if (d === "1") {
      await track(ctx.callSid, "item_details", `Heard the details of ${p.name}`, { item: p.name, productId: p.id });
      if (p.spokenDescription || p.description) say(vr, p.spokenDescription || p.description);
      else sp(vr, ctx, "product_default_desc", { item: p.name });
      pause(vr);
      return back(vr, "product", { p: p.id, again: 1 });
    }
    if (d === "2") {
      const day = ctx.session?.data.day;
      return day ? back(vr, "qty", { p: p.id, d: day }) : back(vr, "date", { p: p.id });
    }
    sp(vr, ctx, "not_valid");
    return back(vr, "product", { p: p.id, again: 1 });
  },

  /** The event date, keys only (Abraham): MMDD. p = the item chosen (then its availability). */
  date(ctx, vr) {
    const p = ctx.query.get("p") ?? undefined;
    const g = keypad(vr, url("date-heard", { p }), { numDigits: 4, timeout: 8 });
    sp(g, ctx, "book_date_prompt");
    return bookNoInput(vr, ctx, "date", { p });
  },

  async "date-heard"(ctx, vr) {
    const p = ctx.query.get("p") ?? undefined;
    const digits = ctx.body.Digits;
    if (!digits) return bookNoInput(vr, ctx, "date", { p });
    if (digits.includes("*")) {
      // Star goes back one step: the rentals in that item's category (or the bookings menu)
      const prod = p ? await getProduct(Number(p)) : null;
      return prod ? back(vr, "category", { c: prod.categoryId }) : back(vr, "book");
    }
    const today = todayISO();
    const r = parseDateInput({ digits }, today);
    if (!r.ok) {
      await track(ctx.callSid, "date_unclear", `Date not usable (${r.reason})`, { key: digits, reason: r.reason });
      sp(vr, ctx, r.reason === "past" ? "date_past" : r.reason === "too_far" ? "date_too_far" : "date_unclear");
      return back(vr, "date", { p });
    }
    const cal = await getSettings();
    const chk = checkEventDate(r.date, cal);
    if (!chk.ok) {
      await track(ctx.callSid, "date_closed", `Asked for ${spokenDate(r.date)}: closed`, { date: r.date, reason: chk.day.reasonEn ?? chk.day.reason ?? null });
      sp(vr, ctx, "date_closed", { date: spokenDate(r.date), reason: chk.day.reasonEn ?? chk.day.reason ?? "a holiday" }); // Ashkenazi English names (Abraham)
      return back(vr, "date", { p });
    }
    await track(ctx.callSid, "date_asked", `Asked about ${spokenDate(r.date)}`, { date: r.date, key: digits });
    return back(vr, "date-ask", { p, d: r.date });
  },

  /** "You entered Tuesday, March 5th. If that is correct, press pound to continue. To enter a different date, press 1." */
  async "date-ask"(ctx, vr) {
    const p = ctx.query.get("p") ?? undefined;
    const date = ctx.query.get("d")!;
    const g = keypad(vr, url("date-confirm", { p, d: date }));
    sp(g, ctx, "book_date_entered", { date: spokenDate(date) });
    return bookNoInput(vr, ctx, "date-ask", { p, d: date });
  },

  async "date-confirm"(ctx, vr) {
    const p = ctx.query.get("p") ?? undefined;
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "date", { p }); // a different date
    if (d !== "#") {
      if (d) sp(vr, ctx, "not_valid");
      return back(vr, "date-ask", { p, d: date });
    }
    await chooseDay(ctx, date);
    return p ? back(vr, "qty", { p, d: date }) : back(vr, "book");
  },

  /**
   * The item is not available (Abraham, Nov 17, 2026, whole phone system): "The {item} is no longer available for
   * {date}. For the nearest options, press 1." Then the same date (the closest items) or the nearest date it is free.
   */
  async booked(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const g = keypad(vr, url("taken-choice", { p: p.id, d: date }));
    sp(g, ctx, "item_taken", { item: p.name, date: spokenDate(date), key: 1 });
    sp(g, ctx, "cart_key");
    return bookNoInput(vr, ctx, "booked", { p: p.id, d: date });
  },

  async "taken-choice"(ctx, vr) {
    const p = Number(ctx.query.get("p"));
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "booked-near", { p, d: date });
    if (d === "0") return back(vr, "cart");
    if (d === "*") return starToCategory(vr, p); // star: one menu back, the item's list
    sp(vr, ctx, "not_valid");
    return back(vr, "booked", { p, d: date });
  },

  /** "For the same date, press 1. For the nearest date this item is free, press 2." */
  "booked-near"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const g = keypad(vr, url("near-choice", { p, d: date }));
    sp(g, ctx, "taken_options");
    return bookNoInput(vr, ctx, "booked-near", { p, d: date });
  },

  async "near-choice"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "booked-same", { p, d: date }); // the closest items free on the same date
    if (d === "2") return back(vr, "altdates", { p, d: date }); // the nearest dates this item is free
    if (d === "0") return back(vr, "cart");
    if (d === "*") return back(vr, "booked", { p, d: date }); // star: one menu back
    sp(vr, ctx, "not_valid");
    return back(vr, "booked-near", { p, d: date });
  },

  /** Same date: the next size up / down that's free, or keep the item and pick another date. */
  async "booked-same"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const cal = await getSettings();
    const [big, small] = await Promise.all([nearestSize(p, date, 1, cal), nearestSize(p, date, -1, cal)]);
    const g = keypad(vr, url("booked-choice", { p: p.id, d: date, b: big?.id, s: small?.id }));
    if (big || small) sp(g, ctx, "booked_closest");
    if (big) sp(g, ctx, "booked_bigger", { item: big.name });
    if (small) sp(g, ctx, "booked_smaller", { item: small.name });
    sp(g, ctx, "booked_keep", { item: p.name });
    return bookNoInput(vr, ctx, "booked-same", { p: p.id, d: date });
  },

  async "booked-choice"(ctx, vr) {
    const p = Number(ctx.query.get("p"));
    const date = ctx.query.get("d")!;
    const b = ctx.query.get("b");
    const sm = ctx.query.get("s");
    const d = ctx.body.Digits;
    if (d === "1" && b) return back(vr, "qty", { p: b, d: date });
    if (d === "2" && sm) return back(vr, "qty", { p: sm, d: date });
    if (d === "3") return back(vr, "altdates", { p, d: date });
    if (d === "*") return back(vr, "booked-near", { p, d: date }); // star: one menu back (same date or nearest date)
    if (d === "0") return back(vr, "cart");
    sp(vr, ctx, "not_valid");
    return back(vr, "booked-same", { p, d: date });
  },

  /** Same item, another date: the day before / after, else the nearest open dates before and after. */
  async altdates(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const cal = await getSettings();
    const before = addDays(date, -1);
    const after = addDays(date, 1);
    const [okBefore, okAfter] = await Promise.all([itemFreeOn(p, before, cal), itemFreeOn(p, after, cal)]);
    const near = okBefore || okAfter;
    const [one, two] = near
      ? [okBefore ? before : null, okAfter ? after : null]
      : await Promise.all([nearestFreeDay(p, date, -1, cal), nearestFreeDay(p, date, 1, cal)]);
    const g = keypad(vr, url("altdate-choice", { p: p.id, d: date, one: one ?? undefined, two: two ?? undefined }));
    if (near) {
      if (one) sp(g, ctx, "altdate_before", { item: p.name, date: spokenDate(one) });
      if (two) sp(g, ctx, one ? "altdate_after_also" : "altdate_after", { item: p.name, date: spokenDate(two) });
    } else {
      sp(g, ctx, "altdate_not_near", { item: p.name });
      if (one) sp(g, ctx, "altdate_nearest_before", { date: spokenDate(one) });
      if (two) sp(g, ctx, "altdate_nearest_after", { date: spokenDate(two) });
    }
    sp(g, ctx, "altdate_other");
    await track(ctx.callSid, "step", `Other dates offered for ${p.name}`, { item: p.name, date, before: one, after: two });
    return bookNoInput(vr, ctx, "altdates", { p: p.id, d: date });
  },

  async "altdate-choice"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const one = ctx.query.get("one");
    const two = ctx.query.get("two");
    const d = ctx.body.Digits;
    const pick = d === "1" && one ? one : d === "2" && two ? two : null;
    if (pick) {
      await chooseDay(ctx, pick);
      return back(vr, "qty", { p, d: pick });
    }
    if (d === "3") return back(vr, "date", { p });
    if (d === "*") return back(vr, "booked-near", { p, d: date }); // star: one menu back
    if (d === "0") return back(vr, "cart");
    sp(vr, ctx, "not_valid");
    return back(vr, "altdates", { p, d: date });
  },

  async qty(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const free = await checkBookable(p.id, p.quantity, date);
    if (free <= 0) {
      await track(ctx.callSid, "unavailable", `${p.name} not available on ${spokenDate(date)}`, { item: p.name, productId: p.id, date });
      return back(vr, "booked", { p: p.id, d: date });
    }
    if (free === 1) return back(vr, "add", { p: p.id, d: date, q: 1 });
    const max = Math.min(free, 9);
    const g = keypad(vr, url("add", { p: p.id, d: date }));
    sp(g, ctx, "qty_prompt", { count: free, date: spokenDate(date), max });
    return noInput(vr, ctx, "qty", { p: p.id, d: date });
  },

  async "soldout-choice"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const d = ctx.body.Digits;
    const order = await currentOrder(ctx);
    if (d === "9" || d === "0") return back(vr, "cart");
    if (d === "*") return p ? back(vr, "category", { c: p.categoryId }) : back(vr, "book"); // star: one menu back
    if (d === "1" && !order && p) return back(vr, "date", { p: p.id });
    if ((d === "1" && order) || d === "2") return back(vr, p ? "category" : "menu", p ? { c: p.categoryId } : {});
    if (d && p) {
      sp(vr, ctx, "not_valid"); // # or any other key (Abraham: # is never a menu key)
      return back(vr, "qty", { p: p.id, d: ctx.session?.data.day ?? todayISO() });
    }
    return back(vr, "menu");
  },

  async add(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const q = Number(ctx.query.get("q") || ctx.body.Digits || 0);
    if (!q || q < 1 || q > 9) {
      sp(vr, ctx, "qty_invalid");
      return back(vr, "qty", { p: p.id, d: date });
    }
    if (await isBounceHouse(p.categoryId)) sp(vr, ctx, "bounce_water_note"); // Abraham (Phone Menu v3): before a bounce house is added
    const session = ctx.session ?? (await ensureSession(ctx.callSid, ctx.from));
    // The held order for this day (one per rental day on the call)
    const existing = (await callOrders(ctx)).find((o) => o.order.eventDate === date) ?? null;
    const r = await reserveItem({
      orderId: existing?.order.id ?? null,
      productId: p.id,
      qty: q,
      eventDate: date,
      channel: "PHONE",
      holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES),
      callSid: ctx.callSid,
    });
    if (!r.ok) {
      if (r.reason === "unavailable") {
        await track(ctx.callSid, "unavailable", r.free > 0 ? `Only ${r.free} ${p.name} left on ${spokenDate(date)} (asked for ${q})` : `${p.name} was just booked for ${spokenDate(date)}`, { item: p.name, productId: p.id, date, asked: q, free: r.free });
        if (r.free > 0) sp(vr, ctx, "only_some_left", { count: r.free });
        else sp(vr, ctx, "just_booked", { item: p.name });
        return back(vr, r.free > 0 ? "qty" : "menu", r.free > 0 ? { p: p.id, d: date } : {});
      }
      sp(vr, ctx, "went_wrong");
      return back(vr, "menu");
    }
    await track(ctx.callSid, "item_added", `Added ${itemPhrase(q, p.name)} for ${spokenDate(date)}`, { item: p.name, productId: p.id, qty: q, date, orderId: r.orderId });
    const ids = [...new Set([...(session.data?.dayOrderIds ?? []), r.orderId])];
    await updateSession(ctx.callSid, { orderId: r.orderId, outcome: "carted", data: { day: date, dayOrderIds: ids } }, session);
    // Abraham (Nov 17, 2026): the item added line every time; ocean balls after a jumping balloon; then keep shopping
    if (await isBounceHouse(p.categoryId)) {
      sp(vr, ctx, "item_added");
      return back(vr, "ocean", { d: date });
    }
    // A maze or laser guns: the extra gun packs (once the wording is approved; on preview it plays for his test)
    if ((await isLaserBase(p.categoryId)) && (process.env.VERCEL_ENV !== "production" || !promptWaiting(ctx.prompts, "laser_packs"))) {
      sp(vr, ctx, "item_added");
      return back(vr, "packs", { d: date });
    }
    const g = keypad(vr, url("after-add"));
    sp(g, ctx, "item_added");
    sp(g, ctx, "keep_shopping");
    sp(g, ctx, "another_day");
    return noInput(vr, ctx, "cart");
  },

  /** "To keep shopping, press 1. To go to your shopping cart, press 0." */
  "added-menu"(ctx, vr) {
    const g = keypad(vr, url("after-add"));
    sp(g, ctx, "keep_shopping");
    sp(g, ctx, "another_day");
    return noInput(vr, ctx, "cart");
  },

  async "after-add"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "book"); // star: one menu back, the bookings menu (Abraham, Nov 18, 2026)
    if (d === "1") return back(vr, "book"); // keep shopping (the same day; the date was already chosen)
    if (d === "2") return back(vr, "date"); // "To book another day, press 2." (Abraham, Nov 17, 2026)
    if (d === "0") return back(vr, "cart");
    if (d) {
      sp(vr, ctx, "not_valid");
      return back(vr, "added-menu");
    }
    return noInput(vr, ctx, "cart");
  },

  /** Extra laser gun packs after a maze or guns (Abraham, Nov 17, 2026): 1 = 6-pack $75, 2 = 4-pack $50, # skips. */
  packs(ctx, vr) {
    const d = ctx.query.get("d")!;
    const g = keypad(vr, url("packs-choice", { d }));
    if (promptWaiting(ctx.prompts, "laser_packs")) say(g, promptText(ctx.prompts, "laser_packs"));
    else sp(g, ctx, "laser_packs");
    return bookNoInput(vr, ctx, "packs", { d });
  },

  async "packs-choice"(ctx, vr) {
    const date = ctx.query.get("d")!;
    const k = ctx.body.Digits ?? "";
    if (k === "#") return back(vr, "added-menu");
    const packs = await addOnProducts(LASER_ADDONS_CATEGORY);
    const pick = /^[12]$/.test(k) ? packs[Number(k) - 1] : undefined;
    if (!pick) {
      sp(vr, ctx, "not_valid");
      return back(vr, "packs", { d: date });
    }
    const day = (await callOrders(ctx)).find((o) => o.order.eventDate === date) ?? null;
    const r = await reserveItem({ orderId: day?.order.id ?? null, productId: pick.id, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES), callSid: ctx.callSid });
    if (r.ok) {
      await track(ctx.callSid, "item_added", `Added ${pick.name} for ${spokenDate(date)}`, { item: pick.name, productId: pick.id, qty: 1, date, orderId: r.orderId });
      const ids = [...new Set([...(ctx.session?.data.dayOrderIds ?? []), r.orderId])];
      await updateSession(ctx.callSid, { data: { dayOrderIds: ids } }, ctx.session);
      sp(vr, ctx, "item_added");
      return back(vr, "packs", { d: date }); // more packs, or pound to go on
    }
    sp(vr, ctx, r.reason === "unavailable" ? "just_booked" : "went_wrong", { item: pick.name });
    return back(vr, "added-menu");
  },

  /** Ocean balls after every jumping balloon (Abraham, Nov 17, 2026): 1 = 200 for $10, 2 = 500 for $15, 3 = 700 for $20, # skips. */
  ocean(ctx, vr) {
    const d = ctx.query.get("d")!;
    const n = ctx.query.get("n") ?? undefined;
    const g = keypad(vr, url("ocean-choice", { d, n }));
    sp(g, ctx, "ocean_balls");
    return bookNoInput(vr, ctx, "ocean", { d, n });
  },

  async "ocean-choice"(ctx, vr) {
    const date = ctx.query.get("d")!;
    const n = ctx.query.get("n") ?? undefined;
    const next = () => (n === "resume" ? back(vr, "resume-items") : back(vr, "added-menu"));
    const k = ctx.body.Digits ?? "";
    if (k === "#") return next();
    const sets = await oceanBallProducts();
    const pick = /^[1-3]$/.test(k) ? sets[Number(k) - 1] : undefined;
    if (!pick) {
      sp(vr, ctx, "not_valid");
      return back(vr, "ocean", { d: date, n });
    }
    // On the same day's order as the balloon, so it is on the order and in the payment total
    const day = (await callOrders(ctx)).find((o) => o.order.eventDate === date) ?? null;
    const r = await reserveItem({ orderId: day?.order.id ?? null, productId: pick.id, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES), callSid: ctx.callSid });
    if (r.ok) {
      await track(ctx.callSid, "item_added", `Added ${pick.name} for ${spokenDate(date)}`, { item: pick.name, productId: pick.id, qty: 1, date, orderId: r.orderId });
      const ids = [...new Set([...(ctx.session?.data.dayOrderIds ?? []), r.orderId])];
      await updateSession(ctx.callSid, { data: { dayOrderIds: ids } }, ctx.session);
      sp(vr, ctx, "item_added");
    } else sp(vr, ctx, "went_wrong");
    return next();
  },

  /** The whole cart: every day on this call, then one total. */
  async cart(ctx, vr) {
    const days = await callOrders(ctx);
    const c = ctx.query.get("c") ?? undefined; // the item list the caller came from (Abraham, Phone Menu v3)
    if (!days.length) {
      sp(vr, ctx, "cart_empty");
      return c ? back(vr, "category", { c }) : back(vr, "book");
    }
    const g = keypad(vr, url("cart-choice", { c }));
    sp(g, ctx, "cart_intro");
    for (const o of days) sp(g, ctx, "cart_day", { date: spokenDate(o.order.eventDate), items: o.items.map((i) => itemPhrase(i.qty, i.name)).join(", ") });
    sp(g, ctx, "cart_total", { total: spokenMoney(days.reduce((t, o) => t + o.order.subtotalCents, 0)) });
    sp(g, ctx, "cart_options");
    // From an item list: once the cart has been read, the same item list plays again (Abraham, Phone Menu v3)
    if (c) return back(vr, "category", { c });
    return noInput(vr, ctx, "cart");
  },

  async "cart-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    const c = ctx.query.get("c") ?? undefined;
    if (d === "*") return c ? back(vr, "category", { c }) : back(vr, "menu"); // star: one step back
    if (d === "1") {
      sp(vr, ctx, "checkout_tax_note"); // Abraham (Phone Menu v3): before checkout
      return back(vr, "ask", { f: "name" });
    }
    if (d === "2") return c ? back(vr, "category", { c }) : back(vr, "book"); // keep shopping
    if (d === "3") {
      for (const o of await callOrders(ctx)) await cancelHold(o.order.id);
      await updateSession(ctx.callSid, { orderId: null, outcome: "browsing", data: { dayOrderIds: [], day: undefined } }, ctx.session);
      sp(vr, ctx, "cart_cleared");
      return back(vr, "menu");
    }
    if (d) {
      sp(vr, ctx, "not_valid"); // # or any other key
      return back(vr, "cart", { c });
    }
    return c ? back(vr, "category", { c }) : noInput(vr, ctx, "cart");
  },

  /* ---- checkout: name -> address -> email -> phone -> finalize ---- */

  async ask(ctx, vr) {
    if (!(await callOrders(ctx)).length) {
      sp(vr, ctx, "cart_empty");
      return back(vr, "menu");
    }
    const f = ctx.query.get("f") as Field;
    const n = ctx.query.get("n") ?? undefined;
    const spec = FIELDS[f];
    const prompt: PromptKey = f === "email" && ctx.session?.data.emailRequired ? "ask_email_required" : spec.prompt;
    // Abraham, Nov 17, 2026: not understood = only the retry line (the step's own line, with its thanks, never
    // repeats); every spoken question is followed by the tone, then the caller speaks.
    const retry = Number(n || 0) > 0;
    const ownStar = f === "street" || f === "unit"; // these lines already say "press star to type it"
    const question = (g: Gather) => {
      if (retry) sp(g, ctx, "retry_spoken");
      else {
        spPreviewDraft(g, ctx, prompt);
        if (!ownStar) {
          sp(g, ctx, "type_hint");
          spPreviewDraft(g, ctx, "press_pound_done");
        }
      }
      g.play(`${config.baseUrl()}/audio/tone.wav`);
    };
    if (sttActive()) {
      // Speech to text (preview only until Abraham approves the price): the question, a moment for star (type it) or
      // pound (skip email), then the answer is recorded and typed up by Google while a soft clip plays.
      const k = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 1, finishOnKey: "", action: url("heard", { f, n }), method: "POST" });
      question(k);
      vr.record({ maxLength: 20, timeout: 3, playBeep: false, finishOnKey: "#*", trim: "trim-silence", action: url("stt-recorded", { f, n }), method: "POST" });
      return vr;
    }
    // Say it, or press star to type it on the keypad (Abraham L). finishOnKey "" so star and # arrive as keys.
    // Pound ends a spoken answer and keeps what was said so far (Abraham, Nov 17, 2026): Twilio's partial results are
    // saved as the caller speaks, because a key press alone would drop the words.
    await updateSession(ctx.callSid, { data: { speechPartial: undefined } }, ctx.session);
    const g = speech(vr, url("heard", { f, n }), spec.hints, { dtmf: true, numDigits: 1, finishOnKey: "", partial: url("speech-partial") });
    question(g);
    return vr;
  },

  /** Twilio's partial speech results while the caller answers: kept so pound can end the answer without losing it. */
  async "speech-partial"(ctx, vr) {
    const said = `${ctx.body.StableSpeechResult ?? ""} ${ctx.body.UnstableSpeechResult ?? ""}`.replace(/\s+/g, " ").trim();
    if (said) await updateSession(ctx.callSid, { data: { speechPartial: said.slice(0, 300) } }, ctx.session);
    return vr;
  },

  /** Keypad typing: the instructions, then keys until # (star separates letters inside this prompt, not the menu). */
  type(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 15, action: url("typed", { f }), method: "POST" });
    if (!ctx.query.get("again")) {
      if (f === "email") sp(g, ctx, "type_email_symbols");
      sp(g, ctx, "type_instructions"); // ends with "When you are finished, please press pound."
    }
    return back(vr, "typed", { f });
  },

  async typed(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const spec = FIELDS[f];
    const raw = decodeMultitap(ctx.body.Digits || "", f === "email" ? "email" : "text");
    const value = raw ? (f === "email" ? spec.normalize(raw) : titleCase(raw)) : null;
    if (!value) {
      sp(vr, ctx, "field_unclear");
      return back(vr, "type", { f, again: 1 });
    }
    await track(ctx.callSid, "typed", `Typed ${f}: ${value}`, { field: f, value });
    await updateSession(ctx.callSid, { data: { heard: value } }, ctx.session);
    const g = keypad(vr, url("confirm", { f }));
    sp(g, ctx, "typed_back", { value: spec.readBack(value) });
    return noInput(vr, ctx, "type", { f, again: 1 });
  },

  /** Speech to text: the answer was recorded. Type it up in the background; the caller hears the hold clip. */
  async "stt-recorded"(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const n = ctx.query.get("n") ?? undefined;
    const digits = ctx.body.Digits || "";
    const secs = Number(ctx.body.RecordingDuration || 0);
    if (digits === "*") return back(vr, "type", { f });
    if (!ctx.body.RecordingUrl || secs < 1) {
      // Nothing said: pound skips the email (as before); otherwise the usual "didn't catch that" path
      return back(vr, "heard", { f, n, empty: 1, ...(digits === "#" && f === "email" ? { skip: 1 } : {}) });
    }
    const [row] = await db
      .insert(schema.spokenAnswers)
      .values({ callSid: ctx.callSid, field: f, recordingSid: ctx.body.RecordingSid || null, recordingUrl: ctx.body.RecordingUrl, durationSec: secs })
      .returning({ id: schema.spokenAnswers.id });
    const hints = FIELDS[f].hints.split(",").map((h) => h.trim()).filter(Boolean);
    runLater(() => transcribeAnswer(row.id, hints));
    vr.play(`${config.baseUrl()}${STT_HOLD_FILE}`);
    return back(vr, "stt-check", { f, n, a: row.id, w: 1 });
  },

  async "stt-check"(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const n = ctx.query.get("n") ?? undefined;
    const a = Number(ctx.query.get("a"));
    const w = Number(ctx.query.get("w") || 1);
    const row = await callSpokenAnswer(ctx, a);
    if (row && row.status === "pending" && w < STT_MAX_WAITS) {
      vr.play(`${config.baseUrl()}${STT_HOLD_FILE}`);
      return back(vr, "stt-check", { f, n, a, w: w + 1 });
    }
    return back(vr, "heard", { f, n, a: row?.id });
  },

  async heard(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const spec = FIELDS[f];
    if (f === "unit" && ctx.body.Digits === "#" && !(ctx.body.SpeechResult || "").trim()) {
      await updateSession(ctx.callSid, { data: { unit: undefined } }, ctx.session); // no apartment or unit
      return back(vr, "addr-zip");
    }
    const required = f === "email" && Boolean(ctx.session?.data.emailRequired);
    if (ctx.query.get("skip")) return required ? back(vr, "ask", { f }) : back(vr, "phone"); // pound on the recording: skip email
    if (ctx.body.Digits === "*") return back(vr, "type", { f }); // switch to keypad typing
    // Speech to text: the typed-up answer comes from our own record of this call, not from Twilio's speech result
    const typedUp = await callSpokenAnswer(ctx, Number(ctx.query.get("a")));
    const viaStt = Boolean(typedUp) || ctx.query.get("empty") === "1";
    // Pound in the middle of a spoken answer: the words said so far are the answer (Abraham, Nov 17, 2026)
    const partial = ctx.session?.data.speechPartial;
    if (!viaStt && ctx.body.Digits === "#" && !ctx.body.SpeechResult && partial) ctx.body.SpeechResult = partial;
    if (!viaStt) {
      if (f === "email" && ((ctx.body.Digits === "#" && !ctx.body.SpeechResult) || (ctx.body.Digits === "" && !ctx.body.SpeechResult))) return required ? back(vr, "ask", { f }) : back(vr, "phone"); // skip email (as before), unless it is required
      if (ctx.body.Digits && !ctx.body.SpeechResult) return back(vr, "ask", { f }); // another key: ask again
    } else if (ctx.body.Digits === "#" && f === "email") return required ? back(vr, "ask", { f }) : back(vr, "phone");
    const raw = (viaStt ? typedUp?.text || "" : ctx.body.SpeechResult || "").trim();
    const value = raw ? spec.normalize(raw) : null;
    if (!value) {
      const n = Number(ctx.query.get("n") || 0) + 1;
      if (f === "email" && n >= 2 && !required) {
        sp(vr, ctx, "email_skip");
        return back(vr, "phone");
      }
      if (n >= MAX_NO_INPUT) {
        sp(vr, ctx, "field_trouble");
        // Abraham, Nov 15, 2026: name and address can never be skipped. A person takes it, or the caller types it.
        return config.forwardPhone() ? back(vr, "operator") : back(vr, "type", { f });
      }
      if (f === "email") sp(vr, ctx, "email_unclear"); // other fields: the ask step plays only the retry line
      return back(vr, "ask", { f, n });
    }
    await track(ctx.callSid, "said", `Said ${f}: ${value}`, { field: f, value, raw, ...(viaStt ? { via: "speech to text" } : {}) });
    if (f === "street" || f === "unit") {
      // The address steps read the whole address back at step 6, not each part
      await updateSession(ctx.callSid, { data: { [f]: value, heard: undefined } }, ctx.session);
      return back(vr, spec.next);
    }
    await updateSession(ctx.callSid, { data: { heard: value } }, ctx.session);
    if (viaStt) {
      // Read back in the Google voice (never Twilio's Say); the draft wording plays on preview for Abraham's test
      const links = await googleReadback(lineTemplate(ctx, "spoken_readback"), { text: spec.readBack(value) });
      if (!links) return back(vr, "type", { f }); // Google voice not available: type it on the keypad instead
      // Abraham, Nov 15, 2026: pound confirms; 1 records the answer again from the start of this step
      const g = keypad(vr, url("confirm", { f, k: "pound" }));
      for (const l of links) g.play(l);
      return noInput(vr, ctx, "ask", { f });
    }
    const g = keypad(vr, url("confirm", { f }));
    sp(g, ctx, "heard", { value: spec.readBack(value) });
    return noInput(vr, ctx, "ask", { f });
  },

  /**
   * Directions for the driver (Abraham, Nov 15, 2026): optional, after the address. Pound (or nothing said) skips.
   * The wording is a draft: the step runs on preview only until Abraham approves the two lines.
   */
  directions(ctx, vr) {
    if (!directionsActive(ctx)) return back(vr, "finalize"); // no email in the booking (Abraham, Nov 17, 2026)
    const g = vr.gather({ input: ["speech", "dtmf"], finishOnKey: "", numDigits: 1, timeout: 6, speechTimeout: "auto", language: "en-US", speechModel: "phone_call", enhanced: true, action: url("directions-heard"), method: "POST", actionOnEmptyResult: true });
    sp(g, ctx, "ask_directions", undefined, { draftOk: true });
    g.play(`${config.baseUrl()}/audio/tone.wav`); // the tone, then the caller speaks (Abraham, Nov 17, 2026)
    return back(vr, "finalize"); // nothing said: skip
  },

  async "directions-heard"(ctx, vr) {
    if (ctx.body.Digits === "*") return back(vr, "type", { f: "directions" }); // type it on the keypad
    const said = (ctx.body.SpeechResult || "").trim();
    if (said && ctx.body.Digits !== "#") {
      await updateSession(ctx.callSid, { data: { directions: said.slice(0, 500) } }, ctx.session);
      await track(ctx.callSid, "said", `Delivery directions: ${said.slice(0, 200)}`, { field: "directions", value: said });
      sp(vr, ctx, "directions_saved", undefined, { draftOk: true });
    }
    return back(vr, "finalize");
  },

  /*
   * Delivery address in steps (Abraham, Nov 17, 2026): street (spoken), house number (keypad), apartment or unit
   * (spoken, pound skips), zip (10950 or another), the area check, the read-back, the delivery price, then the
   * directions. Steps 2 to 7 are drafts: the whole flow runs on preview only until he approves them; the live line
   * keeps the one address question until then.
   */
  addr(ctx, vr) {
    if (!addrStepsActive(ctx)) return back(vr, "ask", { f: "address" });
    return back(vr, "ask", { f: "street" });
  },

  "addr-house"(ctx, vr) {
    const g = keypad(vr, url("addr-house-heard"), { numDigits: 7, timeout: 10, finishOnKey: "#" });
    spPreviewDraft(g, ctx, "addr_house");
    return repeatMenu(vr, ctx, "addr-house");
  },

  async "addr-house-heard"(ctx, vr) {
    const digits = (ctx.body.Digits || "").replace(/\D/g, "");
    if (!/^[0-9]{1,6}$/.test(digits) || /^0+$/.test(digits)) {
      sp(vr, ctx, "not_valid");
      return back(vr, "addr-house");
    }
    await updateSession(ctx.callSid, { data: { house: digits } }, ctx.session);
    return back(vr, "ask", { f: "unit" });
  },

  "addr-zip"(ctx, vr) {
    const g = keypad(vr, url("addr-zip-choice"));
    spPreviewDraft(g, ctx, "addr_zip");
    return repeatMenu(vr, ctx, "addr-zip");
  },

  async "addr-zip-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") {
      await updateSession(ctx.callSid, { data: { zip: DEFAULT_ZIP } }, ctx.session);
      return back(vr, "addr-check");
    }
    if (d === "2") return back(vr, "addr-zip-enter");
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-zip");
  },

  "addr-zip-enter"(ctx, vr) {
    const g = keypad(vr, url("addr-zip-heard"), { numDigits: 6, timeout: 10, finishOnKey: "#" });
    spPreviewDraft(g, ctx, ctx.query.get("bad") ? "addr_zip_bad" : "addr_zip_enter");
    return repeatMenu(vr, ctx, "addr-zip-enter", { bad: ctx.query.get("bad") ?? undefined });
  },

  async "addr-zip-heard"(ctx, vr) {
    const zip = (ctx.body.Digits || "").replace(/\D/g, "");
    if (!/^[0-9]{5}$/.test(zip)) return back(vr, "addr-zip-enter", { bad: 1 });
    await updateSession(ctx.callSid, { data: { zip } }, ctx.session);
    return back(vr, "addr-check");
  },

  /** Step 5: the town from the zip (Orange County only), then the delivery map (the street decides the price). */
  async "addr-check"(ctx, vr) {
    const data = ctx.session?.data ?? {};
    if (!data.street || !data.house) return back(vr, "ask", { f: "street" });
    const zip = data.zip ?? DEFAULT_ZIP;
    const town = townForZip(zip);
    if (!town) return back(vr, "addr-outside");
    const address = `${data.house} ${data.street}${data.unit ? `, ${data.unit}` : ""}, ${town}, NY ${zip}`;
    const firstDay = (await callOrders(ctx))[0]?.order.eventDate;
    const quote = await deliveryQuote(address, await getSettings(), fetch, firstDay ?? new Date());
    if (!quote.ok && quote.reason === "not_found") {
      await updateSession(ctx.callSid, { data: { street: undefined, house: undefined, unit: undefined } }, ctx.session);
      spPreviewDraft(vr, ctx, "addr_not_found");
      return back(vr, "ask", { f: "street" });
    }
    if (!quote.ok) return back(vr, "addr-outside");
    // Kiryas Joel streets (the Kiryas Joel zone on the delivery map) are read back and saved as Kiryas Joel, not
    // Monroe (Abraham, Nov 17, 2026); the zip alone can't tell, 10950 covers both
    const kj = zip === DEFAULT_ZIP && quote.kind === "local";
    const placeTown = kj ? "Kiryas Joel" : town;
    const placeAddress = kj ? address.replace(`, ${town}, NY`, ", Kiryas Joel, NY") : address;
    await updateSession(ctx.callSid, { data: { address: placeAddress, town: placeTown, zip } }, ctx.session);
    await track(ctx.callSid, "said", `Address: ${placeAddress} (${quote.zone}, ${money(quote.feeCents)})`, { field: "address", value: placeAddress });
    return back(vr, "addr-readback");
  },

  "addr-outside"(ctx, vr) {
    const g = keypad(vr, url("addr-outside-choice"));
    spPreviewDraft(g, ctx, "addr_outside");
    return repeatMenu(vr, ctx, "addr-outside");
  },

  "addr-outside-choice"(ctx, vr) {
    if (ctx.body.Digits === "1") return back(vr, "addr-zip-enter");
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-outside");
  },

  /** Step 6: "Thanks! I have 1 2 Forest Road, Monroe, New York, 1 0 9 5 0. If that is correct, press 1..." */
  "addr-readback"(ctx, vr) {
    const d = ctx.session?.data ?? {};
    if (!d.address || !d.house || !d.street || !d.zip || !d.town) return back(vr, "ask", { f: "street" });
    const template = lineTemplate(ctx, "addr_readback");
    const text = fill(d.unit ? template : template.replace(/,\s*\{unit\}/, ""), { house: spokenDigits(d.house), street: d.street, unit: d.unit ?? "", town: d.town, zip: spokenDigits(d.zip) });
    const g = keypad(vr, url("addr-readback-choice"));
    say(g, text);
    return repeatMenu(vr, ctx, "addr-readback");
  },

  async "addr-readback-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "addr-price");
    if (d === "2") {
      await updateSession(ctx.callSid, { data: { address: undefined, street: undefined, house: undefined, unit: undefined, zip: undefined, town: undefined } }, ctx.session);
      return back(vr, "ask", { f: "street" });
    }
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-readback");
  },

  /** Step 7: "Thanks! Delivery to Monroe, New York, is 10 dollars." Then the directions (box 34). */
  async "addr-price"(ctx, vr) {
    const d = ctx.session?.data ?? {};
    if (!d.address || !d.town) return back(vr, "ask", { f: "street" });
    const settings = await getSettings();
    const first = (await callOrders(ctx))[0]?.order;
    const quote = await deliveryQuote(d.address, settings, fetch, first?.eventDate ?? new Date());
    if (quote.ok) {
      const cents = quote.kind ? deliveryFeeFor(quote.kind, settings, first?.eventDate ?? todayISO(), first?.offerNote ?? null) : quote.feeCents;
      const price = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
      spPreviewDraft(vr, ctx, "addr_price", { town: d.town, price });
    }
    return back(vr, "directions");
  },

  async confirm(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const d = ctx.body.Digits;
    // Abraham, Nov 15, 2026: every read-back confirms with pound; 1 asks again. Any other key (Nov 16, 2026): the
    // shared wrong-key line, then the same read-back again.
    const yes = d === "#";
    if (d && d !== "1" && !yes && ctx.session?.data.heard) {
      sp(vr, ctx, "not_valid");
      return back(vr, "readback", { f });
    }
    if (!yes) return back(vr, "ask", { f });
    const heard = ctx.session?.data.heard;
    if (!heard) return back(vr, "ask", { f });
    const quote = f === "address" ? await deliveryQuote(heard, await getSettings()) : null;
    if (quote && !quote.ok && quote.reason === "not_found") {
      // The house could not be found on the map (Abraham, Nov 15, 2026): ask for the address again
      await updateSession(ctx.callSid, { data: { heard: undefined } }, ctx.session);
      sp(vr, ctx, "address_not_found");
      return back(vr, "ask", { f: "address" });
    }
    if (quote && !quote.ok) {
      // Outside every zone on the price map: we don't deliver there; the caller is asked for another address
      await updateSession(ctx.callSid, { data: { heard: undefined } }, ctx.session);
      sp(vr, ctx, "address_outside_area");
      return back(vr, "ask", { f: "address" });
    }
    const wasRequired = f === "email" && Boolean(ctx.session?.data.emailRequired);
    await updateSession(ctx.callSid, { data: { [f]: heard, heard: undefined, ...(wasRequired ? { emailRequired: undefined } : {}) } }, ctx.session);
    return back(vr, wasRequired ? "finalize" : FIELDS[f].next);
  },

  /** The same read-back again after a wrong key (the answer is still in the session). */
  readback(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const heard = ctx.session?.data.heard;
    if (!heard || !FIELDS[f]) return back(vr, "ask", { f });
    const g = keypad(vr, url("confirm", { f }));
    sp(g, ctx, "heard", { value: FIELDS[f].readBack(heard) });
    return noInput(vr, ctx, "ask", { f });
  },

  /* ---- Terms: "By pressing #, you agree to our Terms and Conditions..." (logged with time, phone, order, version) ---- */

  terms(ctx, vr) {
    const g = keypad(vr, url("terms-answer", { n: ctx.query.get("n") ?? undefined }), { timeout: 8 });
    say(g, promptText(ctx.prompts, "terms_notice"));
    return back(vr, "terms-answer", { n: ctx.query.get("n") ?? undefined });
  },

  async "terms-answer"(ctx, vr) {
    const order = (await callOrders(ctx))[0] ?? null; // the first day's order stands for the whole reservation
    if (!order) {
      sp(vr, ctx, "cart_expired");
      return back(vr, "menu");
    }
    if (ctx.body.Digits === "1") {
      // Text the Terms link (only with order-text consent from this call or before).
      const phone = ctx.session?.data.phone ?? toE164(ctx.from);
      const consented = ctx.session?.data.smsConsent === "yes" || ctx.session?.data.smsConsent === "existing" || (phone ? (await consentState(phone)).transactional?.action === "opt_in" : false);
      const r = phone && consented ? await sendSms(phone, promptText(ctx.prompts, "msg_terms_link", { link: `${config.baseUrl()}/terms` }), { kind: "transactional", event: "terms_link", orderId: order.order.id, callSid: ctx.callSid }) : null;
      sp(vr, ctx, r?.sent ? "terms_link_sent" : "terms_link_no_text");
      return back(vr, "terms", { n: ctx.query.get("n") ?? undefined });
    }
    if (ctx.body.Digits === "#") {
      const notice = promptText(ctx.prompts, "terms_notice");
      // One record per rental day on this call, each with the caller ID and the call id (Abraham: every reservation)
      for (const day of await callOrders(ctx)) {
        await recordTermsAcceptance({
          orderId: day.order.id,
          phone: ctx.session?.data.phone ?? toE164(ctx.from),
          callerPhone: toE164(ctx.from) ?? (ctx.from || null),
          callSid: ctx.callSid,
          termsVersion: CURRENT_TERMS_VERSION,
          termsText: TERMS_TEXT,
          method: "phone_hash",
          acceptanceStatement: `Pressed "#" for reservation #${orderNumber(order.order.id)}${day.order.id !== order.order.id ? ` (rental day #${orderNumber(day.order.id)})` : ""} after hearing: "${notice}"`,
          amountCents: day.order.subtotalCents,
        });
      }
      await updateSession(ctx.callSid, { data: { termsAccepted: true } }, ctx.session);
      return back(vr, "finalize");
    }
    const n = Number(ctx.query.get("n") || 0) + 1;
    if (ctx.body.Digits && n < 2) sp(vr, ctx, "not_valid"); // wrong key: the shared line, then the terms again
    if (n >= 2) {
      sp(vr, ctx, "terms_required");
      vr.hangup(); // hanging up releases the held items
      return vr;
    }
    return back(vr, "terms", { n });
  },

  async phone(ctx, vr) {
    const from = toE164(ctx.from);
    if (!from) return back(vr, "phone-enter");
    const g = keypad(vr, url("phone-choice"));
    sp(g, ctx, "phone_confirm", { last4: spokenDigits(last4(from)).replace(/ /g, ", ") });
    return noInput(vr, ctx, "phone");
  },

  async "phone-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") {
      await updateSession(ctx.callSid, { data: { phone: toE164(ctx.from)! } }, ctx.session);
      return back(vr, "sms-consent");
    }
    if (d === "2") return back(vr, "phone-enter");
    if (d) {
      sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      return back(vr, "phone");
    }
    return noInput(vr, ctx, "phone");
  },

  "phone-enter"(ctx, vr) {
    const g = keypad(vr, url("phone-heard"), { numDigits: 10, timeout: 10, finishOnKey: "#" });
    sp(g, ctx, "phone_enter");
    spPreviewDraft(g, ctx, "press_pound_done");
    return noInput(vr, ctx, "phone-enter");
  },

  async "phone-heard"(ctx, vr) {
    const e164 = toE164(ctx.body.Digits);
    if (!e164) {
      sp(vr, ctx, "phone_bad");
      return back(vr, "phone-enter");
    }
    await updateSession(ctx.callSid, { data: { heard: e164 } }, ctx.session);
    const g = keypad(vr, url("phone-confirm"));
    sp(g, ctx, "phone_heard", { number: `${spokenDigits(e164.slice(2, 5))}, ${spokenDigits(e164.slice(5, 8))}, ${spokenDigits(e164.slice(8))}` });
    return noInput(vr, ctx, "phone-enter");
  },

  async "phone-confirm"(ctx, vr) {
    const d = ctx.body.Digits;
    const heard = ctx.session?.data.heard;
    if (d && d !== "#" && d !== "1" && heard) {
      sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      const g = keypad(vr, url("phone-confirm"));
      sp(g, ctx, "phone_heard", { number: `${spokenDigits(heard.slice(2, 5))}, ${spokenDigits(heard.slice(5, 8))}, ${spokenDigits(heard.slice(8))}` });
      return noInput(vr, ctx, "phone-enter");
    }
    if (d !== "#" || !heard) return back(vr, "phone-enter");
    await updateSession(ctx.callSid, { data: { phone: heard, heard: undefined } }, ctx.session);
    return back(vr, "sms-consent");
  },

  /* ---- SMS consent: transactional (before the payment link), separate from promotional (after the order) ---- */

  async "sms-consent"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    if (!phone) return back(vr, "phone");
    const retry = Number(ctx.query.get("n") || 0) > 0;
    if (!retry) {
      const customer = await customerByPhone(phone);
      if (customer?.smsOptOut) {
        // Twilio blocks texts to a number that replied STOP until it texts START; don't ask, explain.
        sp(vr, ctx, "consent_stopped");
        await updateSession(ctx.callSid, { data: { smsConsent: "stopped" } }, ctx.session);
        return back(vr, "finalize");
      }
      const state = await consentState(phone);
      if (state.transactional?.action === "opt_in") {
        await updateSession(ctx.callSid, { data: { smsConsent: "existing" } }, ctx.session);
        return back(vr, "finalize");
      }
    }
    // Abraham, Nov 15, 2026: yes or no questions are answered by key only (1 yes, 2 no), never by speech
    const g = keypad(vr, url("sms-consent-answer", { n: ctx.query.get("n") ?? undefined }), { timeout: 8 });
    sp(g, ctx, retry && ctx.query.get("k") !== "1" ? "consent_unclear" : "consent_transactional");
    return vr;
  },

  async "sms-consent-answer"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    if (!phone) return back(vr, "phone");
    const n = Number(ctx.query.get("n") || 0);
    const answer = parseConsentAnswer({ digits: ctx.body.Digits, speech: ctx.body.SpeechResult, confidence: ctx.body.Confidence });
    // A wrong key (Abraham, Nov 16, 2026): the shared line, then the same question again
    if (answer === "unclear" && ctx.body.Digits && n < 2) {
      sp(vr, ctx, "not_valid");
      return back(vr, "sms-consent", { n: n + 1, k: 1 });
    }
    if (answer === "unclear" && n < 1) return back(vr, "sms-consent", { n: n + 1 });
    await recordPhoneConsent(ctx, "transactional", answer === "yes" ? "opt_in" : "declined", phone);
    await updateSession(ctx.callSid, { data: { smsConsent: answer === "yes" ? "yes" : "no" } }, ctx.session);
    return back(vr, "finalize");
  },

  async finalize(ctx, vr) {
    const days = await callOrders(ctx);
    const data = ctx.session?.data ?? {};
    if (!days.length) {
      sp(vr, ctx, "cart_expired");
      return back(vr, "menu");
    }
    if (!data.name || !data.address) return back(vr, "ask", { f: !data.name ? "name" : "address" });
    if (termsActive() && !data.termsAccepted) return back(vr, "terms"); // off on live until the final Terms are in
    // No email in the booking (Abraham, Nov 17, 2026): it is asked only for a payment link by email (box 145)
    const caller = ctx.session?.fromNumber ?? ctx.from;
    const settings = await getSettings();
    // Delivery fee by the price map (Abraham, Nov 15, 2026); no price = never guessed
    const quote = await deliveryQuote(data.address, settings);
    if (!quote.ok) {
      sp(vr, ctx, "address_outside_area");
      return back(vr, "ask", { f: "address" });
    }
    const phone = data.phone || toE164(ctx.from);
    const customerId = await upsertCustomer(db, {
      name: data.name,
      phone,
      email: data.email ?? null,
      address: data.address,
    });
    // Offers need the customer (4th Sunday free counts their Sundays): attach, then the rentals totals again
    for (const o of days) {
      await db.update(orders).set({ customerId }).where(and(eq(orders.id, o.order.id), eq(orders.status, "HOLD")));
      await refreshOrderTotals(o.order.id);
    }
    const fresh = await db.select({ id: orders.id, subtotalCents: orders.subtotalCents, offerNote: orders.offerNote }).from(orders).where(inArray(orders.id, days.map((d) => d.order.id)));
    for (const o of days) {
      const f = fresh.find((x) => x.id === o.order.id);
      if (f) Object.assign(o.order, { subtotalCents: f.subtotalCents, offerNote: f.offerNote });
    }
    // Each rental day is its own delivery: its own delivery fee and tax. One charge pays for all of them.
    // The free delivery promo counts by each day's delivery date; a free 4th Sunday has its own delivery (Nov 17, 2026)
    const perDay = days.map((o) => ({ o, t: totalsWithFee(o.order.subtotalCents, quote.zone, quote.kind ? deliveryFeeFor(quote.kind, settings, o.order.eventDate, o.order.offerNote) : quote.feeCents, settings) }));
    const primary = days[0].order;
    for (const { o, t } of perDay) {
      await db
        .update(orders)
        .set({
          customerId,
          deliveryAddress: data.address,
          ...(data.directions ? { notes: sql`COALESCE(${orders.notes}, '') || ${`Delivery directions (from the caller): ${data.directions}. `}` } : {}),
          status: "PENDING_PAYMENT",
          holdExpiresAt: minutesFromNow(PAYMENT_HOLD_MINUTES),
          deliveryZone: t!.zone,
          deliveryFeeCents: t!.deliveryFeeCents,
          taxPercent: t!.taxPercent,
          taxCents: t!.taxCents,
          totalCents: t!.totalCents,
          paymentGroupId: days.length > 1 ? primary.id : null,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, o.order.id), eq(orders.status, "HOLD")));
    }
    await updateSession(ctx.callSid, { outcome: "checked_out" }, ctx.session);
    await track(ctx.callSid, "booking_finished", `Booking finished: order #${orderNumber(primary.id)}${days.length > 1 ? ` (${days.length} days)` : ""}`, { orderIds: days.map((x) => x.order.id), days: days.map((x) => x.order.eventDate) });
    const sum = (k: "subtotalCents" | "deliveryFeeCents" | "taxCents" | "totalCents") => perDay.reduce((n, x) => n + x.t![k], 0);
    const totals = { subtotalCents: sum("subtotalCents"), deliveryFeeCents: sum("deliveryFeeCents"), taxCents: sum("taxCents"), totalCents: sum("totalCents") };

    // Abraham, Nov 18, 2026: nothing before payment may sound finished. Only the total here; "You are all set" and the
    // order number come after Sola approves the payment (box 148). Payment-link callers get the number by text.
    sp(vr, ctx, "checkout_total", { total: spokenMoney(totals.totalCents), items: spokenMoney(totals.subtotalCents), delivery: spokenMoney(totals.deliveryFeeCents), tax: spokenMoney(totals.taxCents) });
    await updateSession(ctx.callSid, { data: { placedOrderId: primary.id } }, ctx.session);
    // Pay by card through Sola PhonePay (Abraham, Nov 14, 2026), the main phone payment. Off until he switches it on in
    // Admin, and then only on his own test calls until he opens it to everyone and approves its lines.
    // Card payment plan (Abraham, Nov 15, 2026): straight to the card, no payment link in this flow. The Owner picks
    // Sola PhonePay (the default) or Stripe in Admin; callers not offered a card get the payment link, as before.
    const payCfg = await getSettings();
    if (payCfg.phoneCardProvider === "stripe") {
      if (keypadPayFor(caller, stripePhonePayMode(process.env, payCfg), process.env, payCfg.paymentTestNumbers) && PAY_PROMPTS.every((k) => stripePhonePayMode(process.env, payCfg) !== "live" || !promptWaiting(ctx.prompts, k)))
        return back(vr, "pay-keypad", { o: primary.id });
    } else if (phonePayOffered(caller, payCfg) && !(await isPhonePayBlocked(callerPhoneOf(ctx))) && (payCfg.solaPhonePayOwnerOnly || PHONEPAY_PROMPTS.every((k) => !promptWaiting(ctx.prompts, k))))
      return back(vr, "phonepay-go", { o: primary.id, n: 1 });
    // Card on the phone not offered to this caller: the payment link, by text or email (box 141)
    return back(vr, "paylink", { o: primary.id });
  },

  /** Box 141: "To receive the payment link by text, press 1. To receive by email, press 2." */
  paylink(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    if (!o) return back(vr, "goodbye");
    const g = keypad(vr, url("paylink-choice", { o }));
    sp(g, ctx, "pay_link_how");
    return repeatMenu(vr, ctx, "paylink", { o });
  },

  async "paylink-choice"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    if (!o) return back(vr, "goodbye");
    const d = ctx.body.Digits;
    if (d === "1") {
      if (catalogTextReady()) return back(vr, "tx-which", { p: "pay", o });
      sp(vr, ctx, "catalog_text_not_yet"); // "Sorry, we cannot send it by text just yet. Let us send it by email instead."
      return back(vr, "catalog-email", { p: "pay", o });
    }
    if (d === "2") return back(vr, "catalog-email", { p: "pay", o });
    sp(vr, ctx, "not_valid");
    return back(vr, "paylink", { o });
  },

  /** Texts need the caller's OK for order texts first (the approved consent line); no means the email steps. */
  "pay-consent"(ctx, vr) {
    const o = ctx.query.get("o") ?? undefined;
    const g = keypad(vr, url("pay-consent-answer", { o, n: ctx.query.get("n") ?? undefined }), { timeout: 8 });
    sp(g, ctx, Number(ctx.query.get("n") || 0) > 0 ? "consent_unclear" : "consent_transactional");
    return back(vr, "pay-consent-answer", { o, n: ctx.query.get("n") ?? undefined });
  },

  async "pay-consent-answer"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const to = ctx.session?.data.txPhone;
    if (!o || !to) return back(vr, "paylink", { o: o || undefined });
    const n = Number(ctx.query.get("n") || 0);
    const answer = parseConsentAnswer({ digits: ctx.body.Digits, speech: ctx.body.SpeechResult, confidence: ctx.body.Confidence });
    if (answer === "unclear" && n < 1) {
      if (ctx.body.Digits) sp(vr, ctx, "not_valid");
      return back(vr, "pay-consent", { o, n: n + 1 });
    }
    await recordPhoneConsent(ctx, "transactional", answer === "yes" ? "opt_in" : "declined", to);
    await updateSession(ctx.callSid, { data: { smsConsent: answer === "yes" ? "yes" : "no" } }, ctx.session);
    if (answer !== "yes") return back(vr, "catalog-email", { p: "pay", o });
    return payTextTo(ctx, vr, o, to, true);
  },

  /* ---- Sola PhonePay (Abraham, Nov 14, 2026) ---- */

  /** "Press 1 to pay now by card. Press 2 to get a secure payment link instead." Nothing pressed = the link. */
  "pay-choice"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    if (!o) return back(vr, "goodbye");
    const g = keypad(vr, url("pay-choice-answer", { o }), { numDigits: 1, timeout: 8 });
    sp(g, ctx, "phonepay_choice", undefined, { draftOk: true });
    return back(vr, "pay-choice-answer", { o, none: 1 });
  },

  async "pay-choice-answer"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    if (!o) return back(vr, "goodbye");
    if (ctx.body.Digits === "1" && !ctx.query.get("none")) return back(vr, "phonepay-go", { o });
    if (ctx.body.Digits && !["1", "2"].includes(ctx.body.Digits)) {
      sp(vr, ctx, "not_valid");
      return back(vr, "pay-choice", { o });
    }
    return back(vr, "pay-done", { o }); // 2 or nothing: the secure payment link
  },

  /**
   * One card try (Abraham, Nov 15, 2026): hand the call to the payment subaccount, which dials Sola PhonePay and sends
   * the PIN, the exact order amount (from the order, never the caller) and 1 by itself. The caller only keys the card.
   * Star brings the caller back here at any time. Card tones never touch the main account.
   */
  async "phonepay-go"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const group = o ? await getPaymentGroup(o) : null;
    if (!group || group.due <= 0) return back(vr, "promo-consent");
    // Any Sola call from an earlier try is hung up first
    const earlier = await db.select().from(schema.phonepayAttempts).where(and(eq(schema.phonepayAttempts.callSid, ctx.callSid), eq(schema.phonepayAttempts.orderId, o)));
    // Box 140 (Abraham, Nov 17, 2026): card on the call is the default; 0 = a payment link (text or email) instead
    if (!earlier.length && ctx.query.get("c") !== "1") {
      const g = keypad(vr, url("phonepay-option", { o }), { numDigits: 1, timeout: 5 });
      sp(g, ctx, "pay_card_line");
      return back(vr, "phonepay-go", { o, c: 1 }); // no key: straight on to the payment line
    }
    for (const a of earlier) await (a.payLegSid?.startsWith("CA") ? Promise.all([endPayLeg(a.payLegSid), endMainPayLeg(a.payLegSid)]) : null);
    const n = earlier.length + 1;
    const limits = phonePayLimits(await getSettings());
    if (n > limits.triesPerCall) return back(vr, "phonepay-done", { o, a: 0 });
    // A blocked number gets the payment link instead (Abraham, Nov 17-18, 2026). A new call's first card try checks the
    // limit of calls with card tries per caller number in 24 hours (the line for a blocked number is not approved yet)
    if (await isPhonePayBlocked(callerPhoneOf(ctx))) return back(vr, "paylink", { o });
    if (!earlier.length && (await blockIfTooManyCalls(callerPhoneOf(ctx), ctx.callSid, limits.callsPerDay, `order #${orderNumber(o)}`))) {
      await track(ctx.callSid, "step", "Card payment by phone blocked for this number (too many calls with card tries in 24 hours)");
      return back(vr, "paylink", { o });
    }
    // The rentals stay held for the whole payment
    const waiting = group.orders.filter((d) => d.order.status === "PENDING_PAYMENT").map((d) => d.order.id);
    if (waiting.length) await db.update(orders).set({ holdExpiresAt: minutesFromNow(PAYMENT_HOLD_MINUTES), updatedAt: new Date() }).where(inArray(orders.id, waiting));
    // Never record card tones: pause a running call recording first (resumed when the caller comes back)
    if (ctx.session?.data.recording) {
      try {
        await pauseRecording(ctx.callSid);
      } catch {
        sp(vr, ctx, "phonepay_failed", undefined, { draftOk: true });
        vr.hangup();
        return vr;
      }
    }
    const attempt = await startAttempt(o, ctx.callSid, group.due);
    await db.update(schema.phonepayAttempts).set({ tryNumber: n, callerPhone: callerPhoneOf(ctx) }).where(eq(schema.phonepayAttempts.id, attempt.id));
    await track(ctx.callSid, "step", `Card payment try ${n} of ${limits.triesPerCall} started for order #${orderNumber(o)}`, { attempt: attempt.id });
    // Watch Sola every second while the call to Sola is up (no time limit, Abraham, Nov 18, 2026)
    await startPayWatch(attempt.id);
    // Box 140 already told the caller they are being connected; later tries keep the "please hold" line
    if (earlier.length) sp(vr, ctx, "phonepay_intro", undefined, { draftOk: true });
    // Straight from the hotline to Sola PhonePay (Abraham, Nov 17, 2026): PIN, the order amount (from the order, never
    // the caller) and 1, sent once PhonePay answers. Star brings the caller back at any time.
    const s = await getSettings();
    const digits = buildSendDigits(s.solaPhonePayDigits, { pin: process.env.SOLA_PHONEPAY_PIN ?? "", amountCents: group.due, orderNumber: orderNumber(o) });
    // Music while connecting (Abraham, Nov 17, 2026): when songs are chosen for the payment line, the caller waits with
    // them while a separate call enters the merchant code and amount, then joins the caller to Sola
    if ((await placeTracks("pay")).length && (await startPayLegWithMusic({ callerSid: ctx.callSid, number: s.solaPhonePayNumber, attemptId: attempt.id, baseUrl: config.baseUrl() }))) {
      vr.enqueue({ waitUrl: url("music", { place: "pay" }), waitUrlMethod: "POST", action: url("phonepay-done", { o, a: attempt.id }), method: "POST" }, payQueueName(ctx.callSid));
      return vr;
    }
    // Sola hang-up helper (option a, once the Owner turns it on after the real test call): Sola's voice is what we send
    // to the caller on this call
    if (s.solaListenOn) startSolaListen(vr, attempt.id, "outbound", s);
    phonePayDirectDial(vr, { number: s.solaPhonePayNumber, digits, action: url("phonepay-done", { o, a: attempt.id, ...(s.solaListenOn ? { ls: 1 } : {}) }), hangupOnStar: true });
    return vr;
  },

  /** The separate call to Sola (with music): enter the merchant code and amount, then join the waiting caller. */
  async "pay-leg"(ctx, vr) {
    const a = Number(ctx.query.get("a"));
    const [attempt] = a ? await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, a)).limit(1) : [];
    if (!attempt?.orderId) {
      vr.hangup();
      return vr;
    }
    const s = await getSettings();
    const digits = buildSendDigits(s.solaPhonePayDigits, { pin: process.env.SOLA_PHONEPAY_PIN ?? "", amountCents: attempt.amountCents, orderNumber: orderNumber(attempt.orderId) });
    // Sola hang-up helper (option a): on this call Sola is who answered, so Sola's voice is the incoming audio
    if (s.solaListenOn) startSolaListen(vr, a, "inbound", s);
    vr.play({ digits }); // the key tones go to Sola only; the caller is still on hold with the music
    const dial = vr.dial({ record: "do-not-record", timeLimit: 900 });
    dial.queue(payQueueName(attempt.callSid));
    return vr;
  },

  /** The call to Sola ended or never connected: if it never reached Sola, the waiting caller goes on (backup number). */
  async "pay-leg-status"(ctx, vr) {
    const a = Number(ctx.query.get("a"));
    const status = ctx.body.CallStatus ?? "";
    if (a && PHONEPAY_NOT_REACHED.includes(status)) {
      const [attempt] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, a)).limit(1);
      if (attempt?.orderId) {
        try {
          const { getTwilio } = await import("@/lib/twilio-client");
          await getTwilio()?.calls(attempt.callSid).update({ url: url("phonepay-done", { o: attempt.orderId, a, nr: 1 }), method: "POST" });
        } catch {
          /* the caller already left */
        }
      }
    }
    return vr;
  },

  /**
   * Box 148 (Abraham, Nov 18, 2026), only after Sola shows the payment approved: "You are all set, {name}! ... Your order
   * number is {number}. ... To send it to a different number, press 1. ..." No key: on with the call.
   */
  async "pay-approved"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const group = o ? await getPaymentGroup(o) : null;
    if (!group) return back(vr, "promo-consent");
    const first = (group.primary.customer?.name ?? "").trim().split(/\s+/)[0] ?? "";
    const g = keypad(vr, url("pay-approved-choice", { o }), { numDigits: 1, timeout: 6 });
    sp(g, ctx, "phonepay_approved", { name: first, number: spokenDigits(orderNumber(o)) });
    return back(vr, "promo-consent");
  },

  "pay-approved-choice"(ctx, vr) {
    const o = ctx.query.get("o") ?? undefined;
    if (ctx.body.Digits === "1") return back(vr, "tx-enter", { p: "conf", o }); // box 143, then the read-back
    if (ctx.body.Digits) sp(vr, ctx, "not_valid");
    return back(vr, "promo-consent");
  },

  /** Before the first card try: 0 = a payment link (box 141) instead; any other key = the shared line, then box 140 again. */
  async "phonepay-option"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    if (!o) return back(vr, "goodbye");
    if (ctx.body.Digits === "0") {
      await track(ctx.callSid, "step", `Asked for a payment link instead of the card (order #${orderNumber(o)})`);
      return back(vr, "paylink", { o });
    }
    if (ctx.body.Digits) {
      sp(vr, ctx, "not_valid");
      return back(vr, "phonepay-go", { o });
    }
    return back(vr, "phonepay-go", { o, c: 1 });
  },

  /** Back on our line (star, or Sola hung up): Sola call hung up for sure, then this try's charge is checked in Sola. */
  async "phonepay-done"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const a = Number(ctx.query.get("a"));
    if (ctx.session?.data.recording) await resumeRecording(ctx.callSid).catch(() => null);
    // The helper stops listening once the caller is back on our line (it never hears our own prompts)
    const listening = ctx.query.get("ls") === "1";
    if (a && listening) vr.stop().stream({ name: `sola-${a}` });
    const group = o ? await getPaymentGroup(o) : null;
    if (!group) return back(vr, "goodbye");
    if (group.due <= 0) return back(vr, "pay-approved", { o });
    let n = await triesSoFar(ctx.callSid, o);
    // PhonePay never answered: the backup number once, on the same card try (no "try" is used up)
    const status = ctx.body.DialCallStatus ?? "";
    if (a && (PHONEPAY_NOT_REACHED.includes(status) || ctx.query.get("nr") === "1") && ctx.query.get("b") !== "1") {
      await track(ctx.callSid, "step", `Payment line did not answer (${status}); trying the backup number`, { attempt: a });
      const s = await getSettings();
      const digits = buildSendDigits(s.solaPhonePayDigits, { pin: process.env.SOLA_PHONEPAY_PIN ?? "", amountCents: group.due, orderNumber: orderNumber(o) });
      if (s.solaListenOn) startSolaListen(vr, a, "outbound", s); // a new stream for the backup number
      phonePayDirectDial(vr, { number: s.solaPhonePayBackup, digits, action: url("phonepay-done", { o, a, b: 1, ...(s.solaListenOn ? { ls: 1 } : {}) }), hangupOnStar: true });
      return vr;
    }
    if (a) {
      if (ctx.body.DialCallSid) await db.update(schema.phonepayAttempts).set({ payLegSid: ctx.body.DialCallSid }).where(eq(schema.phonepayAttempts.id, a));
      const [attempt] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, a)).limit(1);
      await endMainPayLeg(attempt?.payLegSid);
      sp(vr, ctx, "phonepay_back", undefined, { draftOk: true });
      const r = await checkPhonePayTry(o, a, attempt?.amountCents ?? group.due);
      await track(ctx.callSid, "step", `Card payment try ${attempt?.tryNumber ?? n}: ${r.result === "paid" ? "paid" : r.result === "wrong_amount" ? "wrong amount, voided" : r.result === "check_failed" ? "Sola could not be checked" : r.result === "unclear" ? "could not be confirmed (box 147)" : "no charge"}`, { attempt: a });
      if (r.result === "paid") return back(vr, "pay-approved", { o });
      n = attempt?.tryNumber ?? n;
      // Box 147 (Abraham, Nov 18, 2026): not certain which charge is this caller's: "Sorry, we could not confirm your
      // payment. To try again, press 1."
      if (r.result === "unclear") return back(vr, "phonepay-retry", { o, n, u: 1 });
      // Silence check (Abraham, Nov 18, 2026): 20 seconds with no Sola voice, no keys and no result in Sola's record, and
      // still none on the last look = the same box 147 line
      if (attempt?.solaSeen === "silence") return back(vr, "phonepay-retry", { o, n, u: 1 });
    }
    return back(vr, "phonepay-retry", { o, n });
  },

  /** Try again: a menu on our line, never on Sola's. Tries 1 to 4, try 5 (last chance, Owner emailed), try 6 (call ends). */
  async "phonepay-retry"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const n = Number(ctx.query.get("n") || 1);
    const asked = Number(ctx.query.get("r") || 0);
    const num = orderNumber(o);
    const due = (await getPaymentGroup(o))?.due ?? 0;
    const tellOwner = async (subject: string, text: string) => {
      const to = config.adminEmail();
      if (to) await sendEmail(to, subject, `${text}\n\n${config.baseUrl()}/admin/orders/${o}`).catch(() => null);
    };
    const max = phonePayLimits(await getSettings()).triesPerCall;
    if (n >= max) {
      if (!asked) await tellOwner(`Hup Up Attractions: phone card payment failed ${max} times, order #${num}`, `The caller tried to pay order #${num} ($${(due / 100).toFixed(2)}) by card ${max} times on the phone and it did not go through. The call ended and the caller was asked to call back. The order is still Payment pending.`);
      sp(vr, ctx, "phonepay_failed", undefined, { draftOk: true });
      vr.hangup();
      return vr;
    }
    if (n === max - 1 && max > 1 && !asked)
      await tellOwner(`Hup Up Attractions: phone card payment failed ${max - 1} times, order #${num}`, `The caller tried to pay order #${num} ($${(due / 100).toFixed(2)}) by card ${max - 1} times on the phone and it did not go through. They have one more try.`);
    if (asked >= 2) {
      // No key after the menu twice: the call ends with the same line as the sixth try
      sp(vr, ctx, "phonepay_failed", undefined, { draftOk: true });
      vr.hangup();
      return vr;
    }
    const unclear = ctx.query.get("u") === "1";
    const g = keypad(vr, url("phonepay-retry-answer", { o, n, r: asked, ...(unclear ? { u: 1 } : {}) }), { numDigits: 1, timeout: 8 });
    sp(g, ctx, unclear ? "phonepay_unclear" : n === max - 1 ? "phonepay_retry_last" : "phonepay_retry", undefined, { draftOk: true });
    return back(vr, "phonepay-retry", { o, n, r: asked + 1, ...(unclear ? { u: 1 } : {}) });
  },

  "phonepay-retry-answer"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const n = Number(ctx.query.get("n") || 1);
    if (ctx.body.Digits === "1") return back(vr, "phonepay-go", { o });
    if (ctx.body.Digits) sp(vr, ctx, "not_valid"); // wrong key: the shared line, then the same question again
    return back(vr, "phonepay-retry", { o, n, r: Number(ctx.query.get("r") || 0) + 1, ...(ctx.query.get("u") === "1" ? { u: 1 } : {}) });
  },

  /** Hand the call to the payment subaccount (Twilio Pay + Stripe). The main account never collects card digits. */
  async "pay-keypad"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    if (!o) return back(vr, "goodbye");
    // The rentals stay held for the whole payment (a fresh hold now; each try in the payment line renews it)
    const group = await getPaymentGroup(o);
    const waiting = group?.orders.filter((d) => d.order.status === "PENDING_PAYMENT").map((d) => d.order.id) ?? [];
    if (waiting.length) await db.update(orders).set({ holdExpiresAt: minutesFromNow(PAYMENT_HOLD_MINUTES), updatedAt: new Date() }).where(inArray(orders.id, waiting));
    sp(vr, ctx, "pay_start", undefined, { draftOk: true });
    const dial = vr.dial({ action: url("pay-done", { o }), method: "POST", timeLimit: 900, answerOnBridge: true });
    dial.sip({ username: process.env.TWILIO_PAY_SIP_USERNAME, password: process.env.TWILIO_PAY_SIP_PASSWORD }, paySipUri(o, ctx.callSid));
    return vr;
  },

  /** Back from the payment line: paid, then on as usual; not paid (declined, chose the link, hung up), the link. */
  async "pay-done"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const group = o ? await getPaymentGroup(o) : null;
    if (!group) return back(vr, "goodbye");
    if (group.due > 0) return back(vr, "paylink", { o }); // not paid: the payment link, text or email (box 141)
    return back(vr, "promo-consent");
  },

  /*
   * Promo texts by phone, keys only (Abraham, Nov 10, 2026). Step 1 after the order: press 1 for promo texts, pound
   * (or nothing) skips. Step 2: the number you're calling from (1) or a different one (2). Step 3: type the 10-digit
   * mobile number, hear it read back, press 1 to confirm. Then the approved confirmation text goes to the chosen
   * number; only a YES from that number within 24 hours signs it up. Who hears it: PHONE_PROMO_MODE.
   */
  async "promo-consent"(ctx, vr) {
    const mode = phonePromoMode();
    if (!phonePromoOn(ctx.from, mode)) return back(vr, "goodbye");
    if (mode === "live") {
      const caller = toE164(ctx.from);
      if (caller && !shouldAskMarketing(await consentState(caller), await customerByPhone(caller))) return back(vr, "goodbye");
    }
    const g = keypad(vr, url("promo-consent-answer"), { numDigits: 1, timeout: 6 });
    sp(g, ctx, "promo_ask");
    return back(vr, "promo-consent-answer"); // nothing pressed = skip
  },

  async "promo-consent-answer"(ctx, vr) {
    if (ctx.body.Digits === "1") return back(vr, "promo-which");
    if (ctx.body.Digits && ctx.body.Digits !== "2" && ctx.body.Digits !== "#") {
      sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      return back(vr, "promo-consent");
    }
    const caller = toE164(ctx.from);
    if (caller) await recordPhoneConsent(ctx, "marketing", "declined", caller, "promo_ask");
    return back(vr, "goodbye");
  },

  "promo-which"(ctx, vr) {
    const g = keypad(vr, url("promo-which-answer"), { numDigits: 1, timeout: 6 });
    sp(g, ctx, "promo_which");
    return back(vr, "goodbye"); // nothing pressed: skip and end the call normally
  },

  async "promo-which-answer"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") {
      const caller = toE164(ctx.from);
      if (!caller) return back(vr, "promo-enter"); // caller ID withheld: type the number instead
      return promoSend(ctx, vr, caller, "caller");
    }
    if (d === "2") return back(vr, "promo-enter");
    if (d) {
      sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      return back(vr, "promo-which");
    }
    return back(vr, "goodbye");
  },

  "promo-enter"(ctx, vr) {
    const tries = Number(ctx.query.get("t") || 0);
    const g = keypad(vr, url("promo-heard", { t: tries }), { numDigits: 10, timeout: 10, finishOnKey: "#" });
    sp(g, ctx, "text_enter"); // box 143, the same line in every flow that texts the caller
    vr.redirect({ method: "POST" }, url("promo-heard", { t: tries })); // nothing typed counts as a try
    return vr;
  },

  async "promo-heard"(ctx, vr) {
    const tries = Number(ctx.query.get("t") || 0);
    const e164 = tenDigitNumber(ctx.body.Digits);
    if (!e164) {
      if (tries + 1 >= 2) return back(vr, "goodbye"); // two tries that didn't work: skip
      sp(vr, ctx, "promo_bad");
      return back(vr, "promo-enter", { t: tries + 1 });
    }
    await updateSession(ctx.callSid, { data: { promoHeard: e164 } }, ctx.session);
    const g = keypad(vr, url("promo-confirm"), { numDigits: 1, timeout: 6 });
    sp(g, ctx, "text_heard", { number: readBack(e164) }); // box 144: 1 correct, 2 a different number
    return back(vr, "goodbye");
  },

  async "promo-confirm"(ctx, vr) {
    const heard = ctx.session?.data.promoHeard;
    if (ctx.body.Digits === "1" && heard) {
      await updateSession(ctx.callSid, { data: { promoHeard: undefined } }, ctx.session);
      return promoSend(ctx, vr, heard, "entered");
    }
    if (ctx.body.Digits === "2") return back(vr, "promo-enter");
    if (ctx.body.Digits && heard) {
      sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      const g = keypad(vr, url("promo-confirm"), { numDigits: 1, timeout: 6 });
      sp(g, ctx, "text_heard", { number: readBack(heard) });
    }
    return back(vr, "goodbye");
  },

  async goodbye(ctx, vr) {
    const id = ctx.session?.data.placedOrderId;
    const full = id ? await getOrderWithItems(id) : null;
    const several = full?.order.paymentGroupId ? (await db.select({ id: orders.id }).from(orders).where(eq(orders.paymentGroupId, full.order.paymentGroupId))).length > 1 : false;
    if (full && several) sp(vr, ctx, "goodbye_order_days");
    else if (full) sp(vr, ctx, "goodbye_order", { date: spokenDate(full.order.eventDate), pickup: spokenDate(full.order.pickupDate) });
    vr.hangup();
    return vr;
  },

  /**
   * Ring a live employee for main-menu key k (2, 4, 5, 6, 8 or 0), using that key's list from Settings (an empty list
   * rings the operator list). Each person must press 1 to take the call. Office closed or no one to ring: Abraham's
   * missed-call line, then the general voicemail.
   */
  async ring(ctx, vr) {
    const k = (RING_KEYS as readonly string[]).includes(ctx.query.get("k") ?? "") ? (ctx.query.get("k") as RingKey) : "0";
    const settings = await getSettings();
    const list = ringListFor(settings, k);
    if (!list.targets.length || !(await lineRingsNowFor(k, settings))) {
      await updateSession(ctx.callSid, { data: { missed: "closed" } }, ctx.session); // dashboard: missed call
      return back(vr, "voicemail", { x: k }); // the extension's own box, with the approved greeting
    }
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "forwarded" }, ctx.session);
    sp(vr, ctx, "transfer_connecting");
    return dialTargets(vr, list, k, 0, ctx.session?.fromNumber ?? ctx.from);
  },

  /**
   * Key 7 (Abraham, Nov 9, 2026): our hours, built from the same Admin settings as the website (Business hours &
   * holidays), word for word as Abraham approved them for the website; dashes are read as "to". If the office is closed
   * right now, the approved "office closed" line plays first. Then the main menu again.
   */
  async hours(ctx, vr) {
    const settings = await getSettings();
    const open = officeOpenNow(new Date(), settings);
    await track(ctx.callSid, "step", open ? "Office open" : "Office closed", { open, key: "7" });
    if (!open) {
      sp(vr, ctx, "office_closed");
      shortPause(vr);
    }
    for (const line of hoursForSpeech(settings)) say(vr, line);
    shortPause(vr);
    return back(vr, "menu");
  },

  /** Older links and voice commands ("operator"): same as key 0. */
  async operator(ctx, vr) {
    return back(vr, "ring", { k: "0" });
  },

  /** After a ring attempt: a finished conversation ends the call; otherwise try the next number, then voicemail. */
  async "operator-done"(ctx, vr) {
    const k = (RING_KEYS as readonly string[]).includes(ctx.query.get("k") ?? "") ? (ctx.query.get("k") as RingKey) : "0";
    // Abraham, Nov 14, 2026, every line: staff pressed 2 = pass the call on to the next number or round, exactly like
    // no answer; voicemail only after the last round. Checked first: Twilio may report that leg as completed.
    const rejectedAt = ctx.session?.data.rejectedAt;
    const rejected = Boolean(rejectedAt && Date.now() - rejectedAt < 10 * 60_000);
    if (rejected) await updateSession(ctx.callSid, { data: { rejectedAt: undefined } }, ctx.session);
    if (!rejected && ctx.body.DialCallStatus === "completed") {
      vr.hangup();
      return vr;
    }
    const settings = await getSettings();
    const list = ringListFor(settings, k);
    const next = Number(ctx.query.get("i") ?? -1) + 1;
    const steps = (list.mode === "simultaneous" ? 1 : list.targets.length) * ringAttempts(settings, k);
    if (next > 0 && next < steps && (await lineRingsNowFor(k, settings))) return dialTargets(vr, list, k, next, ctx.session?.fromNumber ?? ctx.from);
    // Abraham's missed-call line, then straight to the voicemail beep
    await updateSession(ctx.callSid, { data: { missed: rejected ? "rejected" : "no_answer" } }, ctx.session); // dashboard: missed call
    return back(vr, "voicemail", { x: k }); // passed (2) or no answer on every number and round: the extension's voicemail
  },

  /**
   * Plays only to the staff member who answered; the caller keeps hearing ringing meanwhile. Abraham's approved
   * announcement with the extension number and its name from Admin: press 1 to take the call, 2 to pass it on.
   */
  async whisper(ctx, vr) {
    const settings = await getSettings();
    const k = (RING_KEYS as readonly string[]).includes(ctx.query.get("k") ?? "") ? (ctx.query.get("k") as RingKey) : "0";
    const text = staffAnnouncement(k, extensionName(settings, k), settings[`ringAnnounce${k}`], {
      withNumber: promptText(ctx.prompts, "staff_whisper"),
      noNumber: promptText(ctx.prompts, "staff_whisper_no_number"),
    });
    const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 8, action: url("whisper-accept"), method: "POST" });
    say(g, text);
    const again = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 6, action: url("whisper-accept"), method: "POST" });
    say(again, text);
    vr.hangup(); // no answer from the staff member (or their voicemail): this leg ends and routing moves on
    return vr;
  },

  async "whisper-accept"(ctx, vr) {
    if (ctx.body.Digits === "1") return vr; // empty response = connect the caller
    // Abraham (Nov 14, 2026): press 2 passes the call on to the next number or round (voicemail only after the last
    // round). Marked on the caller's call, so the next step moves on whatever Twilio reports for this leg.
    const parent = ctx.body.ParentCallSid;
    if (ctx.body.Digits === "2" && parent) {
      const s = await getSession(parent);
      if (s) await updateSession(parent, { data: { rejectedAt: Date.now() } }, s);
    }
    vr.hangup();
    return vr;
  },

  async "voicemail-offer"(ctx, vr) {
    if (ctx.body.Digits === "1") return back(vr, "voicemail");
    return back(vr, "menu");
  },

  /**
   * Voicemail (Abraham, Nov 11, 2026), every box: the approved greeting, the tone, then recording. The caller hangs
   * up or presses # to finish. Extension keys use their own box (x = the key); key 0, 9 and the rest use Main.
   */
  async voicemail(ctx, vr) {
    const x = ctx.query.get("x");
    const box = await vmBox(x);
    if (!box.enabled) {
      sp(vr, ctx, "operator_unavailable");
      return back(vr, "menu");
    }
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "voicemail", data: { vmEntry: x ?? undefined } }, ctx.session);
    if (vmAccessActive() && x === "9") {
      // Staff access, general voicemail only (Abraham, Nov 15, 2026): star 7 4 while the greeting plays, no pause of
      // 3 seconds or more between keys. Never announced; any other key just records.
      const g = vr.gather({ input: ["dtmf"], numDigits: VM_ACCESS_KEYS.length, timeout: VM_ACCESS_KEY_GAP, finishOnKey: "", action: url("vm-greeting-key", { x: x ?? undefined }), method: "POST" });
      sp(g, ctx, await vmGreeting(x, ctx.prompts));
      return vmRecord(vr, box, x);
    }
    sp(vr, ctx, await vmGreeting(x, ctx.prompts));
    return vmRecord(vr, box, x);
  },

  /** A key during the greeting: 7 4 = staff access; anything else goes straight to the tone (as if the greeting ended). */
  async "vm-greeting-key"(ctx, vr) {
    const x = ctx.query.get("x");
    const d = ctx.body.Digits ?? "";
    if (d === VM_ACCESS_KEYS && x === "9" && vmAccessActive()) return back(vr, "vma-pin");
    // Star and then the wrong keys (Abraham, Nov 16, 2026): the shared wrong-key line, then the voicemail as usual
    if (d.startsWith("*")) sp(vr, ctx, "not_valid");
    return vmRecord(vr, await vmBox(x), x);
  },

  /* ---- Staff voicemail access by phone (Abraham, Nov 13, 2026; preview only; every line a draft) ---- */

  async "vma-pin"(ctx, vr) {
    if (!vmAccessActive()) return back(vr, "menu");
    const from = ctx.session?.fromNumber ?? ctx.from;
    if (await vmLockedUntil()) {
      await logVmAccess(ctx.callSid, from, "refused_locked");
      sp(vr, ctx, "vma_locked", undefined, { draftOk: true });
      vr.hangup();
      return vr;
    }
    // No password set yet: the default 1234 works (Abraham, Nov 16, 2026), so there is no "no password" refusal
    const t = Number(ctx.query.get("t") || 0);
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 10, action: url("vma-pin-check", { t }), method: "POST" });
    sp(g, ctx, "vma_pin");
    vr.hangup(); // no password entered
    return vr;
  },

  async "vma-pin-check"(ctx, vr) {
    if (!vmAccessActive()) return back(vr, "menu");
    const from = ctx.session?.fromNumber ?? ctx.from;
    if (await vmLockedUntil()) {
      await logVmAccess(ctx.callSid, from, "refused_locked");
      sp(vr, ctx, "vma_locked", undefined, { draftOk: true });
      vr.hangup();
      return vr;
    }
    if (await checkVmPin(ctx.body.Digits || "")) {
      await logVmAccess(ctx.callSid, from, "ok");
      await updateSession(ctx.callSid, { data: { vmaOk: 1 } }, ctx.session);
      return back(vr, "vma-box");
    }
    await logVmAccess(ctx.callSid, from, "wrong_pin");
    const t = Number(ctx.query.get("t") || 0) + 1;
    if (t >= VM_PIN_TRIES) {
      await lockVmAccess(ctx.callSid, from);
      sp(vr, ctx, "vma_locked", undefined, { draftOk: true });
      vr.hangup();
      return vr;
    }
    sp(vr, ctx, "vma_wrong", undefined, { draftOk: true });
    return back(vr, "vma-pin", { t });
  },

  async "vma-box"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const n = Number(ctx.query.get("n") || 0);
    if (n >= 3) {
      vr.hangup();
      return vr;
    }
    const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 8, finishOnKey: "", action: url("vma-box-choice"), method: "POST" });
    spCallOut(g, ctx, "vma_box", "To call a customer, press 0.");
    return back(vr, "vma-box", { n: n + 1 });
  },

  async "vma-box-choice"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    if (ctx.body.Digits === "0" && callOutActive()) return back(vr, "vma-out"); // call a customer out (off on live for now)
    if (ctx.body.Digits === "*") return back(vr, "vma-newpin"); // change the password (Abraham, Nov 15, 2026)
    if (ctx.body.Digits === "7") return back(vr, "vma-charge"); // Owner custom charge through Sola PhonePay (Nov 14, 2026)
    const key = BOX_BY_NUMBER[ctx.body.Digits ?? ""];
    if (!key) {
      sp(vr, ctx, "not_valid");
      return back(vr, "vma-box");
    }
    const box = await vmBox(key);
    const list = await vmaMessages(box.id);
    if (!list.length) {
      sp(vr, ctx, "vma_none", undefined, { draftOk: true });
      return back(vr, "vma-box");
    }
    sp(vr, ctx, "vma_count", { count: list.length }, { draftOk: true });
    return back(vr, "vma-play", { b: box.id, i: 0 });
  },

  async "vma-play"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const b = Number(ctx.query.get("b"));
    const i = Math.max(0, Number(ctx.query.get("i") || 0));
    const list = await vmaMessages(b);
    const v = list[i];
    if (!v) {
      const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 8, finishOnKey: "", action: url("vma-box"), method: "POST" });
      sp(g, ctx, "vma_end", undefined, { draftOk: true });
      vr.hangup();
      return vr;
    }
    const when = vmaWhen(v.createdAt);
    sp(vr, ctx, "vma_message", { n: i + 1, number: v.fromNumber ? readBack(v.fromNumber) : "a withheld number", date: when.date, time: when.time }, { draftOk: true });
    vr.play(voicemailPlayLink(v.id, 1));
    return back(vr, "vma-options", { b, i, v: v.id });
  },

  "vma-options"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const p = { b: ctx.query.get("b") ?? undefined, i: ctx.query.get("i") ?? undefined, v: ctx.query.get("v") ?? undefined };
    const n = Number(ctx.query.get("n") || 0);
    if (n >= 3) {
      vr.hangup();
      return vr;
    }
    const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 8, finishOnKey: "", action: url("vma-choice", p), method: "POST" });
    spCallOut(g, ctx, "vma_options", "To call this person back, press 4.");
    return back(vr, "vma-options", { ...p, n: n + 1 });
  },

  async "vma-choice"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const b = Number(ctx.query.get("b"));
    const i = Number(ctx.query.get("i") || 0);
    const id = Number(ctx.query.get("v"));
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "vma-play", { b, i });
    if (d === "2") return back(vr, "vma-play", { b, i: i + 1 });
    if (d === "*") return back(vr, "vma-box");
    const [v] = Number.isInteger(id) ? await db.select().from(schema.voicemails).where(and(eq(schema.voicemails.id, id), eq(schema.voicemails.boxId, b))).limit(1) : [];
    if (d === "3" && v) {
      await db.update(schema.voicemails).set({ heardAt: new Date() }).where(eq(schema.voicemails.id, v.id));
      await track(ctx.callSid, "vm_access", `Voicemail marked as heard by phone (message ${v.id})`, { voicemailId: v.id });
      sp(vr, ctx, "vma_heard", undefined, { draftOk: true });
      return back(vr, "vma-options", { b, i, v: v.id });
    }
    if (d === "4" && v && callOutActive()) {
      const to = callbackNumber(v.fromNumber);
      if (!to) {
        sp(vr, ctx, "vma_no_number", undefined, { draftOk: true });
        return back(vr, "vma-options", { b, i, v: v.id });
      }
      await track(ctx.callSid, "vm_access", `Called back ${to} from voicemail by phone (message ${v.id})`, { voicemailId: v.id, to });
      sp(vr, ctx, "vma_calling", undefined, { draftOk: true });
      // Shows (845) 777-7585; after the call, back to this message's options
      vr.dial({ callerId: CALLBACK_CALLER_ID, action: url("vma-options", { b, i, v: v.id }), method: "POST", timeout: 30 }, to);
      return vr;
    }
    sp(vr, ctx, "not_valid");
    return back(vr, "vma-options", { b, i, v: ctx.query.get("v") ?? undefined });
  },

  /** Change the password by phone (Abraham, Nov 15, 2026): new password twice, then the Owner is emailed. */
  "vma-newpin"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 10, action: url("vma-newpin-again"), method: "POST" });
    sp(g, ctx, "vma_newpin", undefined, { draftOk: true });
    return back(vr, "vma-box");
  },

  async "vma-newpin-again"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const pin = ctx.body.Digits || "";
    if (!validPin(pin)) {
      sp(vr, ctx, "vma_newpin_bad", undefined, { draftOk: true });
      return back(vr, "vma-newpin");
    }
    // only a scrambled (hashed) copy is kept between the two entries
    await updateSession(ctx.callSid, { data: { vmaNewPin: await bcrypt.hash(pin, 8) } }, ctx.session);
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 10, action: url("vma-newpin-save"), method: "POST" });
    sp(g, ctx, "vma_newpin_again", undefined, { draftOk: true });
    return back(vr, "vma-box");
  },

  async "vma-newpin-save"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const first = ctx.session?.data.vmaNewPin;
    const pin = ctx.body.Digits || "";
    await updateSession(ctx.callSid, { data: { vmaNewPin: undefined } }, ctx.session);
    if (!first || !validPin(pin) || !(await bcrypt.compare(pin, first))) {
      sp(vr, ctx, "vma_newpin_bad", undefined, { draftOk: true });
      return back(vr, "vma-newpin");
    }
    await vmPinChangedByPhone(ctx.callSid, ctx.session?.fromNumber ?? ctx.from, pin);
    await track(ctx.callSid, "vm_access", "Voicemail password changed by phone", {});
    sp(vr, ctx, "vma_newpin_saved", undefined, { draftOk: true });
    return back(vr, "vma-box");
  },

  /* ---- Owner custom charge through Sola PhonePay (Abraham, Nov 14, 2026); only after the voicemail password ---- */

  async "vma-charge"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const settings = await getSettings();
    if (!phonePayOffered(ctx.session?.fromNumber ?? ctx.from, { ...settings, solaPhonePayOwnerOnly: false })) {
      sp(vr, ctx, "not_valid"); // PhonePay is switched off (or not set up): this key does nothing
      return back(vr, "vma-box");
    }
    const t = Number(ctx.query.get("t") || 0);
    if (t >= 3) {
      sp(vr, ctx, "vma_charge_back", undefined, { draftOk: true });
      return back(vr, "vma-box");
    }
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 12, action: url("vma-charge-amount", { t }), method: "POST" });
    sp(g, ctx, "vma_charge_amount", undefined, { draftOk: true });
    return back(vr, "vma-charge", { t: t + 1 });
  },

  async "vma-charge-amount"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const t = Number(ctx.query.get("t") || 0);
    const cents = parseCustomAmount(ctx.body.Digits, Number((await getSettings()).solaPhonePayCustomCapCents) || 500000);
    if (!cents) {
      sp(vr, ctx, "vma_charge_bad", undefined, { draftOk: true });
      return back(vr, "vma-charge", { t: t + 1 });
    }
    const g = keypad(vr, url("vma-charge-confirm", { c: cents, t }), { numDigits: 1, timeout: 8 });
    sp(g, ctx, "vma_charge_readback", amountParts(cents), { draftOk: true });
    // No key: the same amount is read back again, never a new amount (Abraham, Nov 18, 2026)
    return back(vr, "vma-charge-confirm", { c: cents, t, r: 1 });
  },

  "vma-charge-confirm"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const c = Number(ctx.query.get("c"));
    const t = Number(ctx.query.get("t") || 0);
    const cd = ctx.body.Digits;
    // Abraham, Nov 18, 2026: only 2 starts the amount over; a wrong key or no key reads the same amount back again
    // (up to 3 times, then back to the voicemail menu), so the amount is never typed again by accident
    const r = Number(ctx.query.get("r") || 0);
    if (c && cd !== "1" && cd !== "2") {
      if (!cd && r >= 3) return back(vr, "vma-box");
      if (cd) sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      const g = keypad(vr, url("vma-charge-confirm", { c, t }), { numDigits: 1, timeout: 8 });
      sp(g, ctx, "vma_charge_readback", amountParts(c), { draftOk: true });
      return back(vr, "vma-charge-confirm", { c, t, r: r + 1 });
    }
    if (cd !== "1") return back(vr, "vma-charge", { t });
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 10, action: url("vma-charge-go", { c }), method: "POST", actionOnEmptyResult: true });
    sp(g, ctx, "vma_charge_note", undefined, { draftOk: true });
    return back(vr, "vma-charge-go", { c });
  },

  async "vma-charge-go"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const c = Number(ctx.query.get("c"));
    if (!c) return back(vr, "vma-box");
    // An order number is attached only if it is a real order
    const typed = (ctx.body.Digits || "").replace(/\D/g, "");
    const id = typed ? Number(typed) - 1000 : 0;
    const [order] = id > 0 ? await db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).limit(1) : [];
    if (ctx.session?.data.recording) {
      try {
        await pauseRecording(ctx.callSid);
      } catch {
        sp(vr, ctx, "vma_charge_back", undefined, { draftOk: true });
        return back(vr, "vma-box");
      }
    }
    const attempt = await startAttempt(order?.id ?? null, ctx.callSid, c, "custom");
    await track(ctx.callSid, "vm_access", `Owner custom charge started: $${(c / 100).toFixed(2)}${order ? ` for order #${orderNumber(order.id)}` : ""}`, { attempt: attempt.id });
    sp(vr, ctx, "phonepay_intro", undefined, { draftOk: true });
    const s = await getSettings();
    const digits = buildSendDigits(s.solaPhonePayCustomDigits, { pin: process.env.SOLA_PHONEPAY_PIN ?? "", amountCents: c, orderNumber: order ? orderNumber(order.id) : "" });
    phonePayDirectDial(vr, { number: s.solaPhonePayNumber, digits, action: url("vma-charge-done", { a: attempt.id, c, o: order?.id ?? 0 }) });
    return vr;
  },

  async "vma-charge-done"(ctx, vr) {
    if (ctx.session?.data.recording) await resumeRecording(ctx.callSid).catch(() => null);
    const a = Number(ctx.query.get("a"));
    const c = Number(ctx.query.get("c"));
    const o = Number(ctx.query.get("o")) || null;
    if (a && c) await matchCustomCharge(a, c, o, { madeBy: await customChargeMadeBy(ctx.session?.fromNumber ?? ctx.from) });
    sp(vr, ctx, "vma_charge_back", undefined, { draftOk: true });
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    return back(vr, "vma-box");
  },

  /** Call a customer out (Abraham, Nov 15, 2026): the number, then pound; the customer sees (845) 777-7585. */
  "vma-out"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    if (!callOutActive()) return back(vr, "vma-box");
    const n = Number(ctx.query.get("n") || 0);
    if (n >= 3) return back(vr, "vma-box");
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 10, action: url("vma-out-dial"), method: "POST" });
    sp(g, ctx, "vma_out_enter");
    return back(vr, "vma-out", { n: n + 1 });
  },

  async "vma-out-dial"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    if (!callOutActive()) return back(vr, "vma-box");
    const to = callOutNumber(ctx.body.Digits);
    if (!to) {
      sp(vr, ctx, "vma_out_bad");
      return back(vr, "vma-out");
    }
    await track(ctx.callSid, "vm_access", `Called out to ${to} from voicemail by phone`, { to });
    // Shows (845) 777-7585; after the call, back to the box menu
    vr.dial({ callerId: CALLBACK_CALLER_ID, action: url("vma-box"), method: "POST", timeout: 30 }, to);
    return vr;
  },

  /**
   * The Record action: the caller pressed #, stayed silent, or hung up. Hung up = sent as is. # = the review menu;
   * nothing is sent until they press 1 (or hang up). Nothing recorded = no confirmation, ever.
   */
  async "vm-recorded"(ctx, vr) {
    const b = ctx.body;
    const box = await boxById(Number(ctx.query.get("b")) || null);
    const x = ctx.query.get("x");
    const hungUp = b.Digits === "hangup";
    const has = Boolean(b.RecordingSid && b.RecordingUrl) && Number(b.RecordingDuration || 0) >= 1;
    if (!has) {
      if (hungUp) return vr;
      return back(vr, "vm-none", { b: box.id, x: x ?? undefined }); // never the confirmation
    }
    // Pressing 3 replaced the earlier take
    const previous = ctx.session?.data.vmSid;
    if (previous && previous !== b.RecordingSid) await setRecordingState(previous, "replaced");
    await recordingFinished({
      boxId: box.id,
      callSid: ctx.callSid,
      from: ctx.session?.fromNumber ?? ctx.from,
      recordingSid: b.RecordingSid!,
      recordingUrl: b.RecordingUrl!,
      durationSec: Number(b.RecordingDuration || 0),
      transcribe: ctx.query.get("t") === "1",
      state: hungUp ? "submitted" : "reviewing",
    });
    await updateSession(ctx.callSid, { data: { vmSid: b.RecordingSid, vmUrl: b.RecordingUrl, vmBox: box.id, vmKey: x ?? undefined, leftMessage: true } }, ctx.session);
    if (hungUp) return vr;
    return back(vr, "vm-options");
  },

  /**
   * "Thank you! To send your message, press 1. To listen to it, press 2. To delete and re-record, press 3."
   * Abraham: repeats until the caller presses a valid key or hangs up (hanging up keeps the message).
   */
  "vm-options"(ctx, vr) {
    const g = keypad(vr, url("vm-option"), { numDigits: 1, timeout: 6 });
    sp(g, ctx, "vm_options");
    repeatMenu(vr, ctx, "vm-options"); // 3 plays and 20 seconds, then the call ends (the message is kept)
    return vr;
  },

  /** Nothing was recorded (Abraham): "We didn't receive a message. To try again, press 3. Otherwise, you may hang up." */
  "vm-none"(ctx, vr) {
    const b = ctx.query.get("b") ?? undefined;
    const x = ctx.query.get("x") ?? undefined;
    const g = keypad(vr, url("vm-none-choice", { b, x }), { numDigits: 1, timeout: 6 });
    sp(g, ctx, "vm_none_retry");
    repeatMenu(vr, ctx, "vm-none", { b, x });
    return vr;
  },

  async "vm-none-choice"(ctx, vr) {
    const b = ctx.query.get("b") ?? undefined;
    const x = ctx.query.get("x") ?? undefined;
    if (ctx.body.Digits === "3") {
      sp(vr, ctx, "vm_rerecord");
      return vmRecord(vr, await boxById(Number(b) || null), x);
    }
    if (ctx.body.Digits) sp(vr, ctx, "not_valid"); // wrong key: the shared line, then the same options again
    return back(vr, "vm-none", { b, x });
  },

  async "vm-option"(ctx, vr) {
    const sid = ctx.session?.data.vmSid;
    if (!sid) return back(vr, "vm-none", { b: ctx.session?.data.vmBox, x: ctx.session?.data.vmKey });
    const d = ctx.body.Digits;
    if (d === "1") {
      const row = await setRecordingState(sid, "submitted");
      const [kept] = row ? [row] : await db.select().from(schema.voicemails).where(eq(schema.voicemails.recordingSid, sid)).limit(1);
      if (!kept || kept.state !== "submitted") return back(vr, "vm-none", { b: ctx.session?.data.vmBox, x: ctx.session?.data.vmKey });
      sp(vr, ctx, vmSent(ctx.session?.data.vmKey)); // only once the message is really saved
      vr.hangup();
      return vr;
    }
    if (d === "2") {
      // Played through our own server with the Twilio account login (works even if Twilio locks recordings).
      const [row] = await db.select({ id: schema.voicemails.id }).from(schema.voicemails).where(eq(schema.voicemails.recordingSid, sid)).limit(1);
      if (row) vr.play(voicemailPlayLink(row.id));
      return back(vr, "vm-options");
    }
    if (d === "3") {
      const box = await boxById(ctx.session?.data.vmBox ?? null);
      sp(vr, ctx, "vm_rerecord");
      return vmRecord(vr, box, ctx.session?.data.vmKey ?? null);
    }
    // Wrong key (Abraham, Nov 16, 2026): the shared line, then the same options again
    if (d) sp(vr, ctx, "not_valid");
    return back(vr, "vm-options");
  },

  /** Older link: the message was saved when the recording finished. */
  async "voicemail-done"(ctx, vr) {
    vr.hangup();
    return vr;
  },

  /** Twilio recording status callback (no caller on the line; returns empty TwiML). */
  async "vm-recording"(ctx, vr) {
    const b = ctx.body;
    if (b.RecordingStatus === "completed" && b.RecordingSid && b.RecordingUrl && Number(b.RecordingDuration || 0) >= 1) {
      const box = await boxById(Number(ctx.query.get("b")) || null);
      await saveRecording({
        boxId: box.id,
        callSid: ctx.callSid,
        from: ctx.session?.fromNumber ?? ctx.from,
        recordingSid: b.RecordingSid,
        recordingUrl: b.RecordingUrl,
        durationSec: Number(b.RecordingDuration || 0),
        transcribe: ctx.query.get("t") === "1",
        callEnded: ctx.session?.status === "completed" || !ctx.session,
      });
    }
    return vr;
  },

  /** Twilio transcription callback (returns empty TwiML). */
  async "vm-transcription"(ctx, vr) {
    if (ctx.body.RecordingSid) await saveTranscription(ctx.body.RecordingSid, ctx.body.TranscriptionStatus || "failed", ctx.body.TranscriptionText || null);
    return vr;
  },
};

/* ------------------------------------------------------------------ checkout fields */

type Field = "name" | "address" | "email" | "street" | "unit" | "directions";
const FIELDS: Record<
  Field,
  { prompt: PromptKey; hints: string; normalize: (s: string) => string | null; readBack: (v: string) => string; next: string }
> = {
  name: {
    prompt: "ask_name",
    hints: "Friedman, Weiss, Schwartz, Klein, Gross, Teitelbaum, Goldberger, Weinberger, Rosenberg, Stein",
    normalize: (s) => normalizeSpokenName(s) || null,
    readBack: (v) => v,
    next: "addr", // the address: in steps (Abraham, Nov 17, 2026) once approved, else the one question
  },
  street: {
    prompt: "addr_street",
    hints: "Forest Road, Garfield Road, Bakertown Road, Mountain Road, Acres Road, Quickway Road, Seven Springs Road, Schunnemunk Road, Larkin Drive, Satmar Drive, Van Buren Drive",
    normalize: (s) => titleCase(s.replace(/[.,!?;:]+$/g, "").trim()) || null,
    readBack: (v) => v,
    next: "addr-house",
  },
  unit: {
    prompt: "addr_unit",
    hints: "apartment, unit, suite, A, B, C, 1, 2, 3",
    normalize: (s) => s.replace(/[.,!?;:]+$/g, "").trim().toUpperCase() || null,
    readBack: (v) => v,
    next: "addr-zip",
  },
  directions: {
    prompt: "ask_directions",
    hints: "gate code, park, driveway, backyard, side door",
    normalize: (s) => s.trim().slice(0, 500) || null,
    readBack: (v) => v,
    next: "finalize",
  },
  address: {
    prompt: "ask_address",
    hints: "Kiryas Joel, Monroe, Palm Tree, Forest Road, Garfield Road, Bakertown Road, Mountain Road, Acres Road, Schunnemunk, Quickway Road, Seven Springs Road, Harriman, Chester, Blooming Grove",
    normalize: (s) => normalizeSpokenAddress(s) || null,
    readBack: (v) => v,
    next: "directions", // Abraham, Nov 15, 2026: then any directions for the driver (pound skips)
  },
  email: {
    prompt: "ask_email",
    hints: "at, dot, gmail dot com, yahoo dot com, outlook dot com, hotmail dot com, aol dot com, icloud dot com",
    normalize: normalizeSpokenEmail,
    readBack: (v) => {
      const [user, domain] = v.split("@");
      return `${user.split("").join(" ")}, at ${domain.replace(/\./g, " dot ")}`;
    },
    next: "finalize",
  },
};

/* ------------------------------------------------------------------ dispatcher */

/** Star from an item's step: one menu back, the item's list (its category), else the bookings menu. */
async function starToCategory(vr: VR, productId: number) {
  const p = productId ? await getProduct(productId) : null;
  return p ? back(vr, "category", { c: p.categoryId }) : back(vr, "book");
}

/** The caller's phone (E.164), for the card payment limits. */
function callerPhoneOf(ctx: { session?: { fromNumber?: string | null } | null; from: string | null }): string | null {
  return toE164(ctx.session?.fromNumber ?? ctx.from ?? "") || null;
}

const STAFF_LEG_ACTIONS = new Set(["whisper", "whisper-accept", "music", "pay-leg", "pay-leg-status"]); // music: wait music pieces, not a step of the caller's journey

export async function handleVoice(input: Omit<Ctx, "session" | "prompts">): Promise<string> {
  const vr = new twilio.twiml.VoiceResponse();
  const prompts = await loadPromptOverrides();
  const ctx = { ...input, prompts };
  const handler = handlers[ctx.action];
  if (!handler) {
    sp(vr, ctx, "went_wrong");
    vr.redirect({ method: "POST" }, url("menu"));
    return vr.toString();
  }
  // The staff member's leg (press 1 to accept) is a separate call: never log it as a caller session.
  if (STAFF_LEG_ACTIONS.has(ctx.action)) {
    await handler({ ...ctx, session: null }, vr);
    return vr.toString();
  }
  const session = ctx.action === "incoming" ? null : await getSession(ctx.callSid);
  if (!session && ctx.action !== "incoming") await ensureSession(ctx.callSid, ctx.from);
  // Caller journey (Abraham S): this menu or question, with the key pressed or the words said
  await trackStep(ctx.callSid, ctx.action, ctx.body, ctx.query);
  // Abraham's idle rule inside a booking: remember when the caller last pressed a key (or said something)
  let current = session;
  if ((ctx.body.Digits || (ctx.body.SpeechResult || "").trim()) && current) {
    await updateSession(ctx.callSid, { data: { lastKeyAt: Date.now() } }, current);
    current = await getSession(ctx.callSid);
  }
  try {
    await handler({ ...ctx, session: current ?? session ?? (await getSession(ctx.callSid)) }, vr);
  } catch (e) {
    console.error("IVR handler error", ctx.action, e);
    const err = new twilio.twiml.VoiceResponse();
    sp(err, ctx, "tech_error");
    err.hangup();
    return err.toString();
  }
  return vr.toString();
}

/** Twilio call status callback: release held stock when the call ends. */
export async function handleCallStatus(callSid: string, status: string) {
  const ended = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);
  if (!ended) return;
  const s = await getSession(callSid);
  if (!s) return;
  // Every day's held order on this call (cancelHold only affects orders still in HOLD)
  for (const id of new Set([...(s.data?.dayOrderIds ?? []), ...(s.orderId ? [s.orderId] : [])])) await cancelHold(id);
  // Items from the last call that were held while the caller decided (not added to the cart)
  for (const l of s.data?.resumeLines ?? []) if (l.state === "free" && l.holdId) await cancelHold(l.holdId);
  // Where the caller hung up (the last menu or question they reached) and whether a booking was finished
  const [last] = await db
    .select({ step: schema.callEvents.step, label: schema.callEvents.label })
    .from(schema.callEvents)
    .where(and(eq(schema.callEvents.callSid, callSid), eq(schema.callEvents.kind, "step")))
    .orderBy(desc(schema.callEvents.id))
    .limit(1)
    .catch(() => []); // journey logging must never break the hang-up handling
  const booked = s.outcome === "checked_out";
  // Voicemail the caller didn't confirm is kept (with a note if they pressed # and hung up). Never lost.
  const keptMessages = await finalizeCallRecordings(callSid).catch((e) => (console.error("voicemail finalize failed", e), 0));
  // Owner alert (Abraham): missed call = reached voicemail and hung up without a message, or hung up while ringing.
  // Once per call; never when a voicemail was left (that one gets the voicemail alert).
  // Key 9 (Abraham, Nov 16, 2026): a message box only, nobody is called there, so it is never a missed call. A
  // message left on key 9 gets the usual voicemail alert; hanging up without one sends nothing.
  const feedbackBox = s.data?.vmEntry === "9" && !s.data?.missed;
  if (!feedbackBox && !s.data?.missedAlerted && !s.data?.leftMessage && !keptMessages) {
    const how = s.outcome === "voicemail" || last?.step === "voicemail" ? "voicemail_no_message" : last?.step === "ring" ? "hung_up_ringing" : null;
    if (how) {
      await updateSession(callSid, { data: { missedAlerted: true } }, s);
      await alertMissedCall({ callSid, from: s.fromNumber, at: new Date(), how, data: s.data }).catch((e) => console.error("missed-call alert failed", e));
    }
  }
  await track(callSid, "hung_up", booked ? "Call ended after booking" : `Hung up at: ${last ? (STEP_LABELS[last.step ?? ""] ?? last.label) : "before any menu"}`, {
    lastStep: last?.step ?? null,
    lastStepLabel: last ? (STEP_LABELS[last.step ?? ""] ?? last.label) : "Before any menu",
    booked,
    outcome: s.outcome === "carted" ? "dropped" : s.outcome,
    status,
  });
  await updateSession(
    callSid,
    {
      status: "completed",
      endedAt: new Date(),
      outcome: s.outcome === "carted" ? "dropped" : s.outcome,
    },
    s,
  );
}

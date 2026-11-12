import twilio from "twilio";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { addDays, longDate, todayISO } from "@/lib/dates";
import { spokenMoney } from "@/lib/money";
import { last4, spokenDigits, toE164 } from "@/lib/phone";
import { logStamp, phonePromoMode, phonePromoOn, readBack, tenDigitNumber } from "@/lib/phone-promo";
import { checkBookable, pickupDateFor } from "@/lib/availability";
import { checkEventDate } from "@/lib/jewish-calendar";
import { lateHoursToday, officeOpenNow, websiteHoursLines } from "@/lib/business-hours";
import {
  PAYMENT_HOLD_MINUTES,
  PHONE_HOLD_MINUTES,
  cancelHold,
  getOrderWithItems,
  minutesFromNow,
  orderNumber,
  reserveItem,
  upsertCustomer,
} from "@/lib/orders";
import { payPageLink } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";
import { sendEmail, sendSms } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { computeTotals, deliveryZone } from "@/lib/pricing";
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
  setCustomerTimeZone,
  shouldAskMarketing,
  wordingVersion,
} from "@/lib/sms-consent";
import { ensureSession, getSession, updateSession, type CallSession } from "./session";
import { normalizeSpokenAddress, normalizeSpokenEmail, normalizeSpokenName, parseDateInput } from "./parse";
import { voicemailPlayLink } from "@/lib/signed-link";
import { INFO_CATALOG_AUTOREPLY_ON, catalogText, recordCatalogRequest, sendCatalogEmail } from "@/lib/catalog-send";
import { CATALOG_ENDINGS, decodeCatalogKeys, spellOut, spokenEmail, spokenLetters, validDomain, validLocal } from "./catalog-keys";
import { boxById, boxForKey, finalizeCallRecordings, mainBox, recordingFinished, saveRecording, saveTranscription, setRecordingState, textingActive } from "@/lib/voicemail";
import { RING_KEYS, extensionName, lineRingsNow, ringAttempts, ringListFor, staffAnnouncement, type RingKey } from "./routing";
import { erevCandleLighting, isShabbosOrYomTov, localISO } from "@/lib/jewish-calendar";
import { matchBlock, parseBlockList } from "./caller-filter";
import { PROMPTS, loadPromptOverrides, promptAudio, promptText, promptWaiting, type PromptKey, type PromptOverrides } from "./prompts";
import { messageDate } from "@/lib/dual-date";
import { decodeMultitap, titleCase } from "./multitap";
import { startRecording } from "@/lib/call-recording";

const { categories, products, orders } = schema;
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
function sp(target: VR | Gather, ctx: { prompts: PromptOverrides }, key: PromptKey, vars?: Record<string, string | number>) {
  if (promptWaiting(ctx.prompts, key)) return; // Abraham (Phone Recordings): a line waiting for his OK never plays
  const audio = promptAudio(ctx.prompts, key);
  if (audio) target.play(audio);
  else say(target, promptText(ctx.prompts, key, vars));
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

/** "Tuesday, March 5th": day name, month and day number, for the booking steps (Abraham). */
export function spokenDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
  const mo = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
  const n = d.getUTCDate();
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${wd}, ${mo} ${n}${n % 10 > 3 ? "th" : suf}`;
}

/** Booking steps (Abraham, Nov 11): no key pressed -> the same step again; 9 minutes idle the warning, 10 minutes end. */
function bookNoInput(vr: VR, ctx: Ctx, retryAction: string, retryParams: Record<string, string | number | undefined> = {}) {
  return idleNoKey(vr, ctx, retryAction, retryParams);
}

/** The item is free on that day, and the day is open (not past, not Shabbos/Yom Tov/closed, pickup rules applied). */
async function itemFreeOn(p: { id: number; quantity: number }, date: string, cal: Awaited<ReturnType<typeof getSettings>>): Promise<boolean> {
  if (date < todayISO()) return false;
  if (!checkEventDate(date, cal).ok) return false;
  return (await checkBookable(p.id, p.quantity, date)) > 0;
}

/** Next size up (+1) or down (-1) in the same category that's free that day; null if none. */
async function nearestSize(p: { id: number; categoryId: number; sizeOrder: number | null }, date: string, dir: 1 | -1, cal: Awaited<ReturnType<typeof getSettings>>) {
  if (p.sizeOrder == null) return null;
  const sizes = (await phoneProducts(p.categoryId))
    .filter((x) => x.id !== p.id && x.sizeOrder != null && (dir > 0 ? x.sizeOrder! > p.sizeOrder! : x.sizeOrder! < p.sizeOrder!))
    .sort((a, b) => dir * (a.sizeOrder! - b.sizeOrder!));
  for (const x of sizes) if (await itemFreeOn(x, date, cal)) return x;
  return null;
}

/** Nearest open day with the item free, searching back (-1) or forward (+1) from a date (skipping closed days). */
async function nearestFreeDay(p: { id: number; quantity: number }, date: string, dir: 1 | -1, cal: Awaited<ReturnType<typeof getSettings>>, start = 2, limit = dir > 0 ? 90 : 60) {
  for (let i = start; i <= limit; i++) {
    const d = addDays(date, dir * i);
    if (dir < 0 && d < todayISO()) return null;
    if (await itemFreeOn(p, d, cal)) return d;
  }
  return null;
}

/** Speech (plus optional keypad) gather tuned for phone audio. */
function speech(vr: VR, action: string, hints: string, opts: { dtmf?: boolean; numDigits?: number; finishOnKey?: string } = {}) {
  return vr.gather({
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
export const MENU_WAIT_SECONDS = 4;

/** No choice after the main menu: the whole menu again, from the greeting (3 plays and 20 seconds rule). */
function menuNoChoice(vr: VR, ctx: Ctx) {
  return repeatMenu(vr, ctx, "menu", { first: 1 });
}

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
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.categoryId, categoryId), eq(products.active, true)))
    .orderBy(asc(products.sortOrder), asc(products.id));
  return rows.slice(0, 9); // keypad 1-9
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

const CONSENT_HINTS = "yes, no, I agree, yes I agree, yes please, no thanks, skip";

/** Keys on the "different time zone" menu. */
const PHONE_TZ_KEYS: Record<string, string> = {
  "1": "America/Chicago",
  "2": "America/Denver",
  "3": "America/Phoenix",
  "4": "America/Los_Angeles",
  "5": "America/Anchorage",
  "6": "Pacific/Honolulu",
};

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

/** Ring one step of a key's list (one after another) or everyone at once. */
function dialTargets(vr: VR, list: ReturnType<typeof ringListFor>, k: RingKey, i: number, from?: string | null): VR {
  const simultaneous = list.mode === "simultaneous";
  // Abraham (Phone Menu v3): the list rings several times over (3 by default); step i goes round the list
  const ring = simultaneous ? list.targets : [list.targets[i % list.targets.length]];
  const dial = vr.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER || undefined,
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
 * open, and Abraham's "office is closed" greeting after hours, Shabbos and Yom Tov (same hours as the website and key 7).
 */
async function vmGreeting(x: string | null | undefined): Promise<PromptKey> {
  if (x === "9") return "vm9_greeting";
  return officeOpenNow(new Date(), await getSettings()) ? "vm_greeting" : "vm_closed";
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
  const r = await sendMessage({ to, body: catalogText(), kind: "system", event: "catalog_request", callSid: ctx.callSid });
  await logCatalogRequest(ctx, "text", to, r.sent);
  if (!r.sent) {
    sp(vr, ctx, "catalog_text_not_yet");
    return back(vr, "catalog-email");
  }
  sp(vr, ctx, "catalog_texted");
  vr.hangup();
  return vr;
}

/** Every catalog request on the caller's contact (channel, date with year); a failed send alerts Abraham. */
async function logCatalogRequest(ctx: Ctx, channel: "text" | "email", to: string, sent: boolean) {
  await track(ctx.callSid, "step", sent ? `Catalog sent by ${channel}` : `Catalog ${channel} failed`, { channel, to, sent });
  await recordCatalogRequest({ callerPhone: toE164(ctx.from), channel, to, sent, source: "phone" });
}

/** Does this line ring now (office hours, after-hours switch, key 6 hours, Shabbos and Yom Tov)? */
async function lineRingsNowFor(k: RingKey, settings: Awaited<ReturnType<typeof getSettings>>, at = new Date()) {
  const iso = localISO(at);
  return lineRingsNow(k, at, settings, { officeOpen: officeOpenNow(at, settings), shabbosOrYomTov: isShabbosOrYomTov(iso), candleLighting: erevCandleLighting(iso, settings) });
}

/* ------------------------------------------------------------------ handlers */

type Handler = (ctx: Ctx, vr: VR) => Promise<VR> | VR;

const handlers: Record<string, Handler> = {
  async incoming(ctx, vr) {
    // Blocked callers (Settings → Caller blocking) get a busy signal before anything else, and no session.
    const blocked = matchBlock(ctx.from, parseBlockList((await getSettings()).blockedCallers || ""));
    if (blocked) {
      console.log(`[hotline] blocked caller ${ctx.from ?? "withheld"} (${blocked.pattern})`);
      vr.reject({ reason: "busy" });
      return vr;
    }
    await ensureSession(ctx.callSid, ctx.from);
    // Call recording (off unless the Owner turns it on): the notice plays first, recording starts only after it.
    if ((await getSettings()).callRecording) {
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
    return back(vr, "menu", { first: 1 });
  },

  /** Twilio: a call recording finished. Saved on the call for the call log (recording itself stays in Twilio). */
  async "call-recording"(ctx, vr) {
    if (ctx.body.RecordingStatus === "completed" && ctx.body.RecordingSid) {
      await updateSession(ctx.callSid, { data: { recordingSid: ctx.body.RecordingSid, recordingUrl: ctx.body.RecordingUrl ?? null } }, ctx.session);
    }
    return vr;
  },

  /**
   * Abraham's main menu (approved Nov 8, 2026). 1 bookings (rental list), 2/4/5/6/8/0 ring a live employee (each
   * key's own list), 9 general voicemail, * repeats. Until Abraham approves their messages: 3 opens the rental list,
   * 7 rings the operator. Voice commands keep working in the background (not announced).
   * With ?first=1 (the incoming call, star, and each replay after silence) the greeting and the closed / open-late
   * line play inside the same Gather, so any key works at any time, even during the greeting. After the last line it
   * waits 4 seconds; no choice replays the whole menu, and after 3 plays the existing goodbye line plays and the call
   * ends. A wrong key ("Sorry, that is not a valid selection…") replays the menu lines without the greeting, as before.
   */
  async menu(ctx, vr) {
    // Abraham: menus are keys only (no speech). finishOnKey "" makes # arrive as a key, so # is an invalid choice.
    const g = vr.gather({
      input: ["dtmf"],
      numDigits: 1,
      finishOnKey: "",
      timeout: MENU_WAIT_SECONDS, // Abraham: 4 seconds after the last line, then the menu plays again
      action: url("menu-choice", { np: ctx.query.get("np") || undefined, t0: ctx.query.get("t0") || Date.now() }),
      method: "POST",
    });
    if (ctx.query.get("first") === "1") {
      sp(g, ctx, "main_hi");
      halfPause(g);
      sp(g, ctx, "main_slogan");
      halfPause(g);
      // Booking by phone is available 24/7; outside office hours (Jewish calendar + business hours) callers are told
      // the office is closed. Chol Hamoed and Chanukah: Abraham's approved "open late" line.
      const settings = await getSettings();
      const late = lateHoursToday(new Date(), settings);
      const open = officeOpenNow(new Date(), settings);
      // Call journey (Abraham): what the system decided about office hours for this call
      await track(ctx.callSid, "step", open ? "Office open" : "Office closed", { open });
      const status = !open ? "office_closed" : late === "cholHamoed" ? "late_cholhamoed" : late === "chanukah" ? "late_chanukah" : null;
      if (status) {
        sp(g, ctx, status);
        halfPause(g);
      }
      sp(g, ctx, "main_any_time");
      halfPause(g);
      sp(g, ctx, "main_catalog");
      halfPause(g);
    }
    // Abraham's main menu (Nov 11, 2026), word for word. Any key works at any time, even during the greeting.
    const lines = ["main_book", "main_equipment", "main_service_3", "main_learn_4", "main_rental_help", "main_6", "main_hours", "main_catalog", "main_9", "main_0", "main_star_again", "main_thanks"] as const;
    lines.forEach((k, i) => {
      sp(g, ctx, k);
      if (i < lines.length - 1) halfPause(g);
    });
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
      case "*": // Abraham: star replays the entire main menu, from the greeting
        return back(vr, "menu", { first: 1 });
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
      if (catalogTextReady()) return back(vr, "catalog-text");
      sp(vr, ctx, "catalog_text_not_yet");
      return back(vr, "catalog-email");
    }
    if (d === "2") return back(vr, "catalog-email");
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog");
  },

  "catalog-text"(ctx, vr) {
    const g = keypad(vr, url("catalog-text-choice"));
    sp(g, ctx, "catalog_text_which");
    return repeatMenu(vr, ctx, "catalog-text");
  },

  async "catalog-text-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "catalog");
    if (d === "1") {
      const to = toE164(ctx.from);
      return to ? catalogSendText(ctx, vr, to) : back(vr, "catalog-text-enter");
    }
    if (d === "2") return back(vr, "catalog-text-enter");
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-text");
  },

  "catalog-text-enter"(ctx, vr) {
    const g = keypad(vr, url("catalog-text-heard"), { numDigits: 11, timeout: 10, finishOnKey: "#" });
    sp(g, ctx, "catalog_text_enter");
    return repeatMenu(vr, ctx, "catalog-text-enter");
  },

  async "catalog-text-heard"(ctx, vr) {
    const digits = ctx.body.Digits || "";
    if (digits.includes("*")) return back(vr, "catalog-text"); // star: one step back
    const e164 = tenDigitNumber(digits);
    if (!e164) {
      sp(vr, ctx, "not_valid");
      return back(vr, "catalog-text-enter");
    }
    await updateSession(ctx.callSid, { data: { catPhone: e164 } }, ctx.session);
    const g = keypad(vr, url("catalog-text-confirm"));
    sp(g, ctx, "catalog_text_heard", { number: readBack(e164) });
    return repeatMenu(vr, ctx, "catalog-text-heard-again");
  },

  "catalog-text-heard-again"(ctx, vr) {
    const p = ctx.session?.data.catPhone;
    if (!p) return back(vr, "catalog-text-enter");
    const g = keypad(vr, url("catalog-text-confirm"));
    sp(g, ctx, "catalog_text_heard", { number: readBack(p) });
    return repeatMenu(vr, ctx, "catalog-text-heard-again");
  },

  async "catalog-text-confirm"(ctx, vr) {
    const d = ctx.body.Digits;
    const to = ctx.session?.data.catPhone;
    if (d === "1" && to) return catalogSendText(ctx, vr, to);
    if (d === "2") return back(vr, "catalog-text-enter");
    if (d === "*") return back(vr, "catalog-text");
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-text-heard-again");
  },

  /** Email: the info@ tip (once that auto-reply is on), then step 1, the first part of the address. */
  async "catalog-email"(ctx, vr) {
    if (INFO_CATALOG_AUTOREPLY_ON) sp(vr, ctx, "catalog_email_info");
    await updateSession(ctx.callSid, { data: { catLocal: "", catDomain: "" } }, ctx.session);
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
    await updateSession(ctx.callSid, { data: { catKeys: "", [part === "domain" ? "catDomain" : "catLocal"]: r.text } }, ctx.session);
    if (r.back) return back(vr, part === "domain" ? "catalog-ending" : "catalog"); // star three times: one step back
    return back(vr, "catalog-got", { part });
  },

  async "catalog-said"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const keep = ctx.query.get("add") === "1" ? catPart(ctx, part) : "";
    const said = spokenLetters(ctx.body.SpeechResult || "");
    if (!said && !keep) return back(vr, "catalog-part", { part, add: ctx.query.get("add") ?? undefined });
    await updateSession(ctx.callSid, { data: { [part === "domain" ? "catDomain" : "catLocal"]: keep + said } }, ctx.session);
    return back(vr, "catalog-got", { part });
  },

  /** "We got y o s s i. To continue, press pound. To start over, press 1. To add more, press 2." */
  "catalog-got"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const value = catPart(ctx, part);
    if (!value) {
      sp(vr, ctx, "email_unclear");
      return back(vr, "catalog-part", { part });
    }
    const g = keypad(vr, url("catalog-got-choice", { part }));
    sp(g, ctx, "catalog_got", { letters: spellOut(value) });
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
    if (d === "*") return back(vr, part === "domain" ? "catalog-ending" : "catalog");
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
    if (d === "1" && email) {
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
    if (d === "2") return back(vr, "catalog-email"); // start over
    if (d === "*") return back(vr, "catalog-ending");
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-final");
  },

  "catalog-done"(ctx, vr) {
    if (ctx.body.Digits === "*") return back(vr, "menu");
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
    const cats = await phoneCategories();
    const g = keypad(vr, url("book-choice")); // keys only (Abraham); # is an invalid choice
    // Abraham (Nov 11, 2026), word for word. Categories, their names and order come from Admin; numbered 1, 2, 3...
    sp(g, ctx, "book_note");
    halfPause(g);
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
    const g = keypad(vr, url("category-choice", { c }));
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
    const p = items[Number(d) - 1];
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
      await track(ctx.callSid, "date_closed", `Asked for ${longDate(r.date)}: closed`, { date: r.date, reason: chk.day.reasonEn ?? chk.day.reason ?? null });
      sp(vr, ctx, "date_closed", { date: spokenDate(r.date), reason: chk.day.reasonEn ?? chk.day.reason ?? "a holiday" }); // Ashkenazi English names (Abraham)
      return back(vr, "date", { p });
    }
    await track(ctx.callSid, "date_asked", `Asked about ${longDate(r.date)}`, { date: r.date, key: digits });
    return back(vr, "date-ask", { p, d: r.date });
  },

  /** "You entered Tuesday, March 5th. If that's correct, press 1. To enter a different date, press 2." */
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
    if (d === "2") return back(vr, "date", { p });
    if (d !== "1") {
      if (d) sp(vr, ctx, "not_valid");
      return back(vr, "date-ask", { p, d: date });
    }
    await chooseDay(ctx, date);
    return p ? back(vr, "qty", { p, d: date }) : back(vr, "book");
  },

  /** The item is booked on that day: next size up / down that's free, or keep the item and pick another date. */
  async booked(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const cal = await getSettings();
    const [big, small] = await Promise.all([nearestSize(p, date, 1, cal), nearestSize(p, date, -1, cal)]);
    const g = keypad(vr, url("booked-choice", { p: p.id, d: date, b: big?.id, s: small?.id }));
    sp(g, ctx, "booked_intro", { item: p.name, date: spokenDate(date) });
    if (big || small) sp(g, ctx, "booked_closest");
    if (big) sp(g, ctx, "booked_bigger", { item: big.name });
    if (small) sp(g, ctx, "booked_smaller", { item: small.name });
    sp(g, ctx, "booked_keep", { item: p.name });
    return bookNoInput(vr, ctx, "booked", { p: p.id, d: date });
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
    if (d === "*") return back(vr, "menu");
    if (d === "0") return back(vr, "cart");
    sp(vr, ctx, "not_valid");
    return back(vr, "booked", { p, d: date });
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
    if (d === "*") return back(vr, "menu");
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
      await track(ctx.callSid, "unavailable", `${p.name} not available on ${longDate(date)}`, { item: p.name, productId: p.id, date });
      return back(vr, "booked", { p: p.id, d: date });
    }
    if (free === 1) return back(vr, "add", { p: p.id, d: date, q: 1 });
    const max = Math.min(free, 9);
    const g = keypad(vr, url("add", { p: p.id, d: date }));
    sp(g, ctx, "qty_prompt", { count: free, date: longDate(date), max });
    return noInput(vr, ctx, "qty", { p: p.id, d: date });
  },

  async "soldout-choice"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const d = ctx.body.Digits;
    const order = await currentOrder(ctx);
    if (d === "9" || d === "0") return back(vr, "cart");
    if (d === "*") return back(vr, "menu");
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
        await track(ctx.callSid, "unavailable", r.free > 0 ? `Only ${r.free} ${p.name} left on ${longDate(date)} (asked for ${q})` : `${p.name} was just booked for ${longDate(date)}`, { item: p.name, productId: p.id, date, asked: q, free: r.free });
        if (r.free > 0) sp(vr, ctx, "only_some_left", { count: r.free });
        else sp(vr, ctx, "just_booked", { item: p.name });
        return back(vr, r.free > 0 ? "qty" : "menu", r.free > 0 ? { p: p.id, d: date } : {});
      }
      sp(vr, ctx, "went_wrong");
      return back(vr, "menu");
    }
    await track(ctx.callSid, "item_added", `Added ${itemPhrase(q, p.name)} for ${longDate(date)}`, { item: p.name, productId: p.id, qty: q, date, orderId: r.orderId });
    const ids = [...new Set([...(session.data?.dayOrderIds ?? []), r.orderId])];
    await updateSession(ctx.callSid, { orderId: r.orderId, outcome: "carted", data: { day: date, dayOrderIds: ids } }, session);
    const g = keypad(vr, url("after-add"));
    sp(g, ctx, "added", { items: itemPhrase(q, p.name), date: longDate(date) });
    sp(g, ctx, "day_choice");
    sp(g, ctx, "cart_key");
    return noInput(vr, ctx, "cart");
  },

  async "after-add"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "menu"); // star always returns to the main menu (as in the other sub-menus)
    if (d === "1") return back(vr, "book"); // same day: more items
    if (d === "2") return back(vr, "date"); // another day: ask the day, then the items for that day
    if (d === "0") return back(vr, "cart");
    if (d) {
      sp(vr, ctx, "not_valid");
      const g = keypad(vr, url("after-add"));
      sp(g, ctx, "day_choice");
      sp(g, ctx, "cart_key");
      return noInput(vr, ctx, "cart");
    }
    return noInput(vr, ctx, "cart");
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
    for (const o of days) sp(g, ctx, "cart_day", { date: longDate(o.order.eventDate), items: o.items.map((i) => itemPhrase(i.qty, i.name)).join(", ") });
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
    // Say it, or press star to type it on the keypad (Abraham L). finishOnKey "" so star and # arrive as keys.
    const g = speech(vr, url("heard", { f, n }), spec.hints, { dtmf: true, numDigits: 1, finishOnKey: "" });
    sp(g, ctx, spec.prompt);
    sp(g, ctx, "type_hint");
    return vr;
  },

  /** Keypad typing: the instructions, then keys until # (star separates letters inside this prompt, not the menu). */
  type(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 15, action: url("typed", { f }), method: "POST" });
    if (!ctx.query.get("again")) {
      sp(g, ctx, "type_instructions");
      if (f === "email") sp(g, ctx, "type_email_symbols");
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

  async heard(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const spec = FIELDS[f];
    if (ctx.body.Digits === "*") return back(vr, "type", { f }); // switch to keypad typing
    if (f === "email" && (ctx.body.Digits === "#" || (ctx.body.Digits === "" && !ctx.body.SpeechResult))) return back(vr, "phone"); // skip email (as before)
    if (ctx.body.Digits && !ctx.body.SpeechResult) return back(vr, "ask", { f }); // another key: ask again
    const raw = (ctx.body.SpeechResult || "").trim();
    const value = raw ? spec.normalize(raw) : null;
    if (!value) {
      const n = Number(ctx.query.get("n") || 0) + 1;
      if (f === "email" && n >= 2) {
        sp(vr, ctx, "email_skip");
        return back(vr, "phone");
      }
      if (n >= MAX_NO_INPUT) {
        sp(vr, ctx, "field_trouble");
        return back(vr, config.forwardPhone() ? "operator" : "phone");
      }
      sp(vr, ctx, f === "email" ? "email_unclear" : "field_unclear");
      return back(vr, "ask", { f, n });
    }
    await track(ctx.callSid, "said", `Said ${f}: ${value}`, { field: f, value, raw });
    await updateSession(ctx.callSid, { data: { heard: value } }, ctx.session);
    const g = keypad(vr, url("confirm", { f }));
    sp(g, ctx, "heard", { value: spec.readBack(value) });
    return noInput(vr, ctx, "ask", { f });
  },

  async confirm(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const d = ctx.body.Digits;
    if (d !== "1") return back(vr, "ask", { f });
    const heard = ctx.session?.data.heard;
    if (!heard) return back(vr, "ask", { f });
    if (f === "address" && deliveryZone(heard, await getSettings()) === "outside") {
      // Outside the delivery area: checkout stops here and asks for an in-area address.
      await updateSession(ctx.callSid, { data: { heard: undefined } }, ctx.session);
      sp(vr, ctx, "address_outside_area");
      return back(vr, "ask", { f: "address" });
    }
    await updateSession(ctx.callSid, { data: { [f]: heard, heard: undefined } }, ctx.session);
    return back(vr, FIELDS[f].next);
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
      const phone = ctx.session?.data.phone;
      const consented = ctx.session?.data.smsConsent === "yes" || ctx.session?.data.smsConsent === "existing";
      const r = phone && consented ? await sendSms(phone, `${BUSINESS_NAME} Terms and Conditions: ${config.baseUrl()}/terms`, { kind: "transactional", event: "terms_link", orderId: order.order.id, callSid: ctx.callSid }) : null;
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
    return noInput(vr, ctx, "phone");
  },

  "phone-enter"(ctx, vr) {
    const g = keypad(vr, url("phone-heard"), { numDigits: 10, timeout: 10, finishOnKey: "#" });
    sp(g, ctx, "phone_enter");
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
    if (ctx.body.Digits !== "1" || !ctx.session?.data.heard) return back(vr, "phone-enter");
    await updateSession(ctx.callSid, { data: { phone: ctx.session.data.heard, heard: undefined } }, ctx.session);
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
    const g = speech(vr, url("sms-consent-answer", { n: ctx.query.get("n") ?? undefined }), CONSENT_HINTS, { dtmf: true, numDigits: 1 });
    sp(g, ctx, retry ? "consent_unclear" : "consent_transactional");
    return vr;
  },

  async "sms-consent-answer"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    if (!phone) return back(vr, "phone");
    const n = Number(ctx.query.get("n") || 0);
    const answer = parseConsentAnswer({ digits: ctx.body.Digits, speech: ctx.body.SpeechResult, confidence: ctx.body.Confidence });
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
    const settings = await getSettings();
    const zone = deliveryZone(data.address, settings);
    // Each rental day is its own delivery: its own delivery fee and tax. One charge pays for all of them.
    const perDay = days.map((o) => ({ o, t: computeTotals(o.order.subtotalCents, zone, settings) }));
    if (perDay.some((x) => !x.t)) {
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
    const primary = days[0].order;
    for (const { o, t } of perDay) {
      await db
        .update(orders)
        .set({
          customerId,
          deliveryAddress: data.address,
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

    const num = orderNumber(primary.id);
    const link = payPageLink(primary.id); // review-and-pay page for the whole reservation: Terms box, then Sola
    const dayText = (o: (typeof days)[number]) => `${o.items.map((i) => `${i.qty} x ${i.name}`).join(", ")} for ${messageDate(o.order.eventDate)} (pickup ${messageDate(o.order.pickupDate)})`;
    const details =
      `${BUSINESS_NAME} order #${num}: ${days.map(dayText).join("; ")}. ` +
      `Rentals $${money(totals.subtotalCents)} + delivery $${money(totals.deliveryFeeCents)} + sales tax $${money(totals.taxCents)} = total $${money(totals.totalCents)}. ` +
      `Pay securely within ${PAYMENT_HOLD_MINUTES} minutes to confirm: ${link}`;
    // Texts go out only with transactional consent given on this call or recorded before.
    const consented = data.smsConsent === "yes" || data.smsConsent === "existing";
    let texted = false;
    let emailed = false;
    if (phone && consented) {
      // The STOP line is added by the text system on the first order text (or after 30 days without one)
      const res = await sendSms(phone, details, { kind: "transactional", event: "order_payment_link", customerId, orderId: primary.id, callSid: ctx.callSid });
      texted = res.sent;
    } else if (!consented && data.email) {
      const res = await sendEmail(data.email, `${BUSINESS_NAME} order #${num}`, details);
      emailed = res.sent;
    }

    const first = data.name.split(" ")[0];
    sp(vr, ctx, "thanks_order", { name: first, number: spokenDigits(num) });
    sp(vr, ctx, "checkout_total", { total: spokenMoney(totals.totalCents), items: spokenMoney(totals.subtotalCents), delivery: spokenMoney(totals.deliveryFeeCents), tax: spokenMoney(totals.taxCents) });
    if (texted) sp(vr, ctx, "link_sent", { minutes: PAYMENT_HOLD_MINUTES });
    else if (emailed) sp(vr, ctx, "link_emailed", { minutes: PAYMENT_HOLD_MINUTES });
    else if (!consented) sp(vr, ctx, "link_call_back");
    else sp(vr, ctx, "link_failed");
    await updateSession(ctx.callSid, { data: { placedOrderId: primary.id } }, ctx.session);
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
    return back(vr, "goodbye");
  },

  "promo-enter"(ctx, vr) {
    const tries = Number(ctx.query.get("t") || 0);
    const g = keypad(vr, url("promo-heard", { t: tries }), { numDigits: 10, timeout: 10, finishOnKey: "#" });
    sp(g, ctx, "promo_enter");
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
    sp(g, ctx, "promo_heard", { number: readBack(e164) });
    return back(vr, "goodbye");
  },

  async "promo-confirm"(ctx, vr) {
    const heard = ctx.session?.data.promoHeard;
    if (ctx.body.Digits === "1" && heard) {
      await updateSession(ctx.callSid, { data: { promoHeard: undefined } }, ctx.session);
      return promoSend(ctx, vr, heard, "entered");
    }
    if (ctx.body.Digits === "2") return back(vr, "promo-enter");
    return back(vr, "goodbye");
  },

  /* ---- time zone for promotional quiet hours (asked only after a promotional yes; skipping keeps the fallback) ---- */

  tz(ctx, vr) {
    const g = keypad(vr, url("tz-answer"));
    sp(g, ctx, "tz_ask");
    return back(vr, "goodbye");
  },

  async "tz-answer"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    const d = ctx.body.Digits;
    if (phone && d === "1") {
      await setCustomerTimeZone(phone, "America/New_York", "phone");
      sp(vr, ctx, "tz_saved");
      return back(vr, "goodbye");
    }
    if (d === "2") {
      const g = keypad(vr, url("tz-pick"));
      sp(g, ctx, "tz_pick");
    }
    return back(vr, "goodbye");
  },

  async "tz-pick"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    const zone = PHONE_TZ_KEYS[ctx.body.Digits ?? ""];
    if (phone && zone) {
      await setCustomerTimeZone(phone, zone, "phone");
      sp(vr, ctx, "tz_saved");
    }
    return back(vr, "goodbye");
  },

  async goodbye(ctx, vr) {
    const id = ctx.session?.data.placedOrderId;
    const full = id ? await getOrderWithItems(id) : null;
    const several = full?.order.paymentGroupId ? (await db.select({ id: orders.id }).from(orders).where(eq(orders.paymentGroupId, full.order.paymentGroupId))).length > 1 : false;
    if (full && several) sp(vr, ctx, "goodbye_order_days");
    else if (full) sp(vr, ctx, "goodbye_order", { date: longDate(full.order.eventDate), pickup: longDate(full.order.pickupDate) });
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
    if (ctx.body.DialCallStatus === "completed") {
      vr.hangup();
      return vr;
    }
    const k = (RING_KEYS as readonly string[]).includes(ctx.query.get("k") ?? "") ? (ctx.query.get("k") as RingKey) : "0";
    const settings = await getSettings();
    const list = ringListFor(settings, k);
    const next = Number(ctx.query.get("i") ?? -1) + 1;
    const steps = (list.mode === "simultaneous" ? 1 : list.targets.length) * ringAttempts(settings, k);
    if (next > 0 && next < steps && (await lineRingsNowFor(k, settings))) return dialTargets(vr, list, k, next, ctx.session?.fromNumber ?? ctx.from);
    // Abraham's missed-call line, then straight to the voicemail beep
    await updateSession(ctx.callSid, { data: { missed: "no_answer" } }, ctx.session); // dashboard: missed call
    return back(vr, "voicemail", { x: k }); // pressed 2 or no answer on every number: the extension's voicemail
  },

  /**
   * Plays only to the staff member who answered; the caller keeps hearing ringing meanwhile. Abraham's approved
   * announcement with the extension number and its name from Admin: press 1 to take the call, 2 to pass it on.
   */
  async whisper(ctx, vr) {
    const settings = await getSettings();
    const k = (RING_KEYS as readonly string[]).includes(ctx.query.get("k") ?? "") ? (ctx.query.get("k") as RingKey) : "0";
    const text = staffAnnouncement(k, extensionName(settings, k), settings[`ringAnnounce${k}`]);
    const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 8, action: url("whisper-accept"), method: "POST" });
    say(g, text);
    const again = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 6, action: url("whisper-accept"), method: "POST" });
    say(again, text);
    vr.hangup(); // no answer from the staff member (or their voicemail): this leg ends and routing moves on
    return vr;
  },

  async "whisper-accept"(ctx, vr) {
    if (ctx.body.Digits !== "1") vr.hangup(); // 2 or anything else: pass to the next number
    return vr; // empty response = connect the caller
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
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "voicemail" }, ctx.session);
    sp(vr, ctx, await vmGreeting(x));
    return vmRecord(vr, box, x);
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
    // Wrong key: the options again
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

type Field = "name" | "address" | "email";
const FIELDS: Record<
  Field,
  { prompt: PromptKey; hints: string; normalize: (s: string) => string | null; readBack: (v: string) => string; next: string }
> = {
  name: {
    prompt: "ask_name",
    hints: "Friedman, Weiss, Schwartz, Klein, Gross, Teitelbaum, Goldberger, Weinberger, Rosenberg, Stein",
    normalize: (s) => normalizeSpokenName(s) || null,
    readBack: (v) => v,
    next: "ask?f=address",
  },
  address: {
    prompt: "ask_address",
    hints: "Kiryas Joel, Monroe, Palm Tree, Forest Road, Garfield Road, Bakertown Road, Mountain Road, Acres Road, Schunnemunk, Quickway Road, Seven Springs Road, Harriman, Chester, Blooming Grove",
    normalize: (s) => normalizeSpokenAddress(s) || null,
    readBack: (v) => v,
    next: "ask?f=email",
  },
  email: {
    prompt: "ask_email",
    hints: "at, dot, gmail dot com, yahoo dot com, outlook dot com, hotmail dot com, aol dot com, icloud dot com",
    normalize: normalizeSpokenEmail,
    readBack: (v) => {
      const [user, domain] = v.split("@");
      return `${user.split("").join(" ")}, at ${domain.replace(/\./g, " dot ")}`;
    },
    next: "phone",
  },
};

/* ------------------------------------------------------------------ dispatcher */

const STAFF_LEG_ACTIONS = new Set(["whisper", "whisper-accept"]);

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
  if (!s.data?.missedAlerted && !s.data?.leftMessage && !keptMessages) {
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

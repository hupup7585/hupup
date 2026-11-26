import bcrypt from "bcryptjs";
import twilio from "twilio";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { addDays, spokenLongDate, todayISO } from "@/lib/dates";
import { spokenMoney } from "@/lib/money";
import { closedDayOffer, friMutzeDays, friMutzeOffered, friMutzePickup, perDayRules } from "@/lib/holiday-rentals";
import { BALLOON_MENU, BALLOON_SECOND_DIGIT_SECONDS, balloonEntry, balloonForKey, balloonSizes, balloonKeyWords, digitWords } from "@/lib/ivr/balloon-menu";
import { formatPhone, last4, spokenDigits, toE164 } from "@/lib/phone";
import { logStamp, phonePromoMode, phonePromoOn, readBack, tenDigitNumber } from "@/lib/phone-promo";
import { checkBookable, laserPoolsFor, pickupDateFor } from "@/lib/availability";
import { checkEventDate, dayInfo } from "@/lib/jewish-calendar";
import { officeOpenNow, websiteHoursLines } from "@/lib/business-hours";
import {
  PAYMENT_HOLD_MINUTES,
  PHONE_HOLD_MINUTES,
  cancelHold,
  getOrderWithItems,
  orderTextPhone,
  getPaymentGroup,
  minutesFromNow,
  orderNumber,
  refreshOrderTotals,
  reserveItem,
  dropOrphanPacks,
  upsertCustomer,
} from "@/lib/orders";
import { payPageLink } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";
import { sendEmail, sendSms } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { totalsWithFee } from "@/lib/pricing";
import { deliveryQuote } from "@/lib/delivery-areas";
import { DEFAULT_ZIP, townForZip } from "@/lib/orange-zips";

/** Zip menu (Abraham, Nov 24, 2026): 1 Monroe, 2 Highland Mills, 3 Chester, 4 Washingtonville, 5 Central Valley, 6 Harriman; 7 = type another zip. */
export const ZIP_MENU_KEYS: Record<string, string> = { "1": "10950", "2": "10930", "3": "10918", "4": "10992", "5": "10917", "6": "10926" };
import { nextPiece, placeTracks } from "@/lib/music";
import { deliveryFeeFor } from "@/lib/offer-delivery";
import { CURRENT_TERMS_VERSION, recordTermsAcceptance, termsActive } from "@/lib/rental-terms";
import { sendMessage } from "@/lib/sms";
import { STEP_LABELS, track, trackStep } from "@/lib/call-journey";
import { alertMissedCall } from "@/lib/owner-alerts";
import { alertSharedPhoneOrder, isSharedNumber } from "@/lib/shared-phones";
import { addressParts, townPhrase } from "@/lib/spoken-address";
import { lookupByPhone } from "@/lib/directory";
import { makeVmHandlers } from "./vmail";
import { findStreet, streetSlotKey, unitSlotKey } from "@/lib/streets";
import { closestStreet, exactStreet, streetsByPrefix, streetsForZip } from "@/lib/street-search";
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
import { orderPath } from "@/lib/order-path";
import { ensureSession, getSession, updateSession, type CallSession } from "./session";
import { stripePhonePayMode, keypadPayFor, keypadPayOn, paySipUri } from "@/lib/phone-pay";
import { blockIfTooManyCalls, isPhonePayBlocked, phonePayLimits, startPayWatch, startSolaListen } from "@/lib/phonepay-watch";
import { PHONEPAY_NOT_REACHED, buildSendDigits, checkPhonePayTry, customChargeMadeBy, endMainPayLeg, matchCustomCharge, payQueueName, phonePayDirectDial, phonePayOffered, startPayLegWithMusic, startAttempt, triesSoFar } from "@/lib/sola-phonepay";
import { pauseRecording, resumeRecording } from "@/lib/call-recording";

/** Pay prompts that must all be approved before keypad payment goes live for every caller. */
const PHONEPAY_PROMPTS = ["pay_hold_secure", "phonepay_paid", "phonepay_retry", "phonepay_retry_last", "phonepay_failed", "phonepay_unclear"] as const;
const PAY_PROMPTS = ["pay_start", "pay_card_number", "pay_expiration", "pay_security_code", "pay_postal_code", "pay_processing", "pay_success", "pay_declined"] as const;
import { pluralName } from "@/lib/spoken-words";
import { lastPhoneDate, normalizeSpokenAddress, normalizeSpokenEmail, normalizeSpokenName, parseDateInput } from "./parse";
import { liveVoiceLink, nameVoiceLink, voicemailPlayLink } from "@/lib/signed-link";
import { FIRST_TIME_ONLY, menuOrder, type MenuId } from "./menu-order";
import { infoCatalogAutoreplyOn, catalogText, recordCatalogRequest, sendCatalogEmail } from "@/lib/catalog-send";
import { CATALOG_ENDINGS, spellOut, spokenEmail, spokenLetters, validDomain, validLocal } from "./catalog-keys";
import { boxById, boxForKey, finalizeCallRecordings, mainBox, recordingFinished, saveRecording, saveTranscription, setRecordingState, textingActive } from "@/lib/voicemail";
import { RING_KEYS, extensionName, lineRingsNow, ringAttempts, ringListFor, staffAnnouncement, type RingKey } from "./routing";
import { calendarNow } from "@/lib/clock";
import { bookingLock, erevCandleLighting, isShabbosOrYomTov, localISO } from "@/lib/jewish-calendar";
import { matchBlock, parseBlockList } from "./caller-filter";
import { MENU_COMBOS, PROMPTS, clipUrls, composeClips, composeMixed, fill, textPieces, type LinePiece, googleLiveOn, liveClips, loadPromptOverrides, promptAudio, promptText, promptWaiting, type PromptKey, type PromptOverrides } from "./prompts";
import { messageDate } from "@/lib/dual-date";
import { decodeMultitap, titleCase } from "./multitap";
import { startRecording } from "@/lib/call-recording";
import { categoryProducts, itemFreeOn, nearestFreeDay, nearestSize } from "@/lib/alternatives";
import { BOX_BY_NUMBER, CALLBACK_CALLER_ID, VM_ACCESS_KEYS, VM_ACCESS_KEY_GAP, VM_PIN_TRIES, callOutActive, callOutNumber, callbackNumber, checkVmPin, lockVmAccess, logVmAccess, vmAccessActive, vmLockedUntil, vmPinChangedByPhone, validPin } from "@/lib/vm-access";
import { STT_HOLD_FILE, STT_MAX_WAITS, googleReadback, runLater, sttActive, transcribeAnswer } from "@/lib/speech-to-text";
import { linkHoldMinutes } from "@/lib/settings";

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

/** Google's spoken spelling (Abraham, Nov 22, 2026): written "Chanukah" / "Chol Hamoed" stay; the voice says these. */
export const spokenSpelling = (text: string) => text.replace(/Chanukah/g, "Hanukkah").replace(/Chol Hamoed/g, "Hola moed");

function say(target: VR | Gather, text: string) {
  const t = text.replace(/[ \t]{2,}/g, " ").trim(); // an empty part (box 155 with no description, an add-on with no count) leaves no gap
  if (t) target.say(voice(), spokenSpelling(t));
}

/**
 * A household name said live (Abraham, Nov 25, 2026, 12:36): at the Owner's "Speed for spoken names" (default 1.1, 10
 * percent faster). Only names use this speed. Google makes it in the hotline voice (Puck) through our signed link;
 * without the Google key, the live voice says it with the same speed as SSML.
 */
async function sayName(target: VR | Gather, text: string) {
  const t = text.trim();
  if (!t) return;
  const raw = Number((await getSettings()).nameSpeakingRate);
  const rate = raw >= 0.5 && raw <= 2 ? raw : 1.1;
  if (process.env.GOOGLE_TTS_API_KEY) return void target.play(nameVoiceLink(t, rate));
  target.say(voice(), "").prosody({ rate: `${Math.round(rate * 100)}%` }, spokenSpelling(t));
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
  // Nov 23, 2026 (Abraham): every recorded piece plays; the live voice only says a piece with no recording yet
  const mixed = composeMixed(ctx.prompts, key, vars ?? {});
  if (mixed) {
    if (vars) logVoice(ctx.prompts, key, mixed);
    return void mixed.forEach((p) => ("url" in p ? target.play(p.url) : say(target, p.say)));
  }
  // Option B (Owner switch, off): Google speaks the line in Achird; otherwise the live voice (Puck)
  if (vars && googleLiveOn(ctx.prompts)) return void target.play(liveVoiceLink(spokenSpelling(promptText(ctx.prompts, key, vars))));
  // Abraham, Nov 19, 2026: in a menu, a plain half-second pause after each option (Hark's recordings have it)
  if (isGather(target) && process.env.IVR_OPTION_PAUSES !== "off") return sayOptions(target, promptText(ctx.prompts, key, vars));
  say(target, promptText(ctx.prompts, key, vars));
}

const isGather = (t: VR | Gather): t is Gather => t.constructor?.name === "Gather";

/**
 * Which parts of a line with changing parts played from a recording and which in the live voice (Abraham, Nov 24, 2026:
 * shown in the call log for every step). Kept per request; handleVoice writes it to the call journey.
 */
const VOICE_LOG = new WeakMap<PromptOverrides, string[]>();
function logVoice(prompts: PromptOverrides, key: string, pieces: LinePiece[]) {
  const rec = pieces.filter((p) => "url" in p).length;
  const live = pieces.flatMap((p) => ("say" in p ? [`"${p.say.trim()}"`] : []));
  const list = VOICE_LOG.get(prompts) ?? [];
  list.push(`${key}: ${rec} recorded${live.length ? `, live voice: ${live.join(", ")}` : ", nothing live"}`);
  VOICE_LOG.set(prompts, list);
}

/**
 * "You typed: {value}." / "I heard: {value}." for a street or a unit (Abraham, Nov 24, 2026, bug 5): the street plays its
 * street recording when it is on our list, the unit its unit recording, else its digits and letters one by one, the same
 * parts as the address read-back. Other answers: the usual line.
 */
function readBackLine(g: Gather, ctx: Ctx, key: "typed_back" | "heard", f: Field, value: string) {
  if (f !== "street" && f !== "unit") return sp(g, ctx, key, { value: FIELDS[f].readBack(value) });
  const prefix = promptText(ctx.prompts, key, { value: "" }).replace(/[\s.]+$/, "");
  const pre = clipUrls(ctx.prompts, [`${key}#1`]);
  const listed = f === "street" ? findStreet(value) : null;
  const options: string[][] =
    f === "street"
      ? [[streetSlotKey(listed?.spoken ?? value)]]
      : [[unitSlotKey(value)], value.replace(/[^0-9A-Za-z]/g, "").split("").map((c) => (/\d/.test(c) ? `word:${["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][Number(c)]}` : `letter:${c.toLowerCase()}`))];
  const urls = options.map((k) => clipUrls(ctx.prompts, k)).find(Boolean);
  const pieces: LinePiece[] = [pre ? { url: pre[0] } : { say: prefix }, ...(urls ? urls.map((url) => ({ url })) : [{ say: listed?.spoken ?? value }])];
  logVoice(ctx.prompts, key, pieces);
  pieces.forEach((p) => ("url" in p ? g.play(p.url) : say(g, p.say)));
}

/** Text with numbers, days and times (Key 7 hours): word by word from the recordings, only missing words live. */
function playText(target: VR | Gather, ctx: { prompts: PromptOverrides }, text: string, label = "text") {
  const pieces = textPieces(ctx.prompts, text);
  if (!pieces) {
    logVoice(ctx.prompts, label, [{ say: text }]);
    return say(target, text);
  }
  logVoice(ctx.prompts, label, pieces);
  pieces.forEach((p) => ("url" in p ? target.play(p.url) : say(target, p.say)));
}

/** Splits a menu line after each "press ..." option and puts a half-second pause between them (computer voice). */
export function optionParts(text: string): string[] {
  return text.split(/(?<=\bpress (?:\d+(?: \d)?|star|pound|the star key|the pound key)[.!])\s+/i).map((x) => x.trim()).filter(Boolean);
}

function sayOptions(g: Gather, text: string) {
  optionParts(text).forEach((part, i) => {
    if (i) halfPause(g);
    say(g, part);
  });
}

/** A part said live between recordings (digits, a key): Hark's word clips, else Google Achird, else the live voice. */
function sayLive(target: VR | Gather, ctx: { prompts: PromptOverrides }, text: string) {
  const clips = liveClips(ctx.prompts, text);
  if (clips) return void clips.forEach((u) => target.play(u));
  if (googleLiveOn(ctx.prompts)) return void target.play(liveVoiceLink(spokenSpelling(text)));
  say(target, text);
}

/**
 * The one shared back line (Abraham, Nov 20, 2026): after every prompt that asks for a key press, a half-second
 * pause, then "To go back, press star." Star goes back one step. Not on the main menu, typing, address steps, the
 * voicemail offer, the staff voicemail box or the hear-again lines.
 */
/** The shared Confirm ending after a confirm or read-back line (Abraham, Nov 23, 2026): 1 confirms, 2 tries again. */
function confirmEnd(g: Gather, ctx: { prompts: PromptOverrides }) {
  sp(g, ctx, "confirm_ending");
}

function backLine(g: Gather, ctx: { prompts: PromptOverrides }) {
  halfPause(g);
  sp(g, ctx, "book_back");
}

/**
 * A menu's fixed lines (Abraham, Nov 26, 2026): the whole-menu recording (slot whole_<id>) when one is chosen in
 * Admin and these are exactly its lines; else each line on its own, as before ("star" = the shared go-back line with
 * its half pause, "pause" = a half pause).
 */
function menuRun(g: Gather, ctx: { prompts: PromptOverrides }, id: string, parts: readonly string[]) {
  const whole = `whole_${id}` as PromptKey;
  const combo = MENU_COMBOS[id];
  if (combo && ctx.prompts[whole]?.recordingId && combo.join("|") === parts.join("|")) return void sp(g, ctx, whole);
  for (const part of parts) {
    if (part === "star") backLine(g, ctx);
    else if (part === "pause") halfPause(g);
    else sp(g, ctx, part as PromptKey);
  }
}

export const BOOK_R3C_LIVE = false;
/** Box 148's dates line (Nov 25, 2026, 4:43 PM): off until Abraham approves the exact words (5:50 PM). */
export const PAY_DATES_LIVE = false;

/** A menu made of several recordings, in the order the Owner set in Admin (src/lib/ivr/menu-order.ts). */
async function playMenu(g: Gather, ctx: Ctx, menu: MenuId, items?: (g: Gather) => void | Promise<void>, opts: { firstTime?: boolean } = {}) {
  const order = menuOrder(menu, (await getSettings()).menuOrders).filter((part) => !(FIRST_TIME_ONLY.has(part) && opts.firstTime === false));
  // The bookings menu as one recording (Nov 26, 2026), when chosen and the lines are its lines in its order
  if (menu === "book" && !BOOK_R3C_LIVE) {
    const parts = order.map((x) => (x === "book_back" ? "star" : x));
    const id = opts.firstTime === false ? "book_again" : "book";
    if (ctx.prompts[`whole_${id}` as PromptKey]?.recordingId && MENU_COMBOS[id].join("|") === parts.join("|")) return menuRun(g, ctx, id, parts);
  }
  for (const part of order) {
    if (part === "balloon_items") await items?.(g);
    else if (part === "book_back") backLine(g, ctx);
    else sp(g, ctx, part);
    // 3c (customer service hours) plays right after 3a once its new wording is in. Off (Abraham, Nov 25, 2026, 4:50 PM):
    // the hours changed, so "11 AM to 4 PM" is wrong; the slot keeps its text and waits for new wording.
    if (part === "book_r3a" && BOOK_R3C_LIVE) sp(g, ctx, "book_r3c");
  }
}

function pause(target: VR | Gather, seconds = 1) {
  target.pause({ length: seconds });
}

function keypad(vr: VR, action: string, opts: { numDigits?: number; timeout?: number; finishOnKey?: string } = {}) {
  return vr.gather({
    input: ["dtmf"],
    numDigits: opts.numDigits ?? 1,
    timeout: opts.timeout ?? NO_KEY_SECONDS,
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

/**
 * A line waiting for Abraham's OK that must still work now (item taken offers, Nov 25, 2026, 8:08 PM): its exact text in
 * the live voice until approved, then the slot (and its recording) like every line.
 */
function heldLine(target: VR | Gather, ctx: { prompts: PromptOverrides }, key: PromptKey, vars?: Record<string, string | number>) {
  if (promptWaiting(ctx.prompts, key)) say(target, promptText(ctx.prompts, key, vars));
  else sp(target, ctx, key, vars);
}

/** The open day next to a date (closed days skipped), within today and the 3-month limit; null past the limits. */
function openDayNear(date: string, dir: 1 | -1, cal: Awaited<ReturnType<typeof getSettings>>): string | null {
  const today = todayISO();
  const last = lastPhoneDate(today);
  for (let i = 1; i <= 10; i++) {
    const x = addDays(date, dir * i);
    if (x < today || x > last) return null;
    if (checkEventDate(x, cal).ok) return x;
  }
  return null;
}

/** Item taken, key 2: the open day before and after if free; else the nearest free dates before and after. */
async function takenDays(p: { id: number; quantity: number }, date: string, cal: Awaited<ReturnType<typeof getSettings>>) {
  const today = todayISO();
  const last = lastPhoneDate(today);
  const b = openDayNear(date, -1, cal);
  const a = openDayNear(date, 1, cal);
  const [okB, okA] = await Promise.all([b ? itemFreeOn(p, b, cal) : false, a ? itemFreeOn(p, a, cal) : false]);
  if (okB || okA) return { near: true, before: okB ? b : null, after: okA ? a : null };
  const inRange = (x: string | null) => (x && x >= today && x <= last ? x : null);
  const [before, after] = await Promise.all([nearestFreeDay(p, date, -1, cal, 1), nearestFreeDay(p, date, 1, cal, 1)]);
  return { near: false, before: inRange(before), after: inRange(after) };
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
/** System-wide no key (Abraham, Nov 22, 2026): 5 seconds, then the no-choice line and the same screen again. */
export const NO_KEY_SECONDS = 5;
/** The call ends only after 1 full minute with no key, counted from when the screen finished playing. */
export const NO_KEY_END_MS = 60_000;
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
  if (action !== "menu") return idleNoKey(vr, ctx, action, params); // Nov 22, 2026: only the main menu keeps its 3 plays
  const np = Number(ctx.query.get("np") || 0) + 1;
  const t0 = Number(ctx.query.get("t0")) || Date.now();
  vr.redirect({ method: "POST" }, url("no-key", { ...encodeTo(action, params), np, t0 }));
  return vr;
}

/**
 * Box 30 (Abraham, Nov 24, 2026): the cart's hold ran out (the caller stopped responding): the call just ends. No
 * "cart timed out" line and no return to the main menu.
 */
async function cartGone(vr: VR, ctx: Ctx) {
  await track(ctx.callSid, "step", "Cart hold ran out (no keys pressed): call ended");
  vr.hangup();
  return vr;
}

/**
 * Box 48 (Abraham, Nov 25, 2026): "We have {number}." with the digits one at a time, then the existing box 144 ending
 * "If that is correct, press 1. To enter a different number, press 2." (its recording), then the star line.
 */
function box48(g: Gather, ctx: Ctx, e164: string) {
  sp(g, ctx, "phone_heard", { number: spokenPhone(e164) });
  const ending = clipUrls(ctx.prompts, ["text_heard#2"]);
  if (ending) ending.forEach((u) => g.play(u));
  else say(g, (promptText(ctx.prompts, "text_heard", { number: "\u0000" }).split("\u0000")[1] ?? "").replace(/^[\s.]+/, ""));
  backLine(g, ctx);
}

/**
 * Name rules (Abraham, Nov 25, 2026): an address found in the directory uses that household's name (even when another
 * family member calls); not found = the name the caller gave. The caller's own answer is kept to fall back to.
 */
async function applyDirectoryMatch(ctx: Ctx, a: { house: string; street: string; unit: string | null; zip: string }) {
  const { matchDirectoryAddress, householdName } = await import("@/lib/directory");
  const data = ctx.session?.data ?? {};
  const callerName = data.dirMatchId ? data.callerName : data.name;
  const hit = await matchDirectoryAddress(a);
  const name = hit ? householdName(hit) : "";
  if (hit && name) {
    await updateSession(ctx.callSid, { data: { name, nameFromDirectory: true, dirMatchId: hit.id, callerName: callerName ?? undefined } }, ctx.session);
    await track(ctx.callSid, "step", `Directory address match: household ${name}${callerName ? ` (the caller said ${callerName})` : ""}`);
  } else if (data.dirMatchId) {
    // The address changed and no longer matches: back to the caller's own name
    await updateSession(ctx.callSid, { data: { name: callerName ?? undefined, nameFromDirectory: undefined, dirMatchId: undefined, callerName: undefined } }, ctx.session);
  }
}

/**
 * Box 56 (Abraham, Nov 24, 2026, 21:02): "Your order number is {number}." "Your total is {total}." "That includes
 * {amount} {type}, ... {delivery} for delivery, and {tax} sales tax." One amount and type clip per rental kind (its own
 * subtotal; plural clip for more than one), no quantity. Every recorded piece plays; until the pieces and type clips
 * are recorded, the line is said whole in the live voice.
 */
async function box56(vr: VR, ctx: Ctx, orderId: number, days: { order: { id: number }; items: { productId: number; qty: number; unitPriceCents: number; name: string }[] }[], subtotals: number[], totals: { deliveryFeeCents: number; taxCents: number; totalCents: number }) {
  const { box56Groups, typeClip, typeSlotKey } = await import("@/lib/box56");
  const ids = [...new Set(days.flatMap((d) => d.items.map((i) => i.productId)))];
  const cats = ids.length ? await db.select({ id: products.id, cat: categories.name }).from(products).innerJoin(categories, eq(categories.id, products.categoryId)).where(inArray(products.id, ids)) : [];
  const catOf = new Map(cats.map((c) => [c.id, c.cat]));
  const groups = box56Groups(days.map((d, i) => ({ subtotalCents: subtotals[i] ?? 0, lines: d.items.map((it) => ({ categoryName: catOf.get(it.productId) ?? "", productName: it.name, qty: it.qty, cents: it.qty * it.unitPriceCents })) })));
  sp(vr, ctx, "checkout_order_number", { number: spokenDigits(orderNumber(orderId)) });
  sp(vr, ctx, "checkout_total", { total: spokenMoney(totals.totalCents) });
  const piece = (n: number) => clipUrls(ctx.prompts, [`checkout_includes#${n}`]);
  const parts = groups.map((g) => ({ amount: spokenMoney(g.cents), clip: typeClip(g), urls: clipUrls(ctx.prompts, [typeSlotKey(g.kind, g.count > 1)]) }));
  const whole = `${promptText(ctx.prompts, "checkout_includes", { amount: "\u0000", type: "\u0001", delivery: spokenMoney(totals.deliveryFeeCents), tax: spokenMoney(totals.taxCents) })}`.replace("\u0000 \u0001", parts.map((p) => `${p.amount} ${p.clip}`).join(", "));
  await track(ctx.callSid, "step", `Box 56: ${whole}`);
  if (![1, 2, 3].some((n) => piece(n)) && !parts.some((p) => p.urls)) return say(vr, whole);
  // Piece by piece: "That includes", each amount + type clip, the delivery amount, "for delivery, and", the tax, "sales tax."
  const play = (urls: string[] | null, text: string) => (urls ? urls.forEach((u) => vr.play(u)) : say(vr, text));
  const texts = promptText(ctx.prompts, "checkout_includes").split(/\{[a-z0-9_]+\}/i).map((t) => t.trim()).filter((t) => /[a-z]/i.test(t));
  play(piece(1), texts[0] ?? "");
  for (const p of parts) {
    playText(vr, ctx, p.amount, "box 56 amount");
    play(p.urls, p.clip);
  }
  playText(vr, ctx, spokenMoney(totals.deliveryFeeCents), "box 56 delivery");
  play(piece(2), texts[1] ?? "");
  playText(vr, ctx, spokenMoney(totals.taxCents), "box 56 tax");
  play(piece(3), texts[2] ?? "");
}

/** The call to Sola can be placed (Twilio and the hotline number are set). */
async function payLegPossible() {
  const { getTwilio } = await import("@/lib/twilio-client");
  return Boolean(getTwilio() && process.env.TWILIO_PHONE_NUMBER);
}

/**
 * Did this caller agree to order texts (Abraham, Nov 25, 2026)? The order's text number (or the customer's phone, or
 * the number given on this call) has an order-text consent.
 */
async function orderTextsAgreed(ctx: Ctx, orderId: number): Promise<boolean> {
  const full = orderId ? await getOrderWithItems(orderId) : null;
  const phone = (full ? orderTextPhone(full.order, full.customer) : null) ?? ctx.session?.data.phone ?? toE164(ctx.from);
  if (!phone) return false;
  if ((ctx.session?.data.smsConsent === "yes" || ctx.session?.data.smsConsent === "existing") && (!ctx.session?.data.phone || ctx.session.data.phone === phone)) return true;
  return (await consentState(phone)).transactional?.action === "opt_in";
}

/** The number every text for this order (and its other rental days) goes to from now on. */
async function setOrderTextPhone(orderId: number, phone: string) {
  const [o] = await db.select({ group: orders.paymentGroupId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  const ids = o?.group ? (await db.select({ id: orders.id }).from(orders).where(eq(orders.paymentGroupId, o.group))).map((x) => x.id) : [orderId];
  await db.update(orders).set({ textPhone: phone, updatedAt: new Date() }).where(inArray(orders.id, [...new Set([orderId, ...ids])]));
}

/** A +1 number read in three groups, the same way as the phone read-back ("eight four five, ..."). */
function spokenPhone(e164: string) {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `${spokenDigits(d.slice(0, 3))}, ${spokenDigits(d.slice(3, 6))}, ${spokenDigits(d.slice(6))}`;
}

/** Inside a booking: the fallthrough after a step with no key (the idle clock decides). */
function idleNoKey(vr: VR, ctx: Ctx, action: string, params: Record<string, string | number | undefined> = {}) {
  // nk = when the screen first finished with no key (kept while the caller keeps not pressing; a key press drops it)
  vr.redirect({ method: "POST" }, url("idle", { ...encodeTo(action, params), nk: ctx.query.get("nk") ?? undefined }));
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
async function hotlineClosed(ctx: Ctx, vr: VR, n = 0): Promise<VR | null> {
  const lock = bookingLock(calendarNow(), await getSettings());
  const closedKey = lock.reason === "Yom Tov" ? "closed_yomtov_greeting" : "closed_shabbos_greeting";
  if (!lock.locked || (process.env.VERCEL_ENV === "production" && promptWaiting(ctx.prompts, closedKey))) return null;
  const opens = lock.opensAt ?? new Date();
  const vars = {
    day: opens.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" }),
    time: opens.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }),
  };
  await updateSession(ctx.callSid, { outcome: "voicemail", data: { missed: "closed" } }, ctx.session);
  // Shabbes (candle lighting until 2 minutes after Rabbeinu Tam) and Yom Tov: the closed message, the tone, the general
  // voicemail; no key works (pound skips the message to the tone, as in every voicemail greeting)
  const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 1, finishOnKey: "#", actionOnEmptyResult: true, action: url("closed-key", { n: n || undefined }), method: "POST" });
  sp(g, ctx, closedKey, vars, { draftOk: true });
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

/** Directory lookup by caller ID: preview only until Abraham approves its lines (Nov 23, 2026). */
export const directoryLookupOn = (env: Record<string, string | undefined> = process.env) => env.VERCEL_ENV === "preview" || env.DIRECTORY_LOOKUP === "on";

/** Box 25's live parts: "{Qnt} {item}" (singular for 1) and the date, or both dates after box 18 key 2. */
export function addedVars(a: { name: string; qty: number; date: string; date2?: string }) {
  // Abraham, Nov 25, 2026, 2:02 PM: the quantity and item name only; never the date (already confirmed) or the item number
  // An add-on named with its own count ("500 ocean balls") is said as named, with no count in front (Batch 3 item 4)
  if (/^\d/.test(a.name.trim())) return { qty: "" as const, item: a.name };
  return { qty: a.qty, item: a.qty === 1 ? a.name : pluralName(a.name) };
}

/**
 * Box 18's second day (Abraham, Nov 22, 2026): the next day, only when it is open and the item is free through its
 * pickup; "{price} more" = half the one-day price (the full one-day price on Chanukah and Chol Hamoed).
 */
async function secondDay(p: { id: number; quantity: number; priceCents: number }, date: string) {
  const cal = await getSettings();
  const next = addDays(date, 1);
  if (dayInfo(next, cal).closed) return null;
  const after = pickupDateFor(next, cal as never);
  if ((await checkBookable(p.id, p.quantity, date, db, after)) <= 0) return null;
  const days = perDayRules(date, cal as never) || perDayRules(next, cal as never) ? 2 : 1.5;
  return { next, after, days, moreCents: Math.round(p.priceCents * (days - 1)) };
}

/** Laser tag sets and paddle boat packages get a second one offered in box 25 (Abraham, Nov 22, 2026). */
async function secondOneKind(categoryId: number): Promise<"laser" | "paddle" | null> {
  if (await isLaserBase(categoryId)) return "laser";
  const [cat] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId));
  return cat && /paddle/i.test(cat.name) ? "paddle" : null;
}

/** An inflatable maze (Abraham, Nov 19, 2026: the laser guns add-on plays ONLY right after a maze is added). */
async function isMaze(p: { name: string; categoryId: number }) {
  return /maze/i.test(p.name) && (await isLaserBase(p.categoryId));
}

type ResumeLine = NonNullable<CallSession["data"]["resumeLines"]>[number];

const RESUME_PROMPTS = ["resume_offer"] as const;

/** Unfinished-cart offer: once Abraham approves its two lines; on preview it runs for his test. */
function resumeActive(ctx: Ctx, env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV !== "production" || RESUME_PROMPTS.every((k) => !promptWaiting(ctx.prompts, k));
}

/**
 * Welcome back (Abraham, Nov 23, 2026): only when this number's LAST call ended with at least one item still in the
 * cart (the caller hung up with it). Not when that call ended with an empty cart (nothing added, everything removed,
 * or the cart cleared), never for a paid order, and only items whose dates have not passed.
 */
async function unfinishedCart(ctx: Ctx): Promise<{ productId: number; name: string; qty: number; date: string }[]> {
  const from = toE164(ctx.session?.fromNumber ?? ctx.from);
  if (!from) return [];
  const [last] = await db
    .select({ callSid: schema.callSessions.callSid, data: schema.callSessions.data })
    .from(schema.callSessions)
    .where(and(eq(schema.callSessions.fromNumber, from), sql`${schema.callSessions.callSid} <> ${ctx.callSid}`))
    .orderBy(desc(schema.callSessions.startedAt))
    .limit(1);
  const left = (last?.data?.cartLeft ?? []).filter((n) => Number.isInteger(n));
  if (!last || !left.length) return [];
  // that call placed an order (paid or waiting for payment): no welcome back
  const [placed] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.callSid, last.callSid), sql`${orders.status} <> 'CANCELLED'`)).limit(1);
  if (placed) return [];
  const rows = await db
    .select({ productId: orderItems.productId, qty: orderItems.qty, date: orders.eventDate, name: products.name, paid: orders.paidCents })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(inArray(orders.id, left), eq(orders.status, "CANCELLED")));
  const today = todayISO();
  return rows.filter((r) => !r.paid && r.date >= today).map(({ paid: _p, ...r }) => r).sort((a, b) => a.date.localeCompare(b.date));
}


/** The address in steps (Abraham, Nov 17, 2026): on preview now; on the live line once every draft step is approved. */
export const ADDRESS_STEP_DRAFTS: PromptKey[] = ["addr_house", "addr_unit", "addr_zip", "addr_zip_enter", "addr_zip_bad", "addr_outside", "addr_not_found", "addr_rb_intro", "addr_saved_price"];
function addrStepsActive(ctx: Ctx, env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV !== "production" || ADDRESS_STEP_DRAFTS.every((k) => !promptWaiting(ctx.prompts, k));
}

/**
 * Enter the address manually (or nobody found): the name first, with its tone and retry (box 31), then the house
 * number; when the name is already given, straight to the house number (Nov 23, 2026).
 */
async function manualAddress(ctx: Ctx, vr: VR) {
  const data = ctx.session?.data ?? {};
  await updateSession(ctx.callSid, { data: { lookupDone: true, ...(data.nameFromDirectory ? { name: undefined, nameFromDirectory: undefined } : {}) } }, ctx.session);
  return data.name && !data.nameFromDirectory ? back(vr, "addr-house") : back(vr, "ask", { f: "name" });
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

/** "{Qnt} {item}" (Abraham, Nov 19, 2026): the number, then the name (singular for 1, plural for 2 or more). */
function itemPhrase(qty: number, name: string) {
  return `${qty} ${qty === 1 ? name : pluralName(name)}`;
}

/** "1 Castle Combo, and 2 paddle boats": "and" before the second item on. */
const itemsPhrase = (items: { qty: number; name: string }[]) => {
  // the same item on several lines (laser items keep one line each, Nov 24, 2026) is said once, with its total
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.name, (merged.get(i.name) ?? 0) + i.qty);
  return [...merged].map(([name, qty]) => itemPhrase(qty, name)).join(", and ");
};

type CartLine = { itemId: number; orderId: number; name: string; qty: number; date: string };

/** Every item in the cart, in cart order (day by day). */
async function cartLines(ctx: Ctx): Promise<CartLine[]> {
  const out: CartLine[] = [];
  for (const o of await callOrders(ctx)) for (const i of o.items) out.push({ itemId: i.id, orderId: o.order.id, name: i.name, qty: i.qty, date: o.order.eventDate });
  return out;
}

/**
 * Item removed (box 29a): "Successfully removed from your cart: {Qnt} {item} for {date}." Items left: "Here is your
 * updated cart." and the cart again; the last item: the empty cart line, then straight to the bookings menu.
 */
async function removeFromCart(ctx: Ctx, vr: VR, l: CartLine, n: number) {
  if (n >= l.qty) await db.delete(schema.orderItems).where(eq(schema.orderItems.id, l.itemId));
  else await db.update(schema.orderItems).set({ qty: l.qty - n }).where(eq(schema.orderItems.id, l.itemId));
  // A removed maze takes its additional gun packs with it (Abraham, Nov 24, 2026); the usual "removed" line plays for
  // the maze only (no new wording without his OK)
  const packs = await dropOrphanPacks(db, l.orderId);
  if (packs) await track(ctx.callSid, "step", `Removed the additional gun packs with the maze (${packs} line${packs > 1 ? "s" : ""})`);
  const [left] = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(eq(schema.orderItems.orderId, l.orderId)).limit(1);
  if (left) await refreshOrderTotals(l.orderId); // a removed maze drops the laser gun add-ons back to their own price
  else await cancelHold(l.orderId, "Removed from the cart by the caller");
  await track(ctx.callSid, "step", `Removed ${itemPhrase(n, l.name)} for ${spokenDate(l.date)}`, { item: l.name, qty: n, date: l.date });
  sp(vr, ctx, "removed", { qty: n, item: n === 1 ? l.name : pluralName(l.name), date: spokenDate(l.date) });
  if (!(await callOrders(ctx)).length) {
    await updateSession(ctx.callSid, { orderId: null, outcome: "browsing", data: { dayOrderIds: [], day: undefined } }, ctx.session);
    sp(vr, ctx, "cart_empty");
    return back(vr, "book");
  }
  return back(vr, "cart", { u: 1 });
}



async function customerByPhone(phone: string) {
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  return c ?? null;
}

/** The three types of attraction on keys 2 and 3 (Abraham W). */
const ATTRACTIONS = {
  "1": { label: "jumping balloons", instr: "instr_balloons", learn: "learn_balloons", match: /balloon|bounce|jump|inflatable(?!.*maze)/i },
  // Laser tag (Abraham, Nov 25, 2026, 1:28 PM): three approved parts, played one after the other
  "2": { label: "laser tag", instr: ["instr_laser_1", "instr_laser_2", "instr_laser_3"], learn: "learn_laser", match: /laser/i },
  "3": { label: "paddle boats", instr: "instr_paddle", learn: "learn_paddle", match: /paddle|boat/i },
} as const;

function attractionMenu(ctx: Ctx, vr: VR, m: "i" | "l") {
  const g = keypad(vr, url("attraction-choice", { m }));
  if (m === "i") {
    menuRun(g, ctx, "instr_menu", ["instr_menu", "star"]);
    return repeatMenu(vr, ctx, "instructions", { again: 1 });
  }
  if (!ctx.query.get("again")) sp(g, ctx, "learn_intro");
  menuRun(g, ctx, "attraction_choice", ["attraction_choice", "star"]);
  return repeatMenu(vr, ctx, "learn", { again: 1 });
}

/** The Admin category for a type (by name, so a rename in Admin still works; else the one on that booking key). */
async function attractionCategory(t: "1" | "2" | "3") {
  const cats = await phoneCategories();
  return cats.find((c) => ATTRACTIONS[t].match.test(c.name)) ?? cats.find((c) => String(c.ivrDigit) === t) ?? null;
}

/** Is this item in the bounce house (jumping balloons) category? */
/**
 * The laser tag list (box 13b, Abraham, Nov 22, 2026): keys 1 to 4 are fixed recordings, found by name (maze with 6
 * guns, maze with 4 guns, 6 guns, 4 guns); any other laser tag item follows on key 5 and up, as before.
 */
const LASER_KEYS: { key: number; line: PromptKey; match: (n: string) => boolean }[] = [
  { key: 1, line: "laser_item_1", match: (n) => /maze/i.test(n) && /\b6\b|six/i.test(n) },
  { key: 2, line: "laser_item_2", match: (n) => /maze/i.test(n) && /\b4\b|four/i.test(n) },
  { key: 3, line: "laser_item_3", match: (n) => !/maze/i.test(n) && /^\s*(6|six)\b[^]*laser guns/i.test(n) },
  { key: 4, line: "laser_item_4", match: (n) => !/maze/i.test(n) && /^\s*(4|four)\b[^]*laser guns/i.test(n) },
];
function laserList<T extends { name: string }>(items: T[]): { p: T; key: number; line: PromptKey | null }[] {
  const out: { p: T; key: number; line: PromptKey | null }[] = [];
  const used = new Set<T>();
  for (const k of LASER_KEYS) {
    const p = items.find((x) => !used.has(x) && k.match(x.name));
    if (p) {
      used.add(p);
      out.push({ p, key: k.key, line: k.line });
    }
  }
  let next = 5;
  for (const p of items) if (!used.has(p)) out.push({ p, key: next++, line: null });
  return out;
}

/** A category's phone items; with a date (item taken, key 1), only the items free on that date (Nov 20, 2026). */
async function listItems(c: number, f: string | null) {
  const items = await phoneProducts(c);
  if (!f) return items;
  const cal = await getSettings();
  const free = await Promise.all(items.map((p) => itemFreeOn(p, f, cal)));
  return items.filter((_, i) => free[i]);
}

/** The kind of item, singular, for "the closest available {category}" (Abraham, Nov 19, 2026). */
async function singularCategory(categoryId: number) {
  const [cat] = await db.select({ name: categories.name, spoken: categories.spokenName }).from(categories).where(eq(categories.id, categoryId));
  const n = cat?.name ?? "";
  if (ATTRACTIONS["1"].match.test(n)) return "jumping balloon";
  if (/laser/i.test(n)) return "laser tag set";
  if (/paddle|boat/i.test(n)) return "paddle boat";
  return (cat?.spoken || n).toLowerCase().replace(/s$/, "");
}

/** A laser tag item that uses the shared gun packs (maze with guns, guns only, additional packs). */
async function isLaserItem(p: { name: string; categoryId: number }) {
  const [cat] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, p.categoryId));
  return Boolean(cat && laserPoolsFor(p.name, cat.name).length);
}

/** The first rental day in the cart with a jumping balloon and no ocean balls yet, or null. */
/** The date of a jumping balloon in the cart (the first one), with or without balls already (Nov 25, 2026, 14:08). */
async function cartBalloonDay(ctx: Ctx): Promise<string | null> {
  for (const o of await callOrders(ctx)) {
    for (const i of o.items) {
      const [p] = await db.select({ categoryId: products.categoryId }).from(products).where(eq(products.id, i.productId));
      if (p && (await isBounceHouse(p.categoryId))) return o.order.eventDate;
    }
  }
  return null;
}

/** The extra gun packs (1 = six-pack, 2 = four-pack) and whether each still has one for this rental. */
async function packOffer(ctx: Ctx, date: string) {
  const packs = await addOnProducts(LASER_ADDONS_CATEGORY);
  const full = await db.select({ id: products.id, quantity: products.quantity }).from(products).where(inArray(products.id, packs.map((x) => x.id).concat(0)));
  const qty = new Map(full.map((x) => [x.id, x.quantity]));
  const free = await Promise.all(packs.map(async (x) => (await checkBookable(x.id, qty.get(x.id) ?? 0, date, db, keptPickup(ctx, date))) > 0));
  return packs.map((x, i) => ({ ...x, key: String(i + 1), free: free[i] }));
}

/**
 * What the next extra gun set of this kind would cost on this booking (Abraham, Nov 25, 2026, 14:41): read from the
 * catalog through the same price rule the order uses (add-on price with a maze, regular price without; every 3rd set
 * half price). Before tax.
 */
async function nextSetPrice(orderId: number, productId: number): Promise<number> {
  const { laserAddonPrices } = await import("@/lib/orders");
  const r = await db.execute(sql`
    SELECT oi.id AS key, p.name, c.name AS cat, p.price_cents FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
    WHERE oi.order_id = ${orderId} ORDER BY oi.id`);
  const rows = (r.rows as { key: number; name: string; cat: string; price_cents: number }[]).map((x) => ({ key: Number(x.key), name: x.name, cat: x.cat, priceCents: Number(x.price_cents) }));
  const [p] = await db.select({ name: products.name, price: products.priceCents, cat: categories.name }).from(products).innerJoin(categories, eq(categories.id, products.categoryId)).where(eq(products.id, productId));
  const next = { key: Number.MAX_SAFE_INTEGER, name: p.name, cat: p.cat, priceCents: p.price };
  return (await laserAddonPrices(db, [...rows, next])).get(next.key) ?? p.price;
}

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
  "4": "questions or problems during a rental",
  "5": "delivery and pickup",
  "6": "learn about our rentals",
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
    `heard: "${promptText(ctx.prompts, "promo_ask")} ${promptText(ctx.prompts, "skip_pound")}"`;
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
  return websiteHoursLines(s, true, true).flatMap((l) => l.split("\n")).map((l) => `${l.replace(/ - /g, " to ").trim()}.`);
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

/**
 * The held order on this call for this rental day with the same pickup and span (audit H1, Nov 24, 2026): a rental kept
 * for the next day too (Box 18 key 2) or a closed day booked from the day before is its own order, so its pickup day and
 * its 1.5x never touch the other items booked for that date.
 */
async function dayOrder(ctx: Ctx, date: string) {
  const span = ctx.session?.data.spanDays?.[date];
  const pickup = keptPickup(ctx, date) ?? pickupDateFor(date, await getSettings());
  return (await callOrders(ctx)).find((o) => o.order.eventDate === date && o.order.pickupDate === pickup && (o.order.spanDays ?? null) === (span?.days ?? null)) ?? null;
}

/** A plain booking for this date (Box 18 key 1, or a date confirmed): no next-day span left over from earlier. */
async function clearSpan(ctx: Ctx, date: string) {
  const spans = { ...(ctx.session?.data.spanDays ?? {}) };
  if (!spans[date]) return;
  delete spans[date];
  await updateSession(ctx.callSid, { data: { spanDays: spans } }, ctx.session);
  if (ctx.session) ctx.session.data.spanDays = spans;
}

/** This day becomes the one being shopped for on the call; an order already held for the same rental is reused. */
async function chooseDay(ctx: Ctx, date: string) {
  const sameDay = await dayOrder(ctx, date);
  await updateSession(ctx.callSid, { orderId: sameDay?.order.id ?? null, data: { day: date } }, ctx.session);
}

/** The pickup day kept for this rental day on the call: Sunday for Friday plus Mutze Shabbes, else the usual rule. */
function keptPickup(ctx: Ctx, date: string): string | undefined {
  const span = ctx.session?.data.spanDays?.[date];
  if (span) return span.after; // a closed day booked from the day before (Nov 20, 2026)
  return (ctx.session?.data.mutzeDays ?? []).includes(date) ? friMutzePickup(date) : undefined;
}

/** Box 149: "For Friday and Mutze Shabbes, you will be charged for only one and a half days, a total of {price}. ..." */
async function sayFriMutzePrice(target: VR | Gather, ctx: Ctx, friday: string, priceCents: number) {
  const days = friMutzeDays((await getSettings()) as never);
  sp(target, ctx, "fri_mutze_price", { price: spokenMoney(Math.round(priceCents * days)), date: spokenDate(friMutzePickup(friday)) });
}

/**
 * Box 150 keys (Abraham, Nov 18, 2026): pound = Friday only; 1 = keep the rental for Mutze Shabbes (picked up Sunday
 * 9:00 AM), then box 149; 2 = a different date. The Friday only line is not approved yet (preview only).
 */
async function friMutzeChoice(ctx: Ctx, vr: VR, p: string | undefined, date: string, d: string | undefined) {
  // Approved Nov 24, 2026: 1 = correct (Friday only), 2 = keep it for Mutze Shabbes, 3 or star = a different date;
  // pound or any other key is not valid
  if (d === "3" || d === "*") return back(vr, "date", { p });
  if (d !== "1" && d !== "2") {
    if (d) sp(vr, ctx, "not_valid");
    return back(vr, "date-ask", { p, d: date });
  }
  d = d === "2" ? "1" : "#"; // the code below: "1" keeps it for Mutze Shabbes, "#" is Friday only
  await chooseDay(ctx, date);
  const kept = new Set(ctx.session?.data.mutzeDays ?? []);
  const prod = p ? await getProduct(Number(p)) : null;
  if (d === "1") {
    kept.add(date);
    await track(ctx.callSid, "step", `Friday ${spokenDate(date)} kept for Mutze Shabbes`, { date });
    if (prod) await sayFriMutzePrice(vr, ctx, date, prod.priceCents);
  } else {
    kept.delete(date);
    if (prod) spPreviewDraft(vr, ctx, "fri_only", { price: spokenMoney(prod.priceCents) });
  }
  await updateSession(ctx.callSid, { data: { mutzeDays: [...kept], mutzeAnnounce: d === "1" && !prod ? date : undefined } });
  return p ? back(vr, "qty", { p, d: date }) : back(vr, "cats"); // another day: the categories (audit H1)
}

/**
 * Box 156: the Owner's customer discount on this booking ("ten percent" / "twenty five dollars"), and the total before
 * it (rentals without the discount, with their own delivery and tax). Null when there is no customer discount.
 */
export function customerDiscountLine(days: { note: string | null; discountCents: number; zone: string; feeCents: number; subtotalCents: number }[], s: Parameters<typeof totalsWithFee>[3]): { spoken: string; beforeCents: number } | null {
  const used = days.filter((d) => d.discountCents > 0 && /^Customer discount: /.test(d.note ?? ""));
  if (!used.length) return null;
  const note = used[0].note ?? "";
  const pct = note.match(/(\d+(?:\.\d+)?)% off/);
  const spoken = pct ? `${pct[1]} percent` : spokenMoney(used.reduce((t, d) => t + d.discountCents, 0));
  const beforeCents = days.reduce((t, d) => t + totalsWithFee(d.subtotalCents + (/^Customer discount: /.test(d.note ?? "") ? d.discountCents : 0), d.zone, d.feeCents, s).totalCents, 0);
  return { spoken, beforeCents };
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

/** Times a voicemail greeting starts over after a key that is not pound (then the tone). */
const VM_GREETING_REPLAYS = 3;

/**
 * Every voicemail greeting (Nov 19, 2026): pound skips to the tone; other keys are not choices (the greeting starts
 * over, see vm-greeting-key). The greeting ends with no key: the tone. On the general voicemail, star 7 4 is staff access.
 */
function vmGreetingThenTone(vr: VR, ctx: Ctx, box: { id: number; maxLengthSec: number; transcribe: boolean }, x: string | null, greeting: PromptKey, n = 0, vars?: Record<string, string | number>, opts?: { draftOk?: boolean }) {
  const staff = vmAccessActive() && x === "9";
  const g = vr.gather({
    input: ["dtmf"],
    numDigits: staff ? VM_ACCESS_KEYS.length : 1,
    timeout: staff ? VM_ACCESS_KEY_GAP : 1,
    finishOnKey: "#",
    actionOnEmptyResult: true,
    action: url("vm-greeting-key", { x: x ?? undefined, n: n || undefined, g: greeting }),
    method: "POST",
  });
  sp(g, ctx, greeting, vars, opts);
  return vmRecord(vr, box, x);
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
async function lineRingsNowFor(k: RingKey, settings: Awaited<ReturnType<typeof getSettings>>, at = new Date(), opts: { hoursOnly?: boolean } = {}) {
  const iso = localISO(at);
  // The Hours page (Abraham, Nov 25, 2026, 4:54 PM): each line's own schedule (or its group's) and its on/off switch
  const { RING_KEY_LINE, effectiveLine, lineOpen, loadHours } = await import("@/lib/hours-schedule");
  const hours = loadHours(settings);
  const line = RING_KEY_LINE[k] ?? "office";
  if (!effectiveLine(hours, line).on) return false; // switched off: this line goes to its voicemail
  const inHours = line === "office" ? officeOpenNow(at, settings) : lineOpen(hours, line, at, settings);
  if (opts.hoursOnly) return inHours && !isShabbosOrYomTov(iso); // bookings key 0: the line's own hours only (no after-hours ringing)
  return lineRingsNow(k, at, settings, { officeOpen: inHours, shabbosOrYomTov: isShabbosOrYomTov(iso), candleLighting: erevCandleLighting(iso, settings) });
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
    minutes: await linkHoldMinutes("phone"),
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
    await db.update(orders).set({ holdExpiresAt: minutesFromNow(await linkHoldMinutes("phone")), linkOpenedAt: null, updatedAt: new Date() }).where(and(inArray(orders.id, ids), eq(orders.status, "PENDING_PAYMENT")));
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
      // Abraham, Nov 25, 2026: the chosen number gets the confirmation AND every later update text for this order. The
      // caller asked for it on this call (key 1), so the order-text consent for that number is recorded first.
      const joined = Boolean(ctx.session?.data.textJoin);
      const blocked = (await customerByPhone(to))?.smsOptOut;
      if (blocked) {
        sp(vr, ctx, "consent_stopped");
        return back(vr, "receipt-email", { o }); // box 35
      }
      await recordPhoneConsent(ctx, "transactional", "opt_in", to, joined ? "phonepay_approved_join" : "phonepay_approved_text");
      await setOrderTextPhone(o, to);
      await updateSession(ctx.callSid, { data: { textJoin: undefined } }, ctx.session);
      const { confirmationText } = await import("@/lib/payment-result");
      const body = await confirmationText(o);
      const r = body ? await sendMessage({ to, body, kind: "transactional", event: "confirmation_resend", orderId: o, callSid: ctx.callSid }) : null;
      await track(ctx.callSid, "step", `Box 148: the order's text number is now ${to}${r?.sent ? "; confirmation texted" : ""}${joined ? " (signed up for this order's texts)" : ""}`, { to });
      return back(vr, "receipt-email", { o }); // box 35 after the different-number step
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
  if (ctx.session?.data.emailFor === "receipt") return back(vr, "receipt-email", { o: ctx.session.data.payOrder }); // box 35
  const o = ctx.session?.data.emailFor === "pay" ? ctx.session.data.payOrder : undefined;
  return o ? back(vr, "paylink", { o }) : back(vr, "catalog");
}

/* ------------------------------------------------------------------ handlers */

type Handler = (ctx: Ctx, vr: VR) => Promise<VR> | VR;

const handlers: Record<string, Handler> = {
  // Full voicemail by phone (Abraham, Nov 23, 2026): star 7 4 from the general voicemail
  ...makeVmHandlers({ sp, say, back, url, backLine, when: vmaWhen, update: (sid, patch, s) => updateSession(sid, patch, s) }),
  /**
   * Music while a caller waits (Abraham, Nov 17, 2026): one piece at a time, like a radio (src/lib/music.ts). Used as
   * the wait music of a queue: Twilio asks again for the next piece when one ends. place = staff | pay.
   */
  async music(ctx, vr) {
    const place = ctx.query.get("place") === "pay" ? "pay" : "staff";
    // Payment connect (Abraham, Nov 25, 2026): the hold line is the first thing in the pay queue; the next request (it
    // finished playing) marks it done, so the call to Sola joins only after the whole line, never mid-sentence
    const a = place === "pay" ? Number(ctx.query.get("a")) || 0 : 0;
    if (a) {
      const [att] = await db.select({ s: schema.phonepayAttempts.holdStartedAt, d: schema.phonepayAttempts.holdDoneAt }).from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, a)).limit(1);
      if (att && !att.s) {
        await db.update(schema.phonepayAttempts).set({ holdStartedAt: new Date() }).where(eq(schema.phonepayAttempts.id, a));
        sp(vr, ctx, "pay_hold_secure", undefined, { draftOk: true });
        return vr;
      }
      if (att && !att.d) await db.update(schema.phonepayAttempts).set({ holdDoneAt: new Date() }).where(eq(schema.phonepayAttempts.id, a));
    }
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
        return back(vr, "instructions"); // the key 2 menu always plays (Nov 25, 2026, 1:08 PM)
      case "3": // customer service: the line (ring list, voicemail, alerts) that was key 4
        return back(vr, "ring", { k: "4" });
      // Nov 19, 2026 (Hark for Abraham): 4 = issues during your rental, 5 = delivery and pickup, 6 = learn about our
      // rentals. The lines keep their ring lists, voicemail boxes and names (stored as lines 5 and 6).
      case "4":
        return back(vr, "ring", { k: "5" });
      case "5":
        return back(vr, "ring", { k: "6" });
      case "6":
        return back(vr, "learn");
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

  /**
   * No key (Abraham, Nov 22, 2026, every key menu but the main menu): "We did not get your choice. Please try again."
   * and the same screen again. The call ends only after 1 full minute with no key, counted from when the screen first
   * finished playing (never mid-play), with the goodbye line.
   */
  idle(ctx, vr) {
    const nk = Number(ctx.query.get("nk")) || Date.now() - NO_KEY_SECONDS * 1000;
    if (Date.now() - nk >= NO_KEY_END_MS) {
      sp(vr, ctx, "no_input_final");
      vr.hangup();
      return vr;
    }
    sp(vr, ctx, "no_choice");
    return toStep(vr, ctx, { nk });
  },

  /** Old links (the 9-minute warning is gone): back to the same step. */
  "idle-key"(ctx, vr) {
    return toStep(vr, ctx);
  },

  /* ---- Key 8 (Abraham, Phone Menu v3): our catalog by text or email. Never a promo sign-up. ---- */

  catalog(ctx, vr) {
    const g = keypad(vr, url("catalog-choice"));
    menuRun(g, ctx, "catalog_menu", ["catalog_menu", "star"]);
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
    menuRun(g, ctx, "text_which", ["text_which", "star"]);
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
    // p = rcpt: the receipt email at checkout (box 35, Nov 25, 2026)
    const forCatalog = p === "cat" || (!p && !ctx.session?.data.emailFor);
    if (forCatalog && infoCatalogAutoreplyOn()) sp(vr, ctx, "catalog_email_info");
    await updateSession(ctx.callSid, { data: { catLocal: "", catDomain: "", ...(p === "pay" ? { emailFor: "pay" as const, payOrder: Number(ctx.query.get("o")) || ctx.session?.data.payOrder } : p === "rcpt" ? { emailFor: "receipt" as const, payOrder: Number(ctx.query.get("o")) || ctx.session?.data.payOrder } : p === "cat" ? { emailFor: undefined } : {}) } }, ctx.session);
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
    sp(g, ctx, "type_hint"); // Abraham, Nov 24, 2026: every typing step: "To type it with your keypad, press 9."
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
    // Abraham, Nov 24, 2026: no step starts typing on the first key. 9 = type it; star = one step back; pound = read
    // back what we have; any other key: the wrong-key line and the same question
    if (first === "*") return part === "domain" ? back(vr, "catalog-ending") : emailHome(ctx, vr);
    if (first === "#") return back(vr, "catalog-got", { part });
    if (first !== "9") {
      if (first) sp(vr, ctx, "not_valid");
      return back(vr, "catalog-part", { part, add });
    }
    await updateSession(ctx.callSid, { data: { catKeys: "" } }, ctx.session);
    return back(vr, "catalog-type", { part, add });
  },

  /** Typing the email part: the directions, a short beep, then keys until pound (a key during the directions is the first typed key). */
  "catalog-type"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const add = ctx.query.get("add") ?? undefined;
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 20, action: url("catalog-typed", { part, add }), method: "POST" });
    sp(g, ctx, "type_instructions");
    g.play(`${config.baseUrl()}/audio/tone.wav`);
    return back(vr, "catalog-typed", { part, add });
  },

  async "catalog-typed"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const keep = ctx.query.get("add") === "1" ? catPart(ctx, part) : "";
    if ((ctx.body.Digits ?? "") === "*") return back(vr, "catalog-part", { part, add: ctx.query.get("add") ?? undefined }); // star before typing: back
    // The one keypad decoder for every typing step (Abraham, Nov 24, 2026)
    const text = decodeMultitap(`${ctx.session?.data.catKeys ?? ""}${ctx.body.Digits ?? ""}`.replace(/#/g, ""), "email", keep);
    await updateSession(ctx.callSid, { data: { catKeys: "", [part === "domain" ? "catDomain" : "catLocal"]: text, catStt: undefined } }, ctx.session);
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
      sp(vr, ctx, "field_unclear");
      return back(vr, "catalog-part", { part });
    }
    const g = keypad(vr, url("catalog-got-choice", { part }));
    const links = ctx.session?.data.catStt ? await googleReadback(lineTemplate(ctx, "catalog_got"), { letters: spellOut(value) }) : null;
    if (links) for (const l of links) g.play(l); // speech to text: read back in the Google voice, not Twilio's Say
    else sp(g, ctx, "catalog_got", { letters: spellOut(value) });
    backLine(g, ctx);
    return repeatMenu(vr, ctx, "catalog-got", { part });
  },

  async "catalog-got-choice"(ctx, vr) {
    const part = ctx.query.get("part") === "domain" ? "domain" : "local";
    const d = ctx.body.Digits;
    const value = catPart(ctx, part);
    if (d === "#") {
      const ok = part === "domain" ? validDomain(value) : validLocal(value);
      if (!ok) {
        sp(vr, ctx, "field_unclear");
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
    menuRun(g, ctx, "catalog_ending", ["catalog_ending", "star"]);
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
    confirmEnd(g, ctx);
    backLine(g, ctx);
    return repeatMenu(vr, ctx, "catalog-final");
  },

  async "catalog-final-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    const email = catalogEmailOf(ctx);
    // Nov 23, 2026: 1 confirms (was pound), 2 starts the email over (was 1)
    if (d === "1" && email && ctx.session?.data.emailFor === "pay") {
      // The payment link by email (box 145), then box 146
      const o = ctx.session.data.payOrder;
      await updateSession(ctx.callSid, { data: { emailFor: undefined } }, ctx.session);
      const sent = o ? await deliverPayLink(ctx, o, { email }) : false;
      sp(vr, ctx, sent ? "pay_link_sent" : "link_failed");
      return back(vr, "promo-consent");
    }
    if (d === "1" && email && ctx.session?.data.emailFor === "receipt") {
      // Box 35 (Nov 25, 2026, 11:51): the receipt goes to this email; a customer with no email gets it saved
      const o = ctx.session.data.payOrder ?? 0;
      await updateSession(ctx.callSid, { data: { emailFor: undefined } }, ctx.session);
      const group = o ? await getPaymentGroup(o) : null;
      if (group && group.due <= 0) {
        const c = group.primary.customer;
        if (c?.id && !c.email) await db.update(schema.customers).set({ email }).where(eq(schema.customers.id, c.id));
        const { sendPhoneReceipt } = await import("@/lib/phone-receipt");
        const paidCents = group.orders.reduce((t, x) => t + (x.order.paidCents ?? 0), 0);
        const r = await sendPhoneReceipt(email, { orderId: o, paidAt: group.primary.order.paymentResultAt ?? new Date(), amountCents: paidCents, last4: group.primary.order.cardLast4 ?? null, name: c?.name }).catch(() => ({ sent: false }));
        await track(ctx.callSid, "step", `Box 35: receipt ${r.sent ? "emailed" : "could not be emailed"} to ${email}`, { field: "email", value: email });
      }
      return back(vr, "promo-consent");
    }
    if (d === "1" && email) return back(vr, "catalog-save"); // box 108a first (Nov 25, 2026)
    if (d === "2") return back(vr, "catalog-email"); // try again: the email from the start
    if (d === "*") return back(vr, "catalog-ending");
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-final");
  },

  /** Box 108a (Abraham, Nov 25, 2026): save the email with the caller's phone number (used by box 102 key 3). */
  "catalog-save"(ctx, vr) {
    if (!catalogEmailOf(ctx)) return back(vr, "catalog-email");
    const g = keypad(vr, url("catalog-save-choice"));
    menuRun(g, ctx, "box108a_ask", ["box108a_ask", "star"]);
    return repeatMenu(vr, ctx, "catalog-save");
  },

  async "catalog-save-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    const email = catalogEmailOf(ctx);
    if (!email) return back(vr, "catalog-email");
    if (d === "1") {
      const phone = toE164(ctx.session?.fromNumber ?? ctx.from);
      if (phone) {
        const found = await customerByPhone(phone);
        if (found) await db.update(schema.customers).set({ email }).where(eq(schema.customers.id, found.id));
        else await upsertCustomer(db, { name: "", phone, email });
      }
      await track(ctx.callSid, "step", `Box 108a: email saved with ${phone ?? "no caller number"}`);
      sp(vr, ctx, "box108a_saved");
      return back(vr, "catalog-send");
    }
    if (d === "#") return back(vr, "catalog-send");
    if (d === "*") return back(vr, "catalog-final"); // one step back: the final check
    sp(vr, ctx, "not_valid");
    return back(vr, "catalog-save");
  },

  /** The catalog email goes out, then box 109. */
  async "catalog-send"(ctx, vr) {
    const email = catalogEmailOf(ctx);
    if (!email) return back(vr, "catalog-email");
    const r = await sendCatalogEmail(email);
    await logCatalogRequest(ctx, "email", email, r.sent);
    if (!r.sent) {
      sp(vr, ctx, "went_wrong");
      return back(vr, "catalog"); // the catalog choices again (text instead), not the main menu (audit L8)
    }
    // Box 109 (Abraham, Nov 22, 2026): star = the main menu; no key = the call ends
    const g = keypad(vr, url("catalog-done"));
    menuRun(g, ctx, "catalog_emailed", ["catalog_emailed", "pause", "catalog_main_star", "pause", "catalog_bye"]);
    vr.hangup();
    return vr;
  },

  /**
   * Box 35 (Abraham, Nov 25, 2026, 11:51): after a paid phone card payment (box 148). 1 = the email steps (box 102), and
   * the receipt goes to that email; pound = skip. No star (nothing to go back to). Never before payment.
   */
  async "receipt-email"(ctx, vr) {
    const o = Number(ctx.query.get("o")) || ctx.session?.data.payOrder || 0;
    const group = o ? await getPaymentGroup(o) : null;
    if (!group || group.due > 0) return back(vr, "promo-consent"); // only once paid
    const g = keypad(vr, url("receipt-email-choice", { o }));
    sp(g, ctx, "box35_receipt");
    return repeatMenu(vr, ctx, "receipt-email", { o });
  },

  async "receipt-email-choice"(ctx, vr) {
    const o = ctx.query.get("o") ?? undefined;
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "catalog-email", { p: "rcpt", o });
    if (d === "#") return back(vr, "promo-consent"); // skip: on to the normal goodbye
    if (!d) return repeatMenu(vr, ctx, "receipt-email", { o });
    sp(vr, ctx, "not_valid");
    return back(vr, "receipt-email", { o });
  },

  "catalog-done"(ctx, vr) {
    if (ctx.body.Digits === "*") return back(vr, "menu"); // star: the main menu (box 109, Nov 22, 2026)
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
      // Abraham, Nov 25, 2026, 1:08 PM: an entry whose script still waits for approval rings customer service, the
      // same line as main menu key 3 (ring list, hold music, voicemail and after-hours); each entry on its own
      const parts = (typeof type.instr === "string" ? [type.instr] : type.instr) as readonly PromptKey[];
      if (parts.some((k) => promptWaiting(ctx.prompts, k))) {
        await track(ctx.callSid, "step", `Key 2: ${type.label} instructions not ready yet; customer service`);
        return back(vr, "ring", { k: "4" });
      }
      for (const k of parts) sp(g, ctx, k);
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
    // Nov 19, 2026 (Hark for Abraham): three recordings, then the one shared star line, in the order set in Admin
    // Abraham, Nov 19, 2026: the orders-only line plays the first time only, not when the caller comes back to add more
    void cats;
    await playMenu(g, ctx, "book", undefined, { firstTime: !(await callOrders(ctx)).length });
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
    // Nov 19, 2026: "... you had in your cart {items} for {date}." Several days: each day's items with their date, the
    // last day's date in {date}
    const days = [...new Set(lines.map((l) => l.date))];
    const dayItems = (d: string) => lines.filter((l) => l.date === d).map((l) => (l.qty === 1 ? `one ${l.name}` : `${l.qty} ${l.name}`)).join(" and "); // the approved welcome-back wording
    const last = days[days.length - 1];
    const items = [...days.slice(0, -1).map((d) => `${dayItems(d)} for ${spokenDate(d)}`), dayItems(last)].join(", and ");
    sp(g, ctx, "resume_offer", { items, date: spokenDate(last) });
    backLine(g, ctx);
    return idleNoKey(vr, ctx, "book");
  },

  /**
   * Press 1: check every item again (Abraham, Nov 15, 2026). Free items are held for the caller, then go straight into
   * the cart (Nov 18, 2026); taken items get the nearest options.
   */
  async "resume-choice"(ctx, vr) {
    const rd = ctx.body.Digits;
    if (rd === "*") return back(vr, "menu"); // star: one step back, the main menu
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
      await updateSession(ctx.callSid, { orderId: cartOrder, outcome: "carted", data: { day: l.d, dayOrderIds: ids, resumeLines: lines, lastAdded: { name: l.name, qty: l.qty, date: l.d } } }, session);
      await track(ctx.callSid, "item_added", `Added ${itemPhrase(l.qty, l.name)} for ${spokenDate(l.d)} from the last call`, { item: l.name, productId: l.p, qty: l.qty, date: l.d, orderId: cartOrder });
      // Nov 19, 2026: a jumping balloon gets the ocean balls question first, then the old-cart added line
      const prod = await getProduct(l.p);
      if (prod && (await isBounceHouse(prod.categoryId)) && !ctx.session?.data.oceanOffered) {
        await updateSession(ctx.callSid, { data: { oceanOffered: true } }, ctx.session); // once per call (Nov 24, 2026)
        return back(vr, "resume-added", { d: l.d, o: l.d }); // the added line, then "To add ocean balls, press 9." (Nov 25, 2026)
      }
      return back(vr, "resume-added", { d: l.d });
    }
    const t = lines.findIndex((l) => l.state === "taken");
    if (t >= 0) {
      const l = lines[t];
      lines[t] = { ...l, state: "done" };
      await updateSession(ctx.callSid, { data: { resumeLines: lines } }, ctx.session);
      return back(vr, "booked", { p: l.p, d: l.d }); // the one item taken prompt (Nov 20, 2026)
    }
    return back(vr, (await callOrders(ctx)).length ? "cart" : "book");
  },

  /**
   * Old cart, an item added (Nov 19, 2026): "This item was successfully added to your cart. To go to your shopping
   * cart, press 0. To keep shopping, for same day, press 1. For another day, press 2." No key: the next old item.
   */
  "resume-added"(ctx, vr) {
    const d = ctx.query.get("d") ?? undefined;
    const n = ctx.query.get("n") ?? undefined;
    const o = ctx.query.get("o") ?? undefined;
    const g = keypad(vr, url("resume-added-choice", { d, n, o }));
    if (n) sp(g, ctx, "box25_keep"); // the added line already played (Batch 3 item 4)
    else {
      const a = ctx.session?.data.lastAdded;
      if (a) sp(g, ctx, "box25_added", addedVars(a));
      if (o) sp(g, ctx, "ocean_offer"); // the first balloon of the call (Nov 25, 2026, 14:08)
      sp(g, ctx, "box25_keep");
    }
    menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
    return back(vr, "resume-items");
  },

  async "resume-added-choice"(ctx, vr) {
    const k = ctx.body.Digits;
    if (k === "*") return back(vr, "book"); // star: one step back, the bookings menu
    if (k === "0") return back(vr, "cart");
    if (k === "1") return back(vr, "cats"); // keep shopping, the same day: the categories menu (box 12a)
    if (k === "2") return back(vr, "date", { a: 1 }); // another day (a: back to box 25 on star, the categories after the date)
    const o = ctx.query.get("o") ?? undefined;
    if (k === "9" && o) return back(vr, "ocean", { d: o, n: "resume" });
    if (k) {
      sp(vr, ctx, "not_valid");
      return back(vr, "resume-added", { d: ctx.query.get("d") ?? undefined, n: ctx.query.get("n") ?? undefined });
    }
    return back(vr, "resume-items");
  },

  /** Old menu (boxes 9 and 10, deleted): a call already in it goes on with the new way. */
  async "resume-pick"(_ctx, vr) {
    return back(vr, "resume-items");
  },

  /**
   * Bookings menu key 0 outside customer service hours (Abraham, Nov 25, 2026, item 4): "Our customer service is
   * currently closed." (the hours line, book_r3c, joins here once its new wording is in), "...To get started, press 1.",
   * "Otherwise, leave a message after the tone, ..." then the tone and the message into the customer service box (its
   * own greeting does not play). Keys while they play: 1 the categories menu, star the bookings menu, any other key not
   * valid then the set again. No key: the tone.
   */
  async "cs-closed"(ctx, vr) {
    await track(ctx.callSid, "step", "Bookings key 0: customer service closed (after-hours set)");
    const g = keypad(vr, url("cs-closed-key"), { timeout: 1 });
    menuRun(g, ctx, "after_hours_closed", BOOK_R3C_LIVE ? ["after_hours_closed", "book_r3c", "after_hours_auto", "after_hours_message"] : ["after_hours_closed", "after_hours_auto", "after_hours_message"]);
    const box = await vmBox("4");
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "voicemail", data: { vmEntry: "4", missed: "closed" } }, ctx.session);
    return vmRecord(vr, box, "4");
  },

  async "cs-closed-key"(ctx, vr) {
    const d = ctx.body.Digits;
    if (!d) return back(vr, "cs-closed");
    if (d === "1") return back(vr, "cats");
    if (d === "*") return back(vr, "book");
    sp(vr, ctx, "not_valid");
    return back(vr, "cs-closed");
  },

  /**
   * The categories menu (box 12a, Abraham, Nov 22, 2026): bookings recording 2 (the three categories), the shared cart
   * line, the shared star line. After "same day" on item added, and star in any item list. Star = the bookings menu.
   */
  cats(ctx, vr) {
    const g = keypad(vr, url("cats-choice"));
    menuRun(g, ctx, "book_r2", ["book_r2", "cart_key", "star"]);
    return bookNoInput(vr, ctx, "cats");
  },

  async "cats-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (!d) return bookNoInput(vr, ctx, "cats");
    if (d === "*") return back(vr, "book");
    if (d === "0") return back(vr, "cart");
    const cat = /^[1-7]$/.test(d) ? (await phoneCategories())[Number(d) - 1] : undefined;
    if (!cat) {
      sp(vr, ctx, "not_valid");
      return back(vr, "cats");
    }
    return back(vr, "category", { c: cat.id });
  },

  async "book-choice"(ctx, vr) {
    const d = ctx.body.Digits; // keys only (Abraham)
    if (!d) return (await callOrders(ctx)).length ? idleNoKey(vr, ctx, "book") : repeatMenu(vr, ctx, "book");
    if (d === "*") return back(vr, "menu"); // star goes back one step
    // customer service (main menu key 3's line), only in its hours; outside them the after-hours set (Nov 25, 2026, item 4)
    if (d === "0") return (await lineRingsNowFor("4", await getSettings(), new Date(), { hoursOnly: true })) ? back(vr, "ring", { k: "4" }) : back(vr, "cs-closed");
    if (d === "9") return back(vr, "ring", { k: "8" }); // schools, corporate events and organizations
    if (d === "8") return back(vr, "catalog"); // the catalog, also from the bookings menu (Nov 19, 2026)
    const cat = (await phoneCategories())[Number(d) - 1];
    if (!cat || !/^[1-7]$/.test(d)) {
      sp(vr, ctx, "not_valid");
      return back(vr, "book");
    }
    return back(vr, "category", { c: cat.id });
  },

  async category(ctx, vr) {
    const c = Number(ctx.query.get("c"));
    const f = ctx.query.get("f"); // item taken, key 1: only what is free on that date
    const [cat] = await db.select().from(categories).where(eq(categories.id, c));
    const items = cat ? await listItems(c, f) : [];
    if (!cat || !items.length) {
      sp(vr, ctx, "category_empty");
      return back(vr, "book"); // Abraham, Nov 20, 2026: straight back to the bookings menu
    }
    await track(ctx.callSid, "category_heard", `Listened to ${cat.name}`, { category: cat.name, items: items.map((p) => p.name) });
    // Jumping balloons: box 153 (Abraham, Nov 19, 2026)
    if (await isBounceHouse(c)) return back(vr, "balloons", { c, f: f ?? undefined });
    // Laser tag (box 13b, Nov 22, 2026): the opening, the four fixed lines, then the shared cart and star lines
    if (await isLaserBase(c)) {
      const list = laserList(items);
      const g = keypad(vr, url("category-choice", { c, f: f ?? undefined }));
      sp(g, ctx, "laser_open");
      for (const x of list) {
        if (x.line) sp(g, ctx, x.line);
        else sp(g, ctx, "category_item", { item: x.p.name, key: x.key });
      }
      menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
      return bookNoInput(vr, ctx, "category", { c, f: f ?? undefined });
    }
    // 10 or more items (Abraham, Nov 17, 2026): two-key choices (10, 11, 12) work; a single key acts after a short wait
    const g = keypad(vr, url("category-choice", { c, f: f ?? undefined }), items.length > 9 ? { numDigits: 2, timeout: MULTI_KEY_WAIT_SECONDS } : {});
    if (/paddle/i.test(cat.name)) sp(g, ctx, "paddle_open"); // Nov 22, 2026: "Here are our paddle boat packages."
    else sp(g, ctx, "book_category_list", { category: cat.spokenName || cat.name });
    sp(g, ctx, "cart_key"); // Abraham (Phone Menu v3): the cart line before the items and again after them
    items.forEach((p, i) => sp(g, ctx, "category_item", { item: p.name, key: i + 1 }));
    menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
    return bookNoInput(vr, ctx, "category", { c, f: f ?? undefined });
  },

  /**
   * The jumping balloons list (Abraham, Nov 19, 2026, replaces box 153): the opening, then per balloon the recorded
   * "For the {name}, item seven two," + the last two digits live + recorded "press," + the key live; then once the
   * cart line and the shared star line. Keys 10 to 12: after 1 the line waits 2 seconds for a second digit.
   */
  async balloons(ctx, vr) {
    const c = ctx.query.get("c")!;
    const f = ctx.query.get("f") ?? undefined;
    const items = await listItems(Number(c), f ?? null);
    const g = keypad(vr, url("balloon-key", { c, f }), { numDigits: 1 });
    await playMenu(g, ctx, "balloons", (g) => {
      for (const b of BALLOON_MENU) {
        if (!items.some((p) => balloonEntry(p.name)?.key === b.key)) continue; // not active in Admin: not read
        // Nov 22, 2026: three fixed recordings per balloon (name, item number, "press N."), nothing said live
        sp(g, ctx, `balloon_name_${b.number}` as PromptKey);
        sp(g, ctx, `balloon_num_${b.number}` as PromptKey);
        sp(g, ctx, `balloon_key_${b.key}` as PromptKey);
      }
    });
    return bookNoInput(vr, ctx, "balloons", { c, f });
  },

  async "balloon-key"(ctx, vr) {
    const c = ctx.query.get("c")!;
    const f = ctx.query.get("f") ?? undefined;
    const d = ctx.body.Digits;
    if (!d) return bookNoInput(vr, ctx, "balloons", { c, f });
    if (d === "*") return back(vr, "cats"); // star: the categories menu (box 12a, Nov 22, 2026)
    if (d === "0") return back(vr, "cart", { c, f }); // "To go to your shopping cart, press 0."
    // 1: wait 2 seconds for a second digit (10, 11, 12); pound skips the wait; nothing = Soft Hop
    if (d === "1") {
      vr.gather({ input: ["dtmf"], numDigits: 1, timeout: BALLOON_SECOND_DIGIT_SECONDS, finishOnKey: "#", action: url("balloon-key2", { c, f }), method: "POST", actionOnEmptyResult: true });
      return back(vr, "balloon-pick", { c, f, k: "1" });
    }
    return back(vr, "balloon-pick", { c, f, k: d });
  },

  "balloon-key2"(ctx, vr) {
    const c = ctx.query.get("c")!;
    const f = ctx.query.get("f") ?? undefined;
    const d = ctx.body.Digits ?? "";
    if (!d) return back(vr, "balloon-pick", { c, f, k: "1" }); // pound or no second digit: Soft Hop
    return back(vr, "balloon-pick", { c, f, k: `1${d}` });
  },

  async "balloon-pick"(ctx, vr) {
    const c = Number(ctx.query.get("c"));
    const f = ctx.query.get("f") ?? undefined;
    const k = ctx.query.get("k") ?? "";
    const p = balloonForKey(k, await listItems(c, f ?? null));
    if (!p) {
      sp(vr, ctx, "not_valid");
      return back(vr, "balloons", { c, f });
    }
    await track(ctx.callSid, "item_heard", `Chose ${p.name}`, { item: p.name, productId: p.id });
    return back(vr, "balloon", { p: p.id });
  },

  /** Box 154: "{Item}, item {item number}, {price}. To add it to your shopping cart, press 1. ..." */
  async balloon(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p) return back(vr, "book");
    const g = keypad(vr, url("balloon-choice", { p: p.id }));
    // the whole item recording ("item seven two zero one") for "item {number}" when it is uploaded (Nov 24, 2026)
    const bn = balloonEntry(p.name)?.number;
    sp(g, ctx, "box154", { item: p.name, number: digitWords(bn ?? ""), price: spokenMoney(p.priceCents), ...(bn ? { "@number": `balloon_num_${bn}` } : {}) });
    menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
    return bookNoInput(vr, ctx, "balloon", { p: p.id });
  },

  async "balloon-choice"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p) return back(vr, "book");
    const d = ctx.body.Digits;
    if (!d) return bookNoInput(vr, ctx, "balloon", { p: p.id });
    if (d === "*") return back(vr, "balloons", { c: p.categoryId });
    if (d === "0") return back(vr, "cart");
    if (d === "1") {
      const day = ctx.session?.data.day;
      return day ? back(vr, "qty", { p: p.id, d: day }) : back(vr, "date", { p: p.id });
    }
    if (d === "2") {
      await track(ctx.callSid, "item_details", `Heard the details of ${p.name}`, { item: p.name, productId: p.id });
      const sizes = balloonSizes(p.dimensions);
      // Box 155 (approved Nov 18, 2026): the Catalog description as its own sentence(s), then the sizes. No description:
      // just the sizes sentence; no sizes: the description, then "To add it to your shopping cart, press 1."
      let description = (p.spokenDescription || p.description).trim();
      if (description && !/[.!?]$/.test(description)) description += ".";
      if (description) description = description[0].toUpperCase() + description.slice(1);
      if (sizes || description) {
        const g = keypad(vr, url("balloon-choice", { p: p.id }));
        if (sizes) sp(g, ctx, "box155", { description, item: p.name, ...sizes });
        else {
          say(g, description);
          const tail = promptText(ctx.prompts, "box155", { description: "", item: "", length: "", width: "", height: "" }).match(/To add[^]*$/)?.[0];
          if (tail) say(g, tail);
        }
        menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
        return bookNoInput(vr, ctx, "balloon", { p: p.id });
      }
      if (p.spokenDescription || p.description) say(vr, p.spokenDescription || p.description);
      else sp(vr, ctx, "product_default_desc", { item: p.name });
      pause(vr);
      return back(vr, "balloon", { p: p.id });
    }
    sp(vr, ctx, "not_valid");
    return back(vr, "balloon", { p: p.id });
  },

  async "category-choice"(ctx, vr) {
    const c = Number(ctx.query.get("c"));
    const d = ctx.body.Digits;
    if (!d) return bookNoInput(vr, ctx, "category", { c, f: ctx.query.get("f") ?? undefined }); // keeps the "free that date" filter (audit L3)
    if (d === "*") return back(vr, "cats"); // star: the categories menu (box 12a, Nov 22, 2026)
    if (d === "0") return back(vr, "cart", { c }); // after the cart, the same item list plays again
    const items = await listItems(c, ctx.query.get("f"));
    const p = /^\d{1,2}$/.test(d) && !d.startsWith("0") ? ((await isLaserBase(c)) ? laserList(items).find((x) => x.key === Number(d))?.p : items[Number(d) - 1]) : undefined;
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
    menuRun(g, ctx, "product_options", ["product_options", "cart_key", "star"]);
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
    const a = ctx.query.get("a") ?? undefined; // "another day" from box 25 or welcome back (Hark's audit H1, Nov 24, 2026)
    // Pound after the digits finishes the date (audit M3): it is never read as part of the date
    const g = keypad(vr, url("date-heard", { p, a }), { numDigits: 4, timeout: 8, finishOnKey: "#" });
    menuRun(g, ctx, "book_date_prompt", ["book_date_prompt", "star"]);
    return bookNoInput(vr, ctx, "date", { p, a });
  },

  async "date-heard"(ctx, vr) {
    const p = ctx.query.get("p") ?? undefined;
    const a = ctx.query.get("a") ?? undefined;
    const digits = (ctx.body.Digits ?? "").replace(/#/g, ""); // "1208#": the pound only ends the entry (audit M3)
    if (!digits) return bookNoInput(vr, ctx, "date", { p, a });
    if (digits.includes("*")) {
      // Star goes back one step: the rentals in that item's category, box 25 for another day, or the bookings menu
      const prod = p ? await getProduct(Number(p)) : null;
      return prod ? back(vr, "category", { c: prod.categoryId }) : a ? back(vr, "added-menu") : back(vr, "book");
    }
    const today = todayISO();
    const r = parseDateInput({ digits }, today);
    if (!r.ok) {
      await track(ctx.callSid, "date_unclear", `Date not usable (${r.reason})`, { key: digits, reason: r.reason });
      sp(vr, ctx, r.reason === "past" ? "date_past" : r.reason === "too_far" ? "date_too_far" : "date_unclear");
      return back(vr, "date", { p, a });
    }
    const cal = await getSettings();
    const chk = checkEventDate(r.date, cal);
    if (!chk.ok) {
      await track(ctx.callSid, "date_closed", `Asked for ${spokenDate(r.date)}: closed`, { date: r.date, reason: chk.day.reasonEn ?? chk.day.reason ?? null });
      // Abraham, Nov 20, 2026: the day before and the day after both open, and the item known: get it the day before
      if (p && closedDayOffer(r.date, today, cal as never, (iso) => dayInfo(iso, cal).closed)) return back(vr, "closed-offer", { p, d: r.date });
      sp(vr, ctx, "date_closed", { date: spokenDate(r.date), reason: chk.day.reasonEn ?? chk.day.reason ?? "a holiday" }); // Ashkenazi English names (Abraham)
      return back(vr, "date", { p, a });
    }
    await track(ctx.callSid, "date_asked", `Asked about ${spokenDate(r.date)}`, { date: r.date, key: digits });
    return back(vr, "date-ask", { p, d: r.date, a });
  },

  /**
   * A closed day (Abraham, Nov 20, 2026): "We are closed on {date} for {reason}. You can get it the day before, on
   * {before}, in the morning before 12:00 PM, and keep it until {after}, at 9:00 AM, for a total of {price}. To book it,
   * press 1. Otherwise, please pick another date." Then the date prompt and the back line: 1 books it, four digits are a
   * new date, star goes back one step (the item's list).
   */
  async "closed-offer"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const prod = await getProduct(Number(p));
    const cal = await getSettings();
    const offer = prod ? closedDayOffer(date, todayISO(), cal as never, (iso) => dayInfo(iso, cal).closed) : null;
    if (!prod || !offer) return back(vr, "date", { p });
    const day = dayInfo(date, cal);
    // Box 17 (Nov 22, 2026): recorded pieces with the live parts between them; 1 books it, 2 another date, star back
    const g = keypad(vr, url("closed-offer-choice", { p, d: date }));
    sp(g, ctx, "closed_day_intro", { date: spokenDate(date), reason: day.reasonEn ?? day.reason ?? "a holiday" });
    sp(g, ctx, "closed_day_get", { before: spokenDate(offer.before), after: spokenDate(offer.after), price: spokenMoney(Math.round(prod.priceCents * offer.days)) });
    menuRun(g, ctx, "closed_book_it", ["closed_book_it", "closed_pick_another", "star"]);
    return bookNoInput(vr, ctx, "closed-offer", { p, d: date });
  },

  async "closed-offer-choice"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits ?? "";
    if (!d) return bookNoInput(vr, ctx, "closed-offer", { p, d: date });
    if (d === "2") return back(vr, "date", { p }); // pick another date
    if (d === "*") return handlers["date-heard"](ctx, vr); // star: one step back, the item's list
    if (d !== "1") {
      sp(vr, ctx, "not_valid");
      return back(vr, "closed-offer", { p, d: date });
    }
    const cal = await getSettings();
    const offer = closedDayOffer(date, todayISO(), cal as never, (iso) => dayInfo(iso, cal).closed);
    if (!offer) return back(vr, "date", { p });
    const spans = { ...(ctx.session?.data.spanDays ?? {}), [offer.before]: { after: offer.after, days: offer.spanDays } };
    await updateSession(ctx.callSid, { data: { spanDays: spans } }, ctx.session);
    if (ctx.session) ctx.session.data.spanDays = spans;
    await track(ctx.callSid, "step", `Closed ${spokenDate(date)}: booked from ${spokenDate(offer.before)} to ${spokenDate(offer.after)}`, { date, before: offer.before, after: offer.after, days: offer.days });
    await chooseDay(ctx, offer.before);
    return back(vr, "qty", { p, d: offer.before });
  },

  /** "You entered Tuesday, March 5th. If that is correct, press pound to continue. To enter a different date, press 1." */
  async "date-ask"(ctx, vr) {
    const p = ctx.query.get("p") ?? undefined;
    const date = ctx.query.get("d")!;
    // Box 150 (Abraham, Nov 18, 2026): a Friday in Chanukah or Chol Hamoed can be kept for Mutze Shabbes
    if (friMutzeOffered(date, (await getSettings()) as never)) {
      const g = keypad(vr, url("date-confirm", { p, d: date, f: 1, a: ctx.query.get("a") ?? undefined }));
      sp(g, ctx, "fri_mutze_check", { date: spokenDate(date) });
      backLine(g, ctx);
      return bookNoInput(vr, ctx, "date-ask", { p, d: date, a: ctx.query.get("a") ?? undefined });
    }
    // Box 18 (Abraham, Nov 22, 2026): the item is known: book it, add the next day too, or another date
    const prod = p ? await getProduct(Number(p)) : null;
    if (prod) {
      const two = await secondDay(prod, date);
      const g = keypad(vr, url("box18-choice", { p, d: date, t: two ? 1 : 0 }));
      sp(g, ctx, "box18_book", { item: prod.name, date: spokenDate(date) });
      if (two) sp(g, ctx, "box18_second", { weekday: spokenDate(two.next).split(",")[0], price: spokenMoney(two.moreCents) });
      menuRun(g, ctx, "box18_other_date", ["box18_other_date", "star"]);
      return bookNoInput(vr, ctx, "date-ask", { p, d: date, a: ctx.query.get("a") ?? undefined });
    }
    const g = keypad(vr, url("date-confirm", { p, d: date, a: ctx.query.get("a") ?? undefined }));
    sp(g, ctx, "book_date_entered", { date: spokenDate(date) });
    confirmEnd(g, ctx);
    backLine(g, ctx); // Abraham, Nov 20, 2026: no shopping cart option on this step
    return bookNoInput(vr, ctx, "date-ask", { p, d: date, a: ctx.query.get("a") ?? undefined });
  },

  async "box18-choice"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (d === "*" || d === "3") return back(vr, "date", { p }); // star: one step back; 3: a different date
    if (d === "2" && ctx.query.get("t") === "0") return back(vr, "date", { p }); // no second-day offer: 2 = a different date (Batch 3 item 26a)
    if (d === "1") {
      await clearSpan(ctx, date); // key 1: this date only, never stretched by an earlier key 2
      await chooseDay(ctx, date);
      return back(vr, "qty", { p, d: date });
    }
    const prod = d === "2" && ctx.query.get("t") === "1" ? await getProduct(Number(p)) : null;
    const two = prod ? await secondDay(prod, date) : null;
    if (!two) {
      if (d) sp(vr, ctx, "not_valid");
      return back(vr, "date-ask", { p, d: date });
    }
    // Key 2: the next day too, charged as its days (1.5, or 2 on Chanukah and Chol Hamoed), picked up after it
    const spans = { ...(ctx.session?.data.spanDays ?? {}), [date]: { after: two.after, days: two.days, both: two.next } };
    await updateSession(ctx.callSid, { data: { spanDays: spans } }, ctx.session);
    if (ctx.session) ctx.session.data.spanDays = spans;
    await track(ctx.callSid, "step", `Box 18: ${spokenDate(date)} and ${spokenDate(two.next)}`, { date, next: two.next, days: two.days });
    await chooseDay(ctx, date);
    return back(vr, "qty", { p, d: date });
  },

  async "date-confirm"(ctx, vr) {
    const p = ctx.query.get("p") ?? undefined;
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (ctx.query.get("f") === "1") return friMutzeChoice(ctx, vr, p, date, d);
    // Nov 23, 2026: 1 confirms; 2 tries again (the date step); star one step back; pound or another key is not valid
    const a = ctx.query.get("a") ?? undefined;
    if (d === "2" || d === "*") return back(vr, "date", { p, a });
    if (d !== "1") {
      if (d) sp(vr, ctx, "not_valid");
      return back(vr, "date-ask", { p, d: date, a });
    }
    await clearSpan(ctx, date);
    await chooseDay(ctx, date);
    // No item yet (another day, from box 25 or welcome back): the categories (box 12a) for that day, never the bookings
    // menu (Hark's audit H1, Nov 24, 2026: callers heard it as "back to the first menu")
    return p ? back(vr, "qty", { p, d: date }) : back(vr, "cats");
  },

  /**
   * Item taken (Abraham, Nov 19, 2026, 10:25 PM, whole phone system, welcome back and every booking, also when someone
   * just booked the last one): "We are sorry, the {item} is no longer available for {date}. To check the closest
   * available {category} on the same date, press 1. For the nearest available date, press 2." Then the shared cart line
   * and the shared star line. The old size up / down and "other dates" screens are gone.
   */
  async booked(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const g = keypad(vr, url("taken-choice", { p: p.id, d: date }));
    sp(g, ctx, "item_taken", { item: p.name, date: spokenDate(date), category: await singularCategory(p.categoryId) });
    menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
    return bookNoInput(vr, ctx, "booked", { p: p.id, d: date });
  },

  async "taken-choice"(ctx, vr) {
    const p = Number(ctx.query.get("p"));
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "taken-size", { p, d: date });
    if (d === "2") return back(vr, "nearest-date", { p, d: date });
    if (d === "0") return back(vr, "cart");
    if (d === "*") return starToCategory(vr, p); // star: one menu back, the item's list
    sp(vr, ctx, "not_valid");
    return back(vr, "booked", { p, d: date });
  },

  /**
   * Item taken, key 1 (Abraham, Nov 25, 2026, 8:08 PM): the next size down and the next size up in the same category
   * (Admin size order), each only if free on that date; one side only when the other has nothing; neither: the
   * category list of what is free that day, as before. 1 = size down, 2 = size up, then quantity and add as usual.
   */
  async "taken-size"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "book");
    const cal = await getSettings();
    const [dn, up] = await Promise.all([nearestSize(p, date, -1, cal), nearestSize(p, date, 1, cal)]);
    if (!dn && !up) {
      await chooseDay(ctx, date);
      return back(vr, "category", { c: p.categoryId, f: date });
    }
    const g = keypad(vr, url("taken-size-choice", { p: p.id, d: date, dn: dn?.id, up: up?.id }));
    if (dn) heldLine(g, ctx, "taken_size_down", { item: dn.name });
    if (up) heldLine(g, ctx, "taken_size_up", { item: up.name });
    menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
    return bookNoInput(vr, ctx, "taken-size", { p: p.id, d: date });
  },

  async "taken-size-choice"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const pick = ({ "1": ctx.query.get("dn"), "2": ctx.query.get("up") } as Record<string, string | null>)[ctx.body.Digits ?? ""];
    if (pick) {
      await chooseDay(ctx, date);
      return back(vr, "qty", { p: pick, d: date });
    }
    if (ctx.body.Digits === "0") return back(vr, "cart");
    if (ctx.body.Digits === "*") return back(vr, "booked", { p, d: date }); // star: back to the item taken menu
    if (!ctx.body.Digits) return bookNoInput(vr, ctx, "taken-size", { p, d: date });
    sp(vr, ctx, "not_valid");
    return back(vr, "taken-size", { p, d: date });
  },

  /**
   * Item taken, key 2 (Abraham, Nov 25, 2026, 8:08 PM): the same item the open day before and the open day after the
   * chosen date (closed days skipped), each only if free; if neither, the nearest free date before and after (today to
   * three months ahead). 1 = the earlier date, 2 = the later one, then quantity and add as usual. Nothing free at all:
   * the date prompt.
   */
  async "nearest-date"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "book");
    const cal = await getSettings();
    const opts = await takenDays(p, date, cal);
    if (!opts.before && !opts.after) {
      const g = keypad(vr, url("date-heard", { p: p.id }), { numDigits: 4, timeout: 8, finishOnKey: "#" });
      menuRun(g, ctx, "book_date_prompt", ["book_date_prompt", "star"]);
      return bookNoInput(vr, ctx, "nearest-date", { p: p.id, d: date });
    }
    const g = keypad(vr, url("nearest-choice", { p: p.id, d: date, b: opts.before ?? undefined, a: opts.after ?? undefined }));
    if (opts.near) {
      if (opts.before) heldLine(g, ctx, "taken_day_before", { item: p.name, date: spokenDate(opts.before) });
      if (opts.after) heldLine(g, ctx, opts.before ? "taken_day_after" : "taken_day_after_only", { item: p.name, date: spokenDate(opts.after) });
    } else {
      if (opts.before) heldLine(g, ctx, "taken_nearest_before", { date: spokenDate(opts.before) });
      if (opts.after) heldLine(g, ctx, "taken_nearest_after", { date: spokenDate(opts.after) });
    }
    menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
    return bookNoInput(vr, ctx, "nearest-date", { p: p.id, d: date });
  },

  async "nearest-choice"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d") ?? undefined;
    const pick = ({ "1": ctx.query.get("b"), "2": ctx.query.get("a") } as Record<string, string | null>)[ctx.body.Digits ?? ""];
    if (pick) {
      await chooseDay(ctx, pick);
      return back(vr, "qty", { p, d: pick });
    }
    if (ctx.body.Digits === "0") return back(vr, "cart");
    if (ctx.body.Digits === "*") return date ? back(vr, "booked", { p, d: date }) : starToCategory(vr, Number(p)); // star: the item taken menu
    if (!ctx.body.Digits) return bookNoInput(vr, ctx, "nearest-date", { p, d: date });
    sp(vr, ctx, "not_valid");
    return back(vr, "nearest-date", { p, d: date });
  },

  // Old screens (removed Nov 20, 2026): a call already in one of them goes to the item taken prompt
  "booked-near"(ctx, vr) {
    return back(vr, "booked", { p: ctx.query.get("p")!, d: ctx.query.get("d")! });
  },
  "booked-same"(ctx, vr) {
    return back(vr, "booked", { p: ctx.query.get("p")!, d: ctx.query.get("d")! });
  },
  "booked-closest"(ctx, vr) {
    return back(vr, "booked", { p: ctx.query.get("p")!, d: ctx.query.get("d")! });
  },
  altdates(ctx, vr) {
    return back(vr, "booked", { p: ctx.query.get("p")!, d: ctx.query.get("d")! });
  },

  async qty(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const free = await checkBookable(p.id, p.quantity, date, db, keptPickup(ctx, date));
    if (free <= 0) {
      await track(ctx.callSid, "unavailable", `${p.name} not available on ${spokenDate(date)}`, { item: p.name, productId: p.id, date });
      return back(vr, "booked", { p: p.id, d: date });
    }
    // Abraham, Nov 18, 2026: no "How many would you like?" question and never how many are in stock; every item goes
    // into the cart as one (laser tag and paddle boats then offer one more at a time)
    return back(vr, "add", { p: p.id, d: date, q: 1 });
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
    // Abraham, Nov 20, 2026: no quantity questions on the phone; every item goes in as one
    const asked = Number(ctx.query.get("q") || 1);
    const q = asked >= 1 && asked <= 9 ? asked : 1;
    // Nov 19, 2026: the water line moved to the opening of the jumping balloons list; it no longer plays here
    const session = ctx.session ?? (await ensureSession(ctx.callSid, ctx.from));
    // The held order for this day (one per rental day on the call)
    const existing = await dayOrder(ctx, date);
    const r = await reserveItem({
      orderId: existing?.order.id ?? null,
      productId: p.id,
      qty: q,
      eventDate: date,
      channel: "PHONE",
      holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES),
      callSid: ctx.callSid,
      pickupDate: keptPickup(ctx, date),
    });
    if (!r.ok) {
      if (r.reason === "unavailable") {
        await track(ctx.callSid, "unavailable", r.free > 0 ? `Only ${r.free} ${p.name} left on ${spokenDate(date)} (asked for ${q})` : `${p.name} was just booked for ${spokenDate(date)}`, { item: p.name, productId: p.id, date, asked: q, free: r.free });
        // Abraham, Nov 20, 2026: someone just booked the last one: the same item taken prompt
        return back(vr, "booked", { p: p.id, d: date });
      }
      sp(vr, ctx, "went_wrong");
      return (await callOrders(ctx)).length ? back(vr, "cart") : back(vr, "cats"); // not the main menu (audit L8)
    }
    await track(ctx.callSid, "item_added", `Added ${itemPhrase(q, p.name)} for ${spokenDate(date)}`, { item: p.name, productId: p.id, qty: q, date, orderId: r.orderId });
    // A closed day booked from the day before (Nov 20, 2026): the booking is charged as its days (1.5 or 2)
    const span = ctx.session?.data.spanDays?.[date];
    if (span?.days) {
      await db.update(schema.orders).set({ spanDays: span.days }).where(eq(schema.orders.id, r.orderId));
      const { refreshOrderTotals } = await import("@/lib/orders");
      await refreshOrderTotals(r.orderId);
    }
    const ids = [...new Set([...(session.data?.dayOrderIds ?? []), r.orderId])];
    const announce = session.data?.mutzeAnnounce === date;
    const lastAdded = { name: p.name, qty: q, date, ...(span?.both ? { date2: span.both } : {}) }; // box 25 names both dates after key 2
    await updateSession(ctx.callSid, { orderId: r.orderId, outcome: "carted", data: { day: date, dayOrderIds: ids, lastAdded, ...(announce ? { mutzeAnnounce: undefined } : {}) } }, session);
    // Box 149 when the date came before the item: now the item's price is known
    if (announce) await sayFriMutzePrice(vr, ctx, date, p.priceCents);
    // Abraham, Nov 22, 2026: box 25 after every item added, laser tag and paddle boats too (box 151 and box 152 dropped)
    // Abraham, Nov 19, 2026: row 11 every time an item is added (no shared cart line after it); a jumping balloon gets
    // the ocean balls question first, a maze or laser guns the extra gun packs first
    // Ocean balls only after the FIRST jumping balloon of the call (Abraham, Nov 24, 2026)
    if ((await isBounceHouse(p.categoryId)) && !ctx.session?.data.oceanOffered) {
      await updateSession(ctx.callSid, { data: { oceanOffered: true } }, ctx.session);
      // Ocean balls v2 (Nov 25, 2026, 14:08): box 25 with "To add ocean balls, press 9." after the added line
      return back(vr, "added-menu", { o: date });
    }
    // The extra gun packs after a maze (Abraham, Nov 24, 2026, revised: never after plain 6 or 4 guns), while a pack is
    // left for that date; the approved wording plays in the live voice until its recording is uploaded
    if (await isMaze(p)) {
      sp(vr, ctx, "box25_added", addedVars(lastAdded)); // Batch 3 item 4: the added line first, then the offer
      return back(vr, "packs", { d: date });
    }
    // Box 25 for laser tag and paddle boats (Nov 22, 2026): the added line, then a second one while another is free
    if (await secondOneKind(p.categoryId)) return back(vr, "added-second", { p: p.id, d: date });
    return back(vr, "added-menu");
  },

  /**
   * Box 25, laser tag and paddle boats (Abraham, Nov 22, 2026): "Successfully added to your cart: {Qnt} {item} for
   * {date}." then, only after the first one and while another is free that date (never how many), "To add a second
   * one, press 1." and "Otherwise, stay on the line." Key 1 works until the keep-shopping line starts.
   */
  async "added-second"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "added-menu");
    const kind = await secondOneKind(p.categoryId);
    const inCart = (await cartLines(ctx)).filter((l) => l.date === date && l.name === p.name).reduce((t, l) => t + l.qty, 0);
    const free = await checkBookable(p.id, p.quantity, date, db, keptPickup(ctx, date));
    // Laser tag (Nov 22, 2026, 11:12 PM): "To add another" every time while another set is free; paddle boats: a second one
    if (!kind || free <= 0 || (kind === "paddle" && inCart !== 1)) return back(vr, "added-menu");
    // Guns-only sets, no maze (Abraham, Nov 25, 2026, 15:06): the same lines as the extra sets after a maze
    if (kind === "laser" && /\d+\s+laser guns/i.test(p.name) && !/maze/i.test(p.name)) {
      const day = await dayOrder(ctx, date);
      const { orderHasMaze, laserThirdSetHalfOn } = await import("@/lib/orders");
      if (day && !(await orderHasMaze(db, day.order.id))) {
        const packIds = new Set((await addOnProducts(LASER_ADDONS_CATEGORY)).map((x) => x.id));
        const gunSet = async (productId: number) => {
          if (packIds.has(productId)) return true;
          const [x] = await db.select({ name: products.name, categoryId: products.categoryId }).from(products).where(eq(products.id, productId));
          return Boolean(x && (await isLaserBase(x.categoryId)) && !/maze/i.test(x.name) && /\d+\s+laser guns/i.test(x.name));
        };
        let sets = 0;
        for (const i of day.items) if (await gunSet(i.productId)) sets += i.qty;
        if (sets >= 3) return back(vr, "added-menu"); // after the third set: no more offers
        // "Laser tag: every third set half price" off (Abraham, Nov 25, 2026, 4:03 PM): no third-set line
        if (sets >= 2 && !(await laserThirdSetHalfOn(db))) return back(vr, "added-menu");
        const g = keypad(vr, url("second-choice", { p: p.id, d: date }), { timeout: 5 });
        const a = ctx.session?.data.lastAdded;
        if (a) sp(g, ctx, "box25_added", addedVars(a));
        if (sets <= 1) sp(g, ctx, "laser_second_set");
        else sp(g, ctx, "laser_third_set", { price: spokenMoney(await nextSetPrice(day.order.id, p.id)) });
        sp(g, ctx, "stay_on_line");
        return back(vr, "added-menu", { n: 1 }); // no key for 5 seconds: nothing added, on to the keep-shopping lines
      }
    }
    const g = keypad(vr, url("second-choice", { p: p.id, d: date }), { timeout: 4 });
    const a = ctx.session?.data.lastAdded;
    if (a) sp(g, ctx, "box25_added", addedVars(a));
    sp(g, ctx, kind === "laser" ? "second_laser" : "second_paddle");
    sp(g, ctx, "stay_on_line");
    return back(vr, "added-menu", { n: 1 }); // no key: on to the keep-shopping line
  },

  async "second-choice"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "add", { p, d: date, q: 1 }); // one more of the same item, the same date
    if (d === "0") return back(vr, "cart");
    if (d === "*") return starToCategory(vr, Number(p));
    if (d) sp(vr, ctx, "not_valid");
    return back(vr, "added-second", { p, d: date });
  },

  /** Old step name (a call in the middle of it when this went live): box 25's keep-shopping part. */
  "added-rest"(_ctx, vr) {
    return back(vr, "added-menu", { n: 1 });
  },

  /** Box 151 dropped (Nov 22, 2026): a call still on the old step goes on to box 25. */
  another(_ctx, vr) {
    return back(vr, "added-menu");
  },

  /**
   * Row 11, every time an item is added (Abraham, Nov 19, 2026): "This item was successfully added to your cart. To go
   * to your shopping cart, press 0. To keep shopping, for same day, press 1. For another day, press 2."
   */
  "added-menu"(ctx, vr) {
    const n = ctx.query.get("n") ?? undefined;
    const o = ctx.query.get("o") ?? undefined; // the first balloon's date: the ocean balls offer (Nov 25, 2026, 14:08)
    const g = keypad(vr, url("after-add", { n, o }));
    // Box 25 (Abraham, Nov 22, 2026): every item; n = the added line already played with the second-one offer
    if (n) sp(g, ctx, "box25_keep");
    else {
      const a = ctx.session?.data.lastAdded;
      if (a) sp(g, ctx, "box25_added", addedVars(a));
      if (o) sp(g, ctx, "ocean_offer"); // right after the added line, once per call
      sp(g, ctx, "box25_keep");
    }
    menuRun(g, ctx, "cart_key", ["cart_key", "star"]);
    return noInput(vr, ctx, "added-menu", { n, o }); // no key: box 25 again (Batch 3 item 10)
  },

  async "after-add"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "book"); // star: one menu back, the bookings menu (Abraham, Nov 18, 2026)
    if (d === "1") return back(vr, "cats"); // keep shopping, the same day: the categories menu (box 12a, Nov 22, 2026)
    if (d === "2") return back(vr, "date", { a: 1 }); // "To book another day, press 2." (Abraham, Nov 17, 2026); a = another day
    if (d === "0") return back(vr, "cart");
    const o = ctx.query.get("o") ?? undefined;
    if (d === "9" && o) return back(vr, "ocean", { d: o }); // the ocean balls amounts (Nov 25, 2026, 14:08)
    if (d) {
      sp(vr, ctx, "not_valid");
      return back(vr, "added-menu", { o });
    }
    return noInput(vr, ctx, "added-menu", { n: ctx.query.get("n") ?? undefined, o }); // Batch 3 item 10
  },

  /** Extra laser gun packs after a maze or guns (Abraham, Nov 17, 2026): 1 = 6-pack $75, 2 = 4-pack $50, # skips. */
  async packs(ctx, vr) {
    const d = ctx.query.get("d")!;
    const offer = (await packOffer(ctx, d)).slice(0, 2);
    // Extra gun sets already on this day's booking (Abraham, Nov 25, 2026, 14:41): 1 = the second-one line, 2 = the
    // third set at half price, 3 or more = no more offers
    const day = await dayOrder(ctx, d);
    const setLines = (day?.items ?? []).filter((i) => offer.some((x) => x.id === i.productId));
    const sets = setLines.reduce((t, i) => t + i.qty, 0);
    if (sets >= 3) return back(vr, "added-menu", { n: 1 });
    if (sets >= 1) {
      const { orderHasMaze, laserThirdSetHalfOn } = await import("@/lib/orders");
      if (!(await orderHasMaze(db, day!.order.id))) return back(vr, "added-menu", { n: 1 }); // extra sets need the maze
      // "Laser tag: every third set half price" off (Abraham, Nov 25, 2026, 4:03 PM): no third-set line
      if (sets >= 2 && !(await laserThirdSetHalfOn(db))) return back(vr, "added-menu", { n: 1 });
      const kind = offer.find((x) => x.id === setLines.at(-1)!.productId);
      if (!kind?.free) return back(vr, "added-menu", { n: 1 });
      const g = keypad(vr, url("packs-choice", { d, k: kind.key }), { timeout: 5 });
      if (sets === 1) sp(g, ctx, "laser_second_set");
      else sp(g, ctx, "laser_third_set", { price: spokenMoney(await nextSetPrice(day!.order.id, kind.id)) });
      menuRun(g, ctx, "stay_on_line", ["stay_on_line", "star"]);
      return back(vr, "added-menu", { n: 1 }); // no key for 5 seconds: nothing added, on to the keep-shopping lines
    }
    const left = offer.filter((x) => x.free);
    if (!left.length) return back(vr, "added-menu", { n: 1 }); // no pack left for that date: no offer (the added line already played)
    const g = keypad(vr, url("packs-choice", { d }), { timeout: 5 });
    if (left.length === offer.length) {
      if (promptWaiting(ctx.prompts, "laser_packs")) say(g, promptText(ctx.prompts, "laser_packs"));
      else sp(g, ctx, "laser_packs");
    } else {
      // Only one kind left: the question and only that kind's sentence (split at the sentence)
      const parts = promptText(ctx.prompts, "laser_packs").match(/[^.?!]+[.?!]/g)?.map((x) => x.trim()) ?? [];
      say(g, [parts[0], ...left.map((x) => parts[Number(x.key)])].filter(Boolean).join(" "));
    }
    halfPause(g);
    menuRun(g, ctx, "skip_pound", ["skip_pound", "star"]);
    return back(vr, "added-menu", { n: 1 }); // no key: nothing added (Nov 22, 2026)
  },

  async "packs-choice"(ctx, vr) {
    const date = ctx.query.get("d")!;
    const kq = ctx.query.get("k"); // the second-one or third-set line: 1 = one more of that kind
    const k = ctx.body.Digits ?? "";
    if (k === "#" && !kq) return back(vr, "added-menu", { n: 1 });
    if (k === "0") return back(vr, "cart");
    if (k === "*") return back(vr, "added-menu", { n: 1 });
    if (!k) return back(vr, "added-menu", { n: 1 });
    const offer = (await packOffer(ctx, date)).slice(0, 2);
    const pick = kq ? (k === "1" ? offer.find((x) => x.key === kq && x.free) : undefined) : offer.find((x) => x.key === k && x.free); // only a pack that is still there
    if (!pick) {
      sp(vr, ctx, "not_valid");
      return back(vr, "packs", { d: date });
    }
    const day = await dayOrder(ctx, date); // the same rental as the item it goes with (audit H1)
    const r = await reserveItem({ orderId: day?.order.id ?? null, productId: pick.id, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES), callSid: ctx.callSid, pickupDate: keptPickup(ctx, date) });
    if (r.ok) {
      await track(ctx.callSid, "item_added", `Added ${pick.name} for ${spokenDate(date)}`, { item: pick.name, productId: pick.id, qty: 1, date, orderId: r.orderId });
      const ids = [...new Set([...(ctx.session?.data.dayOrderIds ?? []), r.orderId])];
      const lastAdded = { name: pick.name, qty: 1, date };
      await updateSession(ctx.callSid, { data: { dayOrderIds: ids, lastAdded } }, ctx.session);
      sp(vr, ctx, "box25_added", addedVars(lastAdded)); // Batch 3 item 4: the added line, then the offer again
      return back(vr, "packs", { d: date }); // the offer again after every pack (Abraham, Nov 24, 2026)
    }
    sp(vr, ctx, r.reason === "unavailable" ? "just_booked" : "went_wrong", { item: pick.name });
    return back(vr, "added-menu", { n: 1 });
  },

  /**
   * Ocean balls amounts (Abraham, Nov 25, 2026, 14:08): reached with 9 from box 25 (first balloon of the call), the
   * welcome-back added line, or the cart. 1 = 200 for $10, 2 = 500 for $15, 3 = 700 for $20; star = back.
   * n = resume (welcome back) or cart; none = box 25.
   */
  ocean(ctx, vr) {
    const d = ctx.query.get("d")!;
    const n = ctx.query.get("n") ?? undefined;
    const g = keypad(vr, url("ocean-choice", { d, n }));
    menuRun(g, ctx, "ocean_200", ["ocean_200", "ocean_500", "ocean_700", "star"]);
    return noInput(vr, ctx, "ocean", { d, n }); // the system-wide no-key rule
  },

  async "ocean-choice"(ctx, vr) {
    const date = ctx.query.get("d")!;
    const n = ctx.query.get("n") ?? undefined;
    const next = () => (n === "resume" ? back(vr, "resume-added", { d: date, n: 1 }) : n === "cart" ? back(vr, "cart") : back(vr, "added-menu", { n: 1 }));
    const k = ctx.body.Digits ?? "";
    // star: one step back, to the screen that offered the balls
    if (k === "*") return n === "cart" ? back(vr, "cart") : n === "resume" ? back(vr, "resume-added", { d: date, o: date }) : back(vr, "added-menu", { o: date });
    if (k === "0") return back(vr, "cart");
    if (!k) return noInput(vr, ctx, "ocean", { d: date, n });
    const sets = await oceanBallProducts();
    const pick = /^[1-3]$/.test(k) ? sets[Number(k) - 1] : undefined;
    if (!pick) {
      sp(vr, ctx, "not_valid"); // pound too: there is no skip line any more
      return back(vr, "ocean", { d: date, n });
    }
    // On the same day's order as the balloon, so it is on the order and in the payment total
    const day = await dayOrder(ctx, date); // the same rental as the item it goes with (audit H1)
    const r = await reserveItem({ orderId: day?.order.id ?? null, productId: pick.id, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES), callSid: ctx.callSid, pickupDate: keptPickup(ctx, date) });
    if (r.ok) {
      await track(ctx.callSid, "item_added", `Added ${pick.name} for ${spokenDate(date)}`, { item: pick.name, productId: pick.id, qty: 1, date, orderId: r.orderId });
      const ids = [...new Set([...(ctx.session?.data.dayOrderIds ?? []), r.orderId])];
      const lastAdded = { name: pick.name, qty: 1, date };
      await updateSession(ctx.callSid, { data: { dayOrderIds: ids, lastAdded } }, ctx.session);
      sp(vr, ctx, "box25_added", addedVars(lastAdded)); // Batch 3 item 4: the added line for the add-on
    } else sp(vr, ctx, "went_wrong");
    return next(); // row 11 follows (Nov 19, 2026)
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
    // Item removed (box 29a): "Here is your updated cart." then the cart from its date line
    sp(g, ctx, ctx.query.get("u") ? "cart_updated" : "cart_intro");
    for (const o of days) sp(g, ctx, "cart_day", { date: spokenDate(o.order.eventDate), items: itemsPhrase(o.items) });
    sp(g, ctx, "cart_total", { total: spokenMoney(days.reduce((t, o) => t + o.order.subtotalCents, 0)) });
    sp(g, ctx, "cart_options");
    // Ocean balls from the cart (Abraham, Nov 25, 2026, 14:08): while a jumping balloon is in the cart, even after balls
    if (await cartBalloonDay(ctx)) sp(g, ctx, "cart_ocean");
    backLine(g, ctx);
    // From an item list: once the cart has been read, the same item list plays again (Abraham, Phone Menu v3)
    if (c) return back(vr, "category", { c });
    return noInput(vr, ctx, "cart");
  },

  async "cart-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    const c = ctx.query.get("c") ?? undefined;
    // Star: one step back. With no list to return to, box 25 (when something is in the cart), else the bookings menu;
    // never the main menu (Hark's audit M6, Nov 24, 2026)
    if (d === "*") return c ? back(vr, "category", { c }) : (await callOrders(ctx)).length ? back(vr, "added-menu") : back(vr, "book");
    if (d === "1") {
      sp(vr, ctx, "checkout_tax_note"); // Abraham (Phone Menu v3): before checkout
      // Nov 23, 2026 (Abraham): the address lookup comes BEFORE the name; a found family gives the name, no name question
      await updateSession(ctx.callSid, { data: { lookupDone: undefined, nameFromDirectory: undefined } }, ctx.session);
      if (addrStepsActive(ctx) && directoryLookupOn()) return back(vr, "addr-lookup");
      return back(vr, "ask", { f: "name" });
    }
    if (d === "2") return c ? back(vr, "category", { c }) : back(vr, "cats"); // keep shopping: the categories menu (Batch 3 item 9, Nov 25, 2026)
    if (d === "3") return back(vr, "remove"); // remove an item (box 29b)
    if (d === "9") {
      const day = await cartBalloonDay(ctx);
      if (day) return back(vr, "ocean", { d: day, n: "cart" }); // the amounts, then back to the cart
    }
    if (d === "4") {
      // refresh the cart and start over (box 29)
      for (const o of await callOrders(ctx)) await cancelHold(o.order.id);
      await updateSession(ctx.callSid, { orderId: null, outcome: "browsing", data: { dayOrderIds: [], day: undefined } }, ctx.session);
      sp(vr, ctx, "cart_empty"); // Nov 22, 2026: the empty cart line, then straight to the bookings menu
      return back(vr, "book");
    }
    if (d) {
      sp(vr, ctx, "not_valid"); // # or any other key
      return back(vr, "cart", { c });
    }
    return c ? back(vr, "category", { c }) : noInput(vr, ctx, "cart");
  },

  /**
   * Remove an item (box 29b, Abraham, Nov 22, 2026): "You have in your cart {amount} items." then one line per item in
   * cart order, each its own key, then the star line. One of it: removed right away; more: how many to remove.
   */
  async remove(ctx, vr) {
    const lines = await cartLines(ctx);
    if (!lines.length) {
      sp(vr, ctx, "cart_empty");
      return back(vr, "book");
    }
    const g = keypad(vr, url("remove-choice"), lines.length > 9 ? { numDigits: 2, timeout: MULTI_KEY_WAIT_SECONDS } : {});
    if (lines.length === 1) sp(g, ctx, "remove_count_one"); // "one, item" (Nov 22, 2026)
    else sp(g, ctx, "remove_count", { amount: lines.length });
    // Abraham, Nov 22, 2026: the date only when the same item is in the cart for two different days
    const twoDays = (l: CartLine) => new Set(lines.filter((x) => x.name === l.name).map((x) => x.date)).size > 1;
    lines.forEach((l, i) => (twoDays(l) ? sp(g, ctx, "remove_item_date", { item: l.name, date: spokenDate(l.date), key: i + 1 }) : sp(g, ctx, "remove_item", { item: l.name, key: i + 1 })));
    backLine(g, ctx);
    return noInput(vr, ctx, "remove");
  },

  async "remove-choice"(ctx, vr) {
    const d = (ctx.body.Digits ?? "").replace(/#/g, "");
    if (d.startsWith("*")) return back(vr, "cart");
    const lines = await cartLines(ctx);
    const l = /^\d{1,2}$/.test(d) ? lines[Number(d) - 1] : undefined;
    if (!l) {
      if (!d) return noInput(vr, ctx, "remove");
      sp(vr, ctx, "not_valid");
      return back(vr, "remove");
    }
    if (l.qty === 1) return removeFromCart(ctx, vr, l, 1);
    return back(vr, "remove-qty", { i: l.itemId });
  },

  /** More than one of it: "You have {Qnt} {item}." "Using your keypad, please enter the amount you would like to remove." */
  async "remove-qty"(ctx, vr) {
    const l = (await cartLines(ctx)).find((x) => x.itemId === Number(ctx.query.get("i")));
    if (!l) return back(vr, "cart");
    const g = keypad(vr, url("remove-qty-choice", { i: l.itemId }), { numDigits: 2, timeout: MULTI_KEY_WAIT_SECONDS });
    sp(g, ctx, "remove_qty", { qty: l.qty, item: pluralName(l.name) });
    menuRun(g, ctx, "remove_enter", ["remove_enter", "star"]);
    return noInput(vr, ctx, "remove-qty", { i: l.itemId });
  },

  async "remove-qty-choice"(ctx, vr) {
    const d = (ctx.body.Digits ?? "").replace(/#/g, "");
    const i = ctx.query.get("i") ?? "";
    if (d.includes("*")) return back(vr, "remove");
    const l = (await cartLines(ctx)).find((x) => x.itemId === Number(i));
    if (!l) return back(vr, "cart");
    if (!d) return noInput(vr, ctx, "remove-qty", { i });
    const n = Number(d);
    if (!/^\d+$/.test(d) || n < 1 || n > l.qty) {
      sp(vr, ctx, "not_valid");
      return back(vr, "remove-qty", { i });
    }
    return removeFromCart(ctx, vr, l, n);
  },

  /* ---- checkout: name -> address -> email -> phone -> finalize ---- */

  async ask(ctx, vr) {
    if (!(await callOrders(ctx)).length) return cartGone(vr, ctx); // the checkout questions: the cart's time ran out
    const f = ctx.query.get("f") as Field;
    const n = ctx.query.get("n") ?? undefined;
    const spec = FIELDS[f];
    const prompt: PromptKey = f === "email" && ctx.session?.data.emailRequired ? "ask_email_required" : spec.prompt;
    // Abraham, Nov 17, 2026: not understood = only the retry line (the step's own line, with its thanks, never
    // repeats); every spoken question is followed by the tone, then the caller speaks.
    const retry = Number(n || 0) > 0;
    // Abraham, Nov 24, 2026: after every spoken question, type_hint ("To type it with your keypad, press 9."); the unit
    // is typed on the keypad anyway (addr-unit)
    // The street (Nov 24, 2026): the caller chose voice in the street menu, so no keypad line; the tone right after
    const ownHint = f === "unit" || f === "street";
    const tone = `${config.baseUrl()}/audio/tone.wav`;
    const question = (g: Gather, withTone = true) => {
      if (retry) sp(g, ctx, "field_unclear"); // the one shared did-not-catch line (Nov 22, 2026)
      else {
        spPreviewDraft(g, ctx, prompt);
        if (!ownHint) {
          sp(g, ctx, "type_hint");
        }
      }
      if (withTone) g.play(tone);
    };
    if (sttActive()) {
      // Speech to text: the question with a moment for a key (star or 9 to type, pound to skip email), then the tone
      // and the recording starts the moment the tone ends (Hark's audit H2, Nov 24, 2026: with the tone inside the
      // key window, the first second of the answer was lost and short names came back empty)
      const k = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 1, finishOnKey: "", action: url("heard", { f, n }), method: "POST" });
      question(k, false);
      vr.play(tone);
      vr.record({ maxLength: 20, timeout: 3, playBeep: false, finishOnKey: "#*9", trim: "trim-silence", action: url("stt-recorded", { f, n }), method: "POST" });
      return vr;
    }
    // Say it, or press star to type it on the keypad (Abraham L). finishOnKey "" so star and # arrive as keys.
    // Pound ends a spoken answer and keeps what was said so far (Abraham, Nov 17, 2026): Twilio's partial results are
    // saved as the caller speaks, because a key press alone would drop the words.
    await updateSession(ctx.callSid, { data: { speechPartial: undefined } }, ctx.session);
    const hints = f === "street" ? (await streetsForZip(ctx.session?.data.zip)).join(", ") : spec.hints;
    const g = speech(vr, url("heard", { f, n }), hints, { dtmf: true, numDigits: 1, finishOnKey: "", partial: url("speech-partial") });
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
    if (f === "street") return back(vr, "addr-street-keys"); // the street keypad search (Nov 24, 2026)
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 15, action: url("typed", { f }), method: "POST" });
    // Abraham, Nov 24, 2026: after 9, the directions (type_instructions) and a short beep, then keys; a key pressed during
    // the directions stops them and is the first typed key (Twilio's Gather)
    if (!ctx.query.get("again")) sp(g, ctx, "type_instructions");
    g.play(`${config.baseUrl()}/audio/tone.wav`);
    return back(vr, "typed", { f });
  },

  async typed(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    if ((ctx.body.Digits ?? "") === "*") return back(vr, "ask", { f }); // star before typing: back to the question
    const spec = FIELDS[f];
    const raw = decodeMultitap(ctx.body.Digits || "", f === "email" ? "email" : "text");
    const value = raw ? (f === "email" ? spec.normalize(raw) : titleCase(raw)) : null;
    if (!value) {
      sp(vr, ctx, "field_unclear");
      return back(vr, "type", { f, again: 1 });
    }
    await track(ctx.callSid, "typed", `Typed ${f}: ${value}`, { field: f, value });
    await updateSession(ctx.callSid, { data: { heard: value } }, ctx.session);
    const g = keypad(vr, url("confirm", { f, t: 1 }));
    readBackLine(g, ctx, "typed_back", f, value);
    confirmEnd(g, ctx);
    return noInput(vr, ctx, "readback", { f, t: 1 });
  },

  /** Speech to text: the answer was recorded. Type it up in the background; the caller hears the hold clip. */
  async "stt-recorded"(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const n = ctx.query.get("n") ?? undefined;
    const digits = ctx.body.Digits || "";
    const secs = Number(ctx.body.RecordingDuration || 0);
    // Every question (Abraham, Nov 24, 2026): 9 types it, star goes back one step
    if (digits === "9") return back(vr, "type", { f });
    if (digits === "*") return back(vr, ...prevStep(f));
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
    // Every question (Abraham, Nov 24, 2026): 9 switches to keypad typing, star goes back one step
    if (ctx.body.Digits === "9") return back(vr, "type", { f });
    if (ctx.body.Digits === "*") return back(vr, ...prevStep(f));
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
      // Box 40 (Abraham, Nov 24, 2026): skipping the email goes straight to the texting number step, no line between
      if (f === "email" && n >= 2 && !required) return back(vr, "phone");
      if (n >= MAX_NO_INPUT) {
        // Box 41 (Abraham, Nov 24, 2026): never a person, never typing on its own; back to this field's first menu, where
        // the caller says it again or presses 9 to type
        sp(vr, ctx, "field_trouble");
        return f === "street" ? back(vr, "addr-street") : back(vr, "ask", { f });
      }
      // the ask step plays the shared did-not-catch line itself (Nov 22, 2026)
      return back(vr, "ask", { f, n });
    }
    await track(ctx.callSid, "said", `Said ${f}: ${value}`, { field: f, value, raw, ...(viaStt ? { via: "speech to text" } : {}) });
    if (f === "street") {
      // Voice search (Abraham, Nov 24, 2026): the closest street in the zip's list, read back: 1 confirms, 2 says it again
      const match = closestStreet(value, await streetsForZip(ctx.session?.data.zip)) ?? value;
      await track(ctx.callSid, "step", `Street voice search: heard "${value}", closest street ${match}`);
      await updateSession(ctx.callSid, { data: { heard: match } }, ctx.session);
      return back(vr, "addr-street-rb", { m: "v" });
    }
    if (f === "unit") {
      // The address steps read the whole address back at step 6, not each part
      await updateSession(ctx.callSid, { data: { [f]: value, heard: undefined } }, ctx.session);
      return back(vr, spec.next);
    }
    await updateSession(ctx.callSid, { data: { heard: value } }, ctx.session);
    if (viaStt) {
      // Read back in the Google voice (never Twilio's Say); the draft wording plays on preview for Abraham's test
      const links = await googleReadback(lineTemplate(ctx, "spoken_readback"), { text: spec.readBack(value) });
      if (!links) return back(vr, "type", { f }); // Google voice not available: type it on the keypad instead
      // Nov 23, 2026: the shared Confirm ending; 1 confirms, 2 records the answer again from the start of this step
      const g = keypad(vr, url("confirm", { f }));
      for (const l of links) g.play(l);
      confirmEnd(g, ctx);
      return noInput(vr, ctx, "readback", { f });
    }
    const g = keypad(vr, url("confirm", { f }));
    sp(g, ctx, "heard", { value: spec.readBack(value) });
    confirmEnd(g, ctx);
    return noInput(vr, ctx, "readback", { f });
  },

  /**
   * Directions for the driver (Abraham, Nov 15, 2026): optional, after the address. Pound (or nothing said) skips.
   * The wording is a draft: the step runs on preview only until Abraham approves the two lines.
   */
  /**
   * Box 34 (Abraham, Nov 21, 2026, 23:26 and 23:27): "To add any special delivery instructions, press 1. To skip, press
   * pound. To go back, press star." Pound or silence skips; star = back to the address read-back; a wrong key = the
   * shared line, then the menu again.
   */
  directions(ctx, vr) {
    const g = keypad(vr, url("directions-choice"), { timeout: NO_KEY_SECONDS });
    sp(g, ctx, "box34_menu");
    sp(vr, ctx, "almost_done"); // Nov 25, 2026, 12:08: "Almost done!" then box 56, no pause
    return back(vr, "finalize"); // silence: skip; box 56 next (Box 35 moved after payment, Nov 25, 2026, 11:51)
  },

  "directions-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "directions-record");
    if (d === "#" || !d) {
      sp(vr, ctx, "almost_done"); // then box 56, no pause (Nov 25, 2026, 12:08)
      return back(vr, "finalize");
    }
    if (d === "*") return back(vr, "addr-readback");
    sp(vr, ctx, "not_valid");
    return back(vr, "directions");
  },

  /** After key 1: the message after the tone, pound when done (no hang-up option, Nov 24, 2026, 20:51). Recorded, not transcribed. */
  async "directions-record"(ctx, vr) {
    const o = (await callOrders(ctx))[0]?.order.id ?? ctx.session?.orderId ?? 0;
    sp(vr, ctx, "box34_record");
    sp(vr, ctx, "pound_done");
    vr.play(`${config.baseUrl()}/audio/tone.wav`);
    vr.record({ maxLength: 180, timeout: 10, playBeep: false, finishOnKey: "#", trim: "trim-silence", action: url("directions-recorded", { o }), method: "POST", recordingStatusCallback: url("directions-rec-status", { o }), recordingStatusCallbackMethod: "POST" });
    sp(vr, ctx, "almost_done");
    return back(vr, "finalize"); // nothing recorded: on with checkout
  },

  /** Pound (or the caller hung up): the message is saved with the booking; then the thank-you and straight to box 56. */
  async "directions-recorded"(ctx, vr) {
    const o = Number(ctx.query.get("o")) || null;
    const b = ctx.body;
    const secs = Number(b.RecordingDuration || 0);
    if (b.RecordingSid && b.RecordingUrl && secs > 0) {
      const { saveDeliveryInstructions } = await import("@/lib/voicemail");
      await saveDeliveryInstructions({ orderId: o, callSid: ctx.callSid, from: ctx.from ?? null, recordingSid: b.RecordingSid, recordingUrl: b.RecordingUrl, durationSec: secs, ready: false });
      await updateSession(ctx.callSid, { data: { directions: `Recorded message (${secs} seconds)` } }, ctx.session);
      await track(ctx.callSid, "step", `Box 34: delivery instructions recorded (${secs} seconds)`);
      sp(vr, ctx, "box34_thanks");
    }
    sp(vr, ctx, "almost_done"); // after the thank-you (Nov 25, 2026, 12:08)
    return back(vr, "finalize"); // Nov 24, 2026, 20:59: box 56 right after, no pause
  },

  /** Twilio: the recording file is ready (also after a hang-up mid-message): kept on the booking. */
  async "directions-rec-status"(ctx, vr) {
    const b = ctx.body;
    if (b.RecordingStatus === "completed" && b.RecordingSid && b.RecordingUrl) {
      const { saveDeliveryInstructions } = await import("@/lib/voicemail");
      await saveDeliveryInstructions({ orderId: Number(ctx.query.get("o")) || null, callSid: ctx.callSid, from: ctx.from ?? null, recordingSid: b.RecordingSid, recordingUrl: b.RecordingUrl, durationSec: Number(b.RecordingDuration || 0), ready: true });
    }
    return vr;
  },

  /*
   * Delivery address in steps (Abraham, Nov 17, 2026): street (spoken), house number (keypad), apartment or unit
   * (spoken, pound skips), zip (10950 or another), the area check, the read-back, the delivery price, then the
   * directions. Steps 2 to 7 are drafts: the whole flow runs on preview only until he approves them; the live line
   * keeps the one address question until then.
   */
  // Nov 22, 2026 (Abraham): house number, street, unit, town and zip, read-back, delivery price
  async addr(ctx, vr) {
    if (!addrStepsActive(ctx)) return back(vr, "ask", { f: "address" });
    // The phone-number lookup (Nov 23, 2026, approved screens): preview only until Abraham approves the test call
    if (directoryLookupOn() && !ctx.session?.data.lookupDone) return back(vr, "addr-lookup");
    return back(vr, "addr-house");
  },

  /** Lookup screen 1: 1 = the number calling, 2 = a different phone number, 3 = enter the address manually. */
  "addr-lookup"(ctx, vr) {
    const g = keypad(vr, url("addr-lookup-choice"));
    menuRun(g, ctx, "lookup_intro", ["lookup_intro", "lookup_options", "star"]);
    return repeatMenu(vr, ctx, "addr-lookup");
  },

  async "addr-lookup-choice"(ctx, vr) {
    const d = ctx.body.Digits ?? "";
    if (d === "*") return ctx.session?.data.name && !ctx.session.data.nameFromDirectory ? back(vr, "ask", { f: "name" }) : back(vr, "cart"); // star: one step back
    if (d === "1") {
      await updateSession(ctx.callSid, { data: { dirPhone: toE164(ctx.from) ?? undefined } }, ctx.session);
      sp(vr, ctx, "lookup_hold");
      return back(vr, "addr-found");
    }
    if (d === "2") return back(vr, "addr-phone");
    if (d === "3") return manualAddress(ctx, vr);
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-lookup");
  },

  /** A different phone number: 10 digits, starting with the area code; pound when done. */
  "addr-phone"(ctx, vr) {
    const g = keypad(vr, url("addr-phone-heard"), { numDigits: 11, timeout: NO_KEY_SECONDS, finishOnKey: "#" });
    menuRun(g, ctx, "lookup_phone_enter", ["lookup_phone_enter", "pound_done", "star"]);
    return repeatMenu(vr, ctx, "addr-phone");
  },

  async "addr-phone-heard"(ctx, vr) {
    const raw = ctx.body.Digits ?? "";
    if (raw.includes("*")) return back(vr, "addr-lookup"); // star: one step back
    const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); // "1 845 ..." works too (audit L4)
    if (!/^\d{10}$/.test(digits)) {
      sp(vr, ctx, "phone_invalid");
      return back(vr, "addr-phone");
    }
    await updateSession(ctx.callSid, { data: { dirPhone: `+1${digits}` } }, ctx.session);
    sp(vr, ctx, "lookup_hold");
    return back(vr, "addr-found");
  },

  /** Found (one family), found (a shared number: each family, the caller picks), or not found. */
  async "addr-found"(ctx, vr) {
    const list = await lookupByPhone(ctx.session?.data.dirPhone);
    const m = list.length === 0 ? "none" : list.length === 1 ? "one" : "many";
    const g = keypad(vr, url("addr-found-choice", { m, n: list.length }));
    const read = (e: (typeof list)[number]) => {
      for (const part of addressParts({ house: e.house, street: e.street, unit: e.unit, town: e.town, zip: e.zip, areaPrinted: e.areaPrinted })) {
        const urls = part.options.map((keys) => clipUrls(ctx.prompts, keys)).find(Boolean);
        if (urls) urls.forEach((u) => g.play(u));
        else say(g, part.text);
      }
    };
    const name = (e: (typeof list)[number]) => [e.lastName, e.firstName].filter(Boolean).join(", ");
    if (m === "none") {
      sp(g, ctx, "lookup_none");
      sp(g, ctx, "lookup_try", { key: 1 });
      sp(g, ctx, "lookup_manual", { key: 2 });
    } else if (m === "one") {
      sp(g, ctx, "lookup_one");
      await sayName(g, `${name(list[0])}.`); // the name at the names speed (Nov 25, 2026, 12:36)
      read(list[0]);
      sp(g, ctx, "addr_rb_correct");
      sp(g, ctx, "lookup_try", { key: 2 });
      sp(g, ctx, "lookup_manual", { key: 3 });
    } else {
      sp(g, ctx, "lookup_many");
      for (const [i, e] of list.entries()) {
        // "For" from its recording (or the live voice), then the name at the names speed (Nov 25, 2026, 12:36)
        const [before] = promptText(ctx.prompts, "lookup_for", { name: "\u0000" }).split("\u0000");
        const forUrls = clipUrls(ctx.prompts, ["lookup_for#1"]);
        if (forUrls) forUrls.forEach((u) => g.play(u));
        else if (before.trim()) say(g, before);
        await sayName(g, `${name(e)},`);
        read(e);
        sp(g, ctx, "lookup_press", { key: i + 1 });
      }
      // Two families: slot B, one take (Nov 23, 2026); more families: the two lines with their own keys
      if (list.length === 2) sp(g, ctx, "lookup_many_options");
      else {
        sp(g, ctx, "lookup_try", { key: list.length + 1 });
        sp(g, ctx, "lookup_manual", { key: list.length + 2 });
      }
    }
    backLine(g, ctx);
    await track(ctx.callSid, "step", `Address lookup: ${m === "none" ? "not found" : `${list.length} found`}`);
    return repeatMenu(vr, ctx, "addr-found");
  },

  async "addr-found-choice"(ctx, vr) {
    const d = ctx.body.Digits ?? "";
    const m = ctx.query.get("m");
    const n = Number(ctx.query.get("n") || 0);
    if (d === "*") return back(vr, "addr-lookup"); // star: one step back
    const tryKey = m === "none" ? "1" : m === "one" ? "2" : String(n + 1);
    const manualKey = m === "none" ? "2" : m === "one" ? "3" : String(n + 2);
    if (d === tryKey) return back(vr, "addr-phone");
    if (d === manualKey) return manualAddress(ctx, vr);
    const list = m === "none" ? [] : await lookupByPhone(ctx.session?.data.dirPhone);
    const pick = m === "one" && d === "1" ? list[0] : m === "many" && /^\d{1,2}$/.test(d) && Number(d) <= n ? list[Number(d) - 1] : undefined;
    if (!pick) {
      sp(vr, ctx, "not_valid");
      return back(vr, "addr-found");
    }
    const street = findStreet(pick.street)?.spoken ?? pick.street;
    // The order name from the directory: last name, then first name (Nov 23, 2026); no name question
    const dirName = [pick.lastName, pick.firstName].filter(Boolean).join(", ");
    await updateSession(ctx.callSid, { data: { lookupDone: true, ...(dirName ? { name: dirName, nameFromDirectory: true } : {}), house: pick.house, street: pick.street, unit: pick.unit ?? undefined, zip: pick.zip, town: pick.town, dirArea: pick.areaPrinted ?? undefined, dirPick: `${pick.house} ${street}${pick.unit ? `, unit ${pick.unit}` : ""}` } }, ctx.session);
    await track(ctx.callSid, "step", `Address lookup: the caller confirmed an address${n > 1 ? ` (${n} on the number)` : ""}`);
    return back(vr, "addr-check", { dir: 1 });
  },

  // Address steps 2 to 4 (Abraham, Nov 22, 2026, final): keypad only, the shared pound line, then the shared star line
  "addr-house"(ctx, vr) {
    const g = keypad(vr, url("addr-house-heard"), { numDigits: 7, timeout: 10, finishOnKey: "#" });
    menuRun(g, ctx, "addr_house", ["addr_house", "pound_done", "star"]);
    return repeatMenu(vr, ctx, "addr-house");
  },

  async "addr-house-heard"(ctx, vr) {
    if ((ctx.body.Digits || "").includes("*")) return back(vr, "ask", { f: "name" }); // star: one step back, the name
    const digits = (ctx.body.Digits || "").replace(/\D/g, "");
    if (!/^[0-9]{1,6}$/.test(digits) || /^0+$/.test(digits)) {
      sp(vr, ctx, "not_valid");
      return back(vr, "addr-house");
    }
    await updateSession(ctx.callSid, { data: { house: digits } }, ctx.session);
    return back(vr, "addr-zip"); // Nov 25, 2026: house number, zip, street (searched in the zip's list), then the unit
  },

  /**
   * The unit question (Abraham, Nov 25, 2026), after the street: an address with a household in the directory goes
   * straight to the unit step (required). Not in the directory: "If this address has a unit number, press 1. If not,
   * press 2." 1 = the unit step; 2 = no unit, the order is flagged "Unit not verified"; star = back to the street.
   */
  async "addr-unit-ask"(ctx, vr) {
    const d = ctx.session?.data ?? {};
    if (!d.house || !d.street) return back(vr, "addr-house");
    const { directoryHasHouse } = await import("@/lib/directory");
    if (await directoryHasHouse({ house: d.house, street: d.street, zip: d.zip })) return back(vr, "addr-unit");
    const g = keypad(vr, url("addr-unit-ask-choice"));
    menuRun(g, ctx, "addr_unit_ask", ["addr_unit_ask", "star"]);
    return repeatMenu(vr, ctx, "addr-unit-ask");
  },

  async "addr-unit-ask-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "addr-street"); // star: back to the street step
    if (d === "1") return back(vr, "addr-unit", { a: 1 });
    if (d === "2") {
      await updateSession(ctx.callSid, { data: { unit: undefined, unitUnverified: true } }, ctx.session);
      await track(ctx.callSid, "step", "Unit question: no unit (not in the directory), order flagged Unit not verified");
      return back(vr, "addr-check");
    }
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-unit-ask");
  },

  /** The unit number on the keypad (Nov 25, 2026: required, no skip; pound with nothing typed is a wrong key). */
  "addr-unit"(ctx, vr) {
    // actionOnEmptyResult: pound with nothing typed reaches us, so it gets the wrong-key line (not the no-key line)
    const a = ctx.query.get("a") ?? undefined;
    const g = vr.gather({ input: ["dtmf"], numDigits: 7, timeout: 10, finishOnKey: "#", actionOnEmptyResult: true, action: url("addr-unit-heard", { a }), method: "POST" });
    menuRun(g, ctx, "addr_unit", ["addr_unit", "pound_done", "star"]);
    return repeatMenu(vr, ctx, "addr-unit", { a });
  },

  async "addr-unit-heard"(ctx, vr) {
    const raw = ctx.body.Digits || "";
    const a = ctx.query.get("a") ?? undefined;
    if (raw.includes("*")) return back(vr, a ? "addr-unit-ask" : "addr-street"); // star: one step back
    const unit = raw.replace(/\D/g, "");
    if (!unit) {
      // Pound with nothing typed: the wrong-key line, then the unit question again; a real timeout: the no-key rule
      if (ctx.body.FinishedOnKey !== "#") return idleNoKey(vr, ctx, "addr-unit", { a });
      sp(vr, ctx, "not_valid");
      return back(vr, "addr-unit", { a });
    }
    await updateSession(ctx.callSid, { data: { unit, unitUnverified: undefined } }, ctx.session);
    return back(vr, "addr-check");
  },

  "addr-zip"(ctx, vr) {
    const g = keypad(vr, url("addr-zip-choice"));
    menuRun(g, ctx, "addr_zip", ["addr_zip", "star"]);
    return repeatMenu(vr, ctx, "addr-zip");
  },

  async "addr-zip-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "addr-house"); // star: one step back (Nov 25, 2026: the zip comes after the house number)
    // The zip menu, keys 1 to 7 (Abraham, Nov 24, 2026, matching the approved recording); Blooming Grove uses Monroe 10950
    const zip = ZIP_MENU_KEYS[d ?? ""];
    if (zip) {
      await updateSession(ctx.callSid, { data: { zip } }, ctx.session);
      return back(vr, "addr-street");
    }
    if (d === "7") return back(vr, "addr-zip-enter");
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-zip");
  },

  "addr-zip-enter"(ctx, vr) {
    const g = keypad(vr, url("addr-zip-heard"), { numDigits: 6, timeout: 10, finishOnKey: "#" });
    if (ctx.query.get("bad")) sp(g, ctx, "addr_zip_bad"); // Nov 23, 2026: the invalid line, then the entry prompt again
    sp(g, ctx, "addr_zip_enter");
    return repeatMenu(vr, ctx, "addr-zip-enter", { bad: ctx.query.get("bad") ?? undefined });
  },

  async "addr-zip-heard"(ctx, vr) {
    if ((ctx.body.Digits || "").includes("*")) return back(vr, "addr-zip"); // star: back to the zip menu (audit L5)
    const zip = (ctx.body.Digits || "").replace(/\D/g, "");
    if (!/^[0-9]{5}$/.test(zip)) return back(vr, "addr-zip-enter", { bad: 1 });
    await updateSession(ctx.callSid, { data: { zip } }, ctx.session);
    return back(vr, "addr-street");
  },

  /*
   * The street step (Abraham, Nov 24, 2026, final), after the house number, unit and zip: "To search for the street name
   * by voice, press 1. To search it with your keypad, press 2." Star = back to the zip menu. No keypad-typing line here.
   */
  "addr-street"(ctx, vr) {
    const g = keypad(vr, url("addr-street-choice"));
    menuRun(g, ctx, "addr_street_menu", ["addr_street_menu", "star"]);
    return repeatMenu(vr, ctx, "addr-street");
  },

  "addr-street-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "addr-zip"); // star: one step back
    if (d === "1") return back(vr, "ask", { f: "street" }); // voice: the Address step 2 recording, the tone, then the search
    if (d === "2") return back(vr, "addr-street-keys");
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-street");
  },

  /** Keypad search: the first four letters (multi-tap), then pound. Star alone = back to the street menu. */
  "addr-street-keys"(ctx, vr) {
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 15, action: url("addr-street-typed"), method: "POST" });
    if (!ctx.query.get("again")) {
      spPreviewDraft(g, ctx, "street_keys_intro"); // draft: preview only until Abraham approves the wording
      sp(g, ctx, "type_instructions");
    }
    g.play(`${config.baseUrl()}/audio/tone.wav`);
    return back(vr, "addr-street-typed");
  },

  async "addr-street-typed"(ctx, vr) {
    const raw = ctx.body.Digits ?? "";
    if (raw === "*") return back(vr, "addr-street");
    const typed = decodeMultitap(raw, "text");
    if (!typed.replace(/[^A-Za-z]/g, "")) {
      sp(vr, ctx, "field_unclear");
      return back(vr, "addr-street-keys", { again: 1 });
    }
    const list = await streetsForZip(ctx.session?.data.zip);
    const matches = streetsByPrefix(typed, list);
    await track(ctx.callSid, "typed", `Street keypad search: "${typed}", ${matches.length} street${matches.length === 1 ? "" : "s"} found${matches.length ? `: ${matches.slice(0, 9).join(", ")}` : ""}`, { field: "street", value: typed });
    const live = (key: PromptKey) => !(process.env.VERCEL_ENV === "production" && promptWaiting(ctx.prompts, key));
    const pick = (street: string) => updateSession(ctx.callSid, { data: { heard: street, streetMatches: undefined } }, ctx.session);
    if (matches.length === 1) {
      await pick(matches[0]);
      return back(vr, "addr-street-rb", { m: "k" });
    }
    if (matches.length > 1 && live("street_pick_item")) {
      await updateSession(ctx.callSid, { data: { streetMatches: matches.slice(0, 9) } }, ctx.session);
      return back(vr, "addr-street-pick");
    }
    if (!matches.length && live("street_none")) return back(vr, "addr-street-none");
    // The new lines are still waiting for Abraham's OK (live line): the whole name typed is used, as before
    await pick(exactStreet(typed, matches) ?? titleCase(typed));
    return back(vr, "addr-street-rb", { m: "k" });
  },

  /** Several streets start with those letters: each with its own key ("For {street}, press {key}."). */
  "addr-street-pick"(ctx, vr) {
    const list = ctx.session?.data.streetMatches ?? [];
    if (!list.length) return back(vr, "addr-street");
    const g = keypad(vr, url("addr-street-pick-choice"));
    list.forEach((street, i) => {
      if (i) halfPause(g);
      spPreviewDraft(g, ctx, "street_pick_item", { street, key: i + 1 });
    });
    backLine(g, ctx);
    return repeatMenu(vr, ctx, "addr-street-pick");
  },

  async "addr-street-pick-choice"(ctx, vr) {
    const d = ctx.body.Digits ?? "";
    if (d === "*") return back(vr, "addr-street-keys"); // star: back to the letters
    const list = ctx.session?.data.streetMatches ?? [];
    const street = /^[1-9]$/.test(d) ? list[Number(d) - 1] : undefined;
    if (!street) {
      if (d) sp(vr, ctx, "not_valid");
      return back(vr, "addr-street-pick");
    }
    await updateSession(ctx.callSid, { data: { heard: street, streetMatches: undefined } }, ctx.session);
    return back(vr, "addr-street-rb", { m: "k" });
  },

  /** No street starts with those letters: 1 = try the letters again, 2 = search by voice. */
  "addr-street-none"(ctx, vr) {
    const g = keypad(vr, url("addr-street-none-choice"));
    spPreviewDraft(g, ctx, "street_none");
    backLine(g, ctx);
    return repeatMenu(vr, ctx, "addr-street-none");
  },

  "addr-street-none-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "addr-street-keys");
    if (d === "2") return back(vr, "ask", { f: "street" });
    if (d === "*") return back(vr, "addr-street");
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-street-none");
  },

  /** The street found, read back ("I heard:" by voice, "You typed:" by keypad), then 1 = correct, 2 = search again. */
  "addr-street-rb"(ctx, vr) {
    const street = ctx.session?.data.heard;
    const keys = ctx.query.get("m") === "k";
    if (!street) return back(vr, "addr-street");
    const g = keypad(vr, url("addr-street-rb-choice", { m: keys ? "k" : "v" }));
    readBackLine(g, ctx, keys ? "typed_back" : "heard", "street", street);
    confirmEnd(g, ctx);
    return repeatMenu(vr, ctx, "addr-street-rb", { m: keys ? "k" : "v" });
  },

  async "addr-street-rb-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    const keys = ctx.query.get("m") === "k";
    if (d === "*") return back(vr, "addr-street"); // star: back to the street menu
    if (d === "2") return keys ? back(vr, "addr-street-keys") : back(vr, "ask", { f: "street" }); // say it / type it again
    const street = ctx.session?.data.heard;
    if (d === "1" && street) {
      await track(ctx.callSid, keys ? "typed" : "said", `Street: ${street}`, { field: "street", value: street });
      await updateSession(ctx.callSid, { data: { street, heard: undefined, streetMatches: undefined } }, ctx.session);
      return back(vr, "addr-unit-ask"); // Nov 25, 2026: the unit after the street
    }
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-street-rb", { m: keys ? "k" : "v" });
  },

  /** Step 5: the town from the zip (Orange County only), then the delivery map (the street decides the price). */
  async "addr-check"(ctx, vr) {
    const data = ctx.session?.data ?? {};
    if (!data.house) return back(vr, "addr-house");
    if (!data.street) return back(vr, "addr-street");
    const zip = data.zip ?? DEFAULT_ZIP;
    const town = townForZip(zip);
    if (!town) return back(vr, "addr-outside");
    const address = `${data.house} ${data.street}${data.unit ? `, ${data.unit}` : ""}, ${town}, NY ${zip}`;
    const firstDay = (await callOrders(ctx))[0]?.order.eventDate;
    const quote = await deliveryQuote(address, await getSettings(), fetch, firstDay ?? new Date());
    if (!quote.ok && quote.reason === "not_found") {
      // Street not found (Abraham, Nov 24, 2026): the house number, unit and zip are kept; only the street is asked again
      await updateSession(ctx.callSid, { data: { street: undefined, town: undefined, address: undefined, dirArea: undefined, dirPick: undefined } }, ctx.session);
      sp(vr, ctx, "addr_not_found");
      return back(vr, "addr-street");
    }
    if (!quote.ok) return back(vr, "addr-outside");
    // The postal town always (Abraham, Nov 22, 2026: the Kiryas Joel idea was withdrawn)
    const placeTown = town;
    const placeAddress = address;
    await updateSession(ctx.callSid, { data: { address: placeAddress, town: placeTown, zip } }, ctx.session);
    // Directory address match for an address entered by hand (Abraham, Nov 25, 2026): house number, street, unit and
    // zip all equal. A match uses that household's name; no new spoken line (the match-found wording is pending).
    if (ctx.query.get("dir") !== "1") await applyDirectoryMatch(ctx, { house: data.house, street: data.street, unit: data.unit ?? null, zip });
    // From the lookup (Nov 23, 2026): the caller confirmed it; Menu 2 (one line) right away
    if (ctx.query.get("dir") === "1") return back(vr, "addr-price");
    await track(ctx.callSid, "said", `Address: ${placeAddress} (${quote.zone}, ${money(quote.feeCents)})`, { field: "address", value: placeAddress });
    return back(vr, "addr-readback");
  },

  /** Step 5 outside the service area (Abraham, Nov 22, 2026, approved): 1 = a different zip code; the star line. */
  "addr-outside"(ctx, vr) {
    const g = keypad(vr, url("addr-outside-choice"));
    menuRun(g, ctx, "addr_outside", ["addr_outside", "star"]);
    return repeatMenu(vr, ctx, "addr-outside");
  },

  "addr-outside-choice"(ctx, vr) {
    if (ctx.body.Digits === "1") return back(vr, "addr-zip-enter");
    if (ctx.body.Digits === "*") return back(vr, "addr-zip"); // star: one step back
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-outside");
  },

  /**
   * Step 6 (Abraham, Nov 22, 2026, final): "Here is the address you entered." {house} {street}, unit {unit}, {town}
   * New York, {zip}. "If that is correct, press 1." "To enter the address again, press 2." Then the star line.
   */
  async "addr-readback"(ctx, vr) {
    const d = ctx.session?.data ?? {};
    if (!d.address || !d.house || !d.street || !d.zip || !d.town) return back(vr, "addr-house");
    const g = keypad(vr, url("addr-readback-choice"));
    sp(g, ctx, "addr_rb_intro");
    // Joined from Hark's recordings part by part (Nov 23, 2026): a part with a live recording plays it, else Puck says it
    const heard: string[] = [];
    for (const part of addressParts({ house: d.house, street: d.street, unit: d.unit ?? null, town: d.town, zip: d.zip, areaPrinted: d.dirArea ?? null })) {
      const urls = part.options.map((keys) => clipUrls(ctx.prompts, keys)).find(Boolean);
      if (urls) urls.forEach((u) => g.play(u));
      else say(g, part.text);
      heard.push(`${part.text} (${urls ? "recording" : "Puck"})`);
    }
    // In the call log: each part and whether it played from a recording or Puck (for the test calls)
    await track(ctx.callSid, "step", `Read-back: ${heard.join(", ")}`);
    confirmEnd(g, ctx); // the shared Confirm ending: 1 correct, 2 enter it again (Hark's audit item 10, Nov 24, 2026)
    backLine(g, ctx);
    return repeatMenu(vr, ctx, "addr-readback");
  },

  async "addr-readback-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "addr-price");
    if (d === "*") return back(vr, "addr-street"); // star: one step back
    if (d === "2") {
      await updateSession(ctx.callSid, { data: { address: undefined, street: undefined, house: undefined, unit: undefined, zip: undefined, town: undefined, unitUnverified: undefined } }, ctx.session);
      return back(vr, "addr-house"); // the address again, from the house number
    }
    sp(vr, ctx, "not_valid");
    return back(vr, "addr-readback");
  },

  /** Menu 2 (Abraham, Nov 24, 2026, 20:56): "Your delivery address has been saved, delivery to {town} is {price}." then box 34. */
  async "addr-price"(ctx, vr) {
    const d = ctx.session?.data ?? {};
    if (!d.address || !d.town) return back(vr, "addr-house");
    const settings = await getSettings();
    const first = (await callOrders(ctx))[0]?.order;
    const quote = await deliveryQuote(d.address, settings, fetch, first?.eventDate ?? new Date());
    if (quote.ok) {
      const cents = quote.kind ? deliveryFeeFor(quote.kind, settings, first?.eventDate ?? todayISO(), first?.offerNote ?? null) : quote.feeCents;
      sp(vr, ctx, "addr_saved_price", { town: townPhrase(d.town), price: spokenMoney(cents) });
    }
    return back(vr, "directions");
  },

  async confirm(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const d = ctx.body.Digits;
    const typed = ctx.query.get("t") === "1";
    if (d === "*") return back(vr, "ask", { f }); // star: one step back, the same question (Nov 20, 2026)
    // Abraham, Nov 23, 2026: 1 confirms and moves on; 2 tries that step again (typing again when it was typed). Pound
    // or any other key: the shared wrong-key line, then the same read-back again. No key: the same read-back again.
    const yes = d === "1";
    if (d === "2") return back(vr, typed ? "type" : "ask", { f });
    if (!yes && ctx.session?.data.heard) {
      if (d) sp(vr, ctx, "not_valid");
      return back(vr, "readback", { f, t: typed ? 1 : undefined });
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
      // Batch 2 item 6 (Abraham, Nov 25, 2026): the approved step 5 line (addr_outside) replaces the old one
      return back(vr, "addr-outside");
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
    const typed = ctx.query.get("t") === "1";
    const g = keypad(vr, url("confirm", { f, t: typed ? 1 : undefined }));
    readBackLine(g, ctx, typed ? "typed_back" : "heard", f, heard);
    confirmEnd(g, ctx);
    backLine(g, ctx);
    return noInput(vr, ctx, "readback", { f, t: typed ? 1 : undefined });
  },

  /* ---- Terms: "By pressing #, you agree to our Terms and Conditions..." (logged with time, phone, order, version) ---- */

  terms(ctx, vr) {
    const g = keypad(vr, url("terms-answer", { n: ctx.query.get("n") ?? undefined }), { timeout: 8 });
    say(g, promptText(ctx.prompts, "terms_notice"));
    backLine(g, ctx);
    return back(vr, "terms-answer", { n: ctx.query.get("n") ?? undefined });
  },

  async "terms-answer"(ctx, vr) {
    if (ctx.body.Digits === "*") return back(vr, "cart"); // star: one step back (Nov 20, 2026)
    const order = (await callOrders(ctx))[0] ?? null; // the first day's order stands for the whole reservation
    if (!order) return cartGone(vr, ctx);
    if (ctx.body.Digits === "1") {
      // Text the Terms link (only with order-text consent from this call or before).
      const phone = ctx.session?.data.phone ?? toE164(ctx.from);
      const consented = ctx.session?.data.smsConsent === "yes" || ctx.session?.data.smsConsent === "existing" || (phone ? (await consentState(phone)).transactional?.action === "opt_in" : false);
      const r = phone && consented ? await sendSms(phone, promptText(ctx.prompts, "msg_terms_link", { link: `${config.siteUrl()}/terms` }), { kind: "transactional", event: "terms_link", orderId: order.order.id, callSid: ctx.callSid }) : null;
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
    backLine(g, ctx);
    return noInput(vr, ctx, "phone");
  },

  async "phone-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "cart"); // star: one step back (Nov 20, 2026)
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
    const g = keypad(vr, url("phone-heard"), { numDigits: 11, timeout: 10, finishOnKey: "#" }); // 10 digits + pound (audit M2)
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
    box48(g, ctx, e164);
    return noInput(vr, ctx, "phone-confirm");
  },

  async "phone-confirm"(ctx, vr) {
    const d = ctx.body.Digits;
    const heard = ctx.session?.data.heard;
    if (d === "*") return back(vr, "phone"); // star: one step back (Nov 20, 2026)
    // Nov 23, 2026: 1 confirms, 2 types it again; pound or another key: the wrong-key line; no key: the same read-back
    if (d === "2" || !heard) return back(vr, "phone-enter");
    if (d !== "1") {
      if (d) sp(vr, ctx, "not_valid"); // wrong key (Abraham, Nov 16, 2026): the shared line, then the same menu again
      const g = keypad(vr, url("phone-confirm"));
      box48(g, ctx, heard);
      return noInput(vr, ctx, "phone-confirm");
    }
    await updateSession(ctx.callSid, { data: { phone: heard, heard: undefined } }, ctx.session);
    return back(vr, "sms-consent");
  },

  /* ---- SMS consent: transactional (before the payment link), separate from promotional (after the order) ---- */

  /*
   * Box 49 (Abraham, Nov 24, 2026): "To receive text updates to your phone number, about your reservation, press 1."
   * Key 1 records the consent (transactional, number, time, exact wording) and plays the thank-you with the number
   * spoken between its two recordings. No key 2: no key = no texts, and checkout continues. Skipped (silently) when the
   * number already agreed or replied STOP. The number is not confirmed again here.
   */
  async "sms-consent"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    if (!phone) return back(vr, "phone");
    if (!ctx.query.get("n")) {
      const customer = await customerByPhone(phone);
      if (customer?.smsOptOut) {
        sp(vr, ctx, "consent_stopped"); // Nov 25, 2026: the opt-out line, as in the other two places
        await updateSession(ctx.callSid, { data: { smsConsent: "stopped" } }, ctx.session);
        return back(vr, "finalize");
      }
      if ((await consentState(phone)).transactional?.action === "opt_in") {
        await updateSession(ctx.callSid, { data: { smsConsent: "existing" } }, ctx.session);
        return back(vr, "finalize");
      }
    }
    const g = keypad(vr, url("sms-consent-answer", { n: ctx.query.get("n") ?? undefined }), { timeout: 8 });
    sp(g, ctx, "consent_transactional");
    return back(vr, "sms-consent-answer", { none: 1 }); // no key: no texts, on with checkout
  },

  async "sms-consent-answer"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    if (!phone) return back(vr, "phone");
    const d = ctx.query.get("none") ? "" : ctx.body.Digits ?? "";
    if (d === "*") return back(vr, "phone"); // star: one step back (Nov 20, 2026)
    if (d === "1") {
      await recordPhoneConsent(ctx, "transactional", "opt_in", phone);
      await updateSession(ctx.callSid, { data: { smsConsent: "yes" } }, ctx.session);
      sp(vr, ctx, "consent_tx_thanks", { number: spokenPhone(phone) });
      return back(vr, "finalize");
    }
    // Another key (wrong key): the shared line and the question once more; then, like no key, no texts
    const n = Number(ctx.query.get("n") || 0);
    if (d && n < 1) {
      sp(vr, ctx, "not_valid");
      return back(vr, "sms-consent", { n: n + 1 });
    }
    await recordPhoneConsent(ctx, "transactional", "declined", phone);
    await updateSession(ctx.callSid, { data: { smsConsent: "no" } }, ctx.session);
    return back(vr, "finalize");
  },

  async finalize(ctx, vr) {
    const days = await callOrders(ctx);
    const data = ctx.session?.data ?? {};
    if (!days.length) return cartGone(vr, ctx);
    if (!data.name || !data.address) return back(vr, "ask", { f: !data.name ? "name" : "address" });
    if (termsActive() && !data.termsAccepted) return back(vr, "terms"); // off on live until the final Terms are in
    // Audit C2 (Nov 24, 2026): a hold may have run out while the caller answered; every line is checked again, locked.
    // A line someone else booked in the meantime is taken out of the cart and the caller hears the item-taken screen.
    {
      const { recheckHolds } = await import("@/lib/orders");
      const taken = await recheckHolds(days.map((d) => d.order.id));
      if (taken.length) {
        const t = taken[0];
        await track(ctx.callSid, "unavailable", `At checkout: ${taken.length === 1 ? "an item" : `${taken.length} items`} in the cart had been booked by someone else`, { taken });
        return back(vr, "booked", { p: t.productId, d: t.eventDate });
      }
    }
    // No email in the booking (Abraham, Nov 17, 2026): it is asked only for a payment link by email (box 145)
    const caller = ctx.session?.fromNumber ?? ctx.from;
    const settings = await getSettings();
    // Delivery fee by the price map (Abraham, Nov 15, 2026); no price = never guessed
    const quote = await deliveryQuote(data.address, settings);
    if (!quote.ok) {
      return back(vr, "addr-outside"); // Batch 2 item 6: approved addr_outside line
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
    const fresh = await db.select({ id: orders.id, subtotalCents: orders.subtotalCents, offerNote: orders.offerNote, offerDiscountCents: orders.offerDiscountCents }).from(orders).where(inArray(orders.id, days.map((d) => d.order.id)));
    for (const o of days) {
      const f = fresh.find((x) => x.id === o.order.id);
      if (f) Object.assign(o.order, { subtotalCents: f.subtotalCents, offerNote: f.offerNote, offerDiscountCents: f.offerDiscountCents });
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
          unitNotVerified: Boolean(data.unitUnverified), // Nov 25, 2026: staff confirm the unit before delivery
          ...(data.directions ? { notes: sql`COALESCE(${orders.notes}, '') || ${`Delivery directions (from the caller): ${data.directions}. `}` } : {}),
          status: "PENDING_PAYMENT",
          holdExpiresAt: minutesFromNow(await linkHoldMinutes("phone")),
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
    // A number two directory entries share (Abraham, Nov 22, 2026): alert him right away
    const sharedOn = [ctx.from, data.dirPhone ?? null, phone].find(Boolean);
    const shared = (await isSharedNumber(ctx.from)) ? ctx.from : data.dirPhone && (await isSharedNumber(data.dirPhone)) ? data.dirPhone : sharedOn;
    await alertSharedPhoneOrder({ phone: shared ?? null, name: data.name ?? null, address: data.address ?? null, orderIds: days.map((x) => x.order.id), source: "phone", chosen: data.dirPick ?? null }).catch((e) => console.error("shared number alert", e));
    await track(ctx.callSid, "booking_finished", `Booking finished: order #${orderNumber(primary.id)}${days.length > 1 ? ` (${days.length} days)` : ""}`, { orderIds: days.map((x) => x.order.id), days: days.map((x) => x.order.eventDate) });
    const sum = (k: "subtotalCents" | "deliveryFeeCents" | "taxCents" | "totalCents") => perDay.reduce((n, x) => n + x.t![k], 0);
    const totals = { subtotalCents: sum("subtotalCents"), deliveryFeeCents: sum("deliveryFeeCents"), taxCents: sum("taxCents"), totalCents: sum("totalCents") };

    // Box 56 (Abraham, Nov 24, 2026, 21:02): the order number (one digit at a time), the total, and the breakdown by
    // rental type; no name. The hold line comes right before the secure payment line (below).
    await box56(vr, ctx, primary.id, days, perDay.map((x) => x.t!.subtotalCents), totals);
    // Box 156 (Abraham, Nov 19, 2026): the customer is always told when the Owner's discount was used
    const disc = customerDiscountLine(perDay.map(({ o, t }) => ({ note: o.order.offerNote, discountCents: o.order.offerDiscountCents ?? 0, zone: t!.zone, feeCents: t!.deliveryFeeCents, subtotalCents: t!.subtotalCents })), settings);
    if (disc) sp(vr, ctx, "box156", { amount: spokenMoney(disc.beforeCents), discount: disc.spoken, newtotal: spokenMoney(totals.totalCents) });
    await updateSession(ctx.callSid, { data: { placedOrderId: primary.id } }, ctx.session);
    // Pay by card through Sola PhonePay (Abraham, Nov 14, 2026), the main phone payment. Off until he switches it on in
    // Admin, and then only on his own test calls until he opens it to everyone and approves its lines.
    // Card payment plan (Abraham, Nov 15, 2026): straight to the card, no payment link in this flow. The Owner picks
    // Sola PhonePay (the default) or Stripe in Admin; callers not offered a card get the payment link, as before.
    const payCfg = await getSettings();
    if (payCfg.phoneCardProvider === "stripe") {
      if (keypadPayFor(caller, stripePhonePayMode(process.env, payCfg), process.env, payCfg.paymentTestNumbers) && PAY_PROMPTS.every((k) => stripePhonePayMode(process.env, payCfg) !== "live" || !promptWaiting(ctx.prompts, k)))
        return back(vr, "pay-keypad", { o: primary.id });
    } else if (phonePayOffered(caller, payCfg) && !(await isPhonePayBlocked(callerPhoneOf(ctx))) && (payCfg.solaPhonePayOwnerOnly || PHONEPAY_PROMPTS.every((k) => !promptWaiting(ctx.prompts, k)))) {
      // Abraham, Nov 24, 2026: box 140 first (5 seconds), then the hold line and the payment line (phonepay-go)
      return back(vr, "phonepay-go", { o: primary.id, n: 1 });
    }
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
    if (Number(ctx.query.get("n") || 0) > 0) sp(g, ctx, "no_choice"); // Nov 22, 2026: the system-wide no-choice line
    sp(g, ctx, "consent_transactional");
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
    // Earlier Sola calls end on the main account (Nov 23, 2026: the subaccount gave Twilio error 21220)
    for (const a of earlier) if (a.payLegSid?.startsWith("CA")) await endMainPayLeg(a.payLegSid);
    const n = earlier.length + 1;
    const limits = phonePayLimits(await getSettings());
    if (n > limits.triesPerCall) {
      await track(ctx.callSid, "step", `Card payment try ${n}: not started (limit of ${limits.triesPerCall} tries per call)`);
      return back(vr, "phonepay-done", { o, a: 0 });
    }
    // A blocked number gets the payment link instead (Abraham, Nov 17-18, 2026). A new call's first card try checks the
    // limit of calls with card tries per caller number in 24 hours (the line for a blocked number is not approved yet)
    if (await isPhonePayBlocked(callerPhoneOf(ctx))) {
      await track(ctx.callSid, "step", `Card payment try ${n}: not started (this number is blocked for card payments; payment link instead)`);
      return back(vr, "paylink", { o });
    }
    if (!earlier.length && (await blockIfTooManyCalls(callerPhoneOf(ctx), ctx.callSid, limits.callsPerDay, `order #${orderNumber(o)}`))) {
      await track(ctx.callSid, "step", "Card payment by phone blocked for this number (too many calls with card tries in 24 hours)");
      return back(vr, "paylink", { o });
    }
    // The rentals stay held for the whole payment
    const waiting = group.orders.filter((d) => d.order.status === "PENDING_PAYMENT").map((d) => d.order.id);
    if (waiting.length) await db.update(orders).set({ holdExpiresAt: minutesFromNow(await linkHoldMinutes("phone")), updatedAt: new Date() }).where(inArray(orders.id, waiting));
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
    // Straight from the hotline to Sola PhonePay (Abraham, Nov 17, 2026): PIN, the order amount (from the order, never
    // the caller) and 1, sent once PhonePay answers. Star brings the caller back at any time.
    const s = await getSettings();
    const digits = buildSendDigits(s.solaPhonePayDigits, { pin: process.env.SOLA_PHONEPAY_PIN ?? "", amountCents: group.due, orderNumber: orderNumber(o) });
    // Music while connecting (Abraham, Nov 17, 2026): when songs are chosen for the payment line, the caller waits with
    // them while a separate call enters the merchant code and amount, then joins the caller to Sola.
    // Connect timing (Abraham, Nov 25, 2026): the call to Sola starts BEFORE the hold line; the caller is put in the pay
    // queue right away and hears the hold line there first (music route), then music until Sola joins (never cutting
    // the line). A retry keeps its 3-second wait before calling Sola again (Nov 23, 2026), overlapped with the line.
    const musicPath = (await placeTracks("pay")).length > 0;
    const enqueue = () => {
      vr.enqueue({ waitUrl: url("music", { place: "pay", a: attempt.id }), waitUrlMethod: "POST", action: url("phonepay-done", { o, a: attempt.id }), method: "POST" }, payQueueName(ctx.callSid));
      return vr;
    };
    const legInput = { callerSid: ctx.callSid, number: s.solaPhonePayNumber, attemptId: attempt.id, baseUrl: config.baseUrl() };
    if (musicPath && !earlier.length && (await startPayLegWithMusic({ ...legInput, waitMs: 0 }))) {
      await track(ctx.callSid, "step", `Card payment try ${n}: call to Sola started before the hold line`, { attempt: attempt.id });
      return enqueue();
    }
    if (musicPath && earlier.length && (await payLegPossible())) {
      const callerSid = ctx.callSid;
      const done = url("phonepay-done", { o, a: attempt.id, nr: 1 });
      runLater(async () => {
        const ok = await startPayLegWithMusic({ ...legInput, waitMs: process.env.VITEST ? 0 : 3000 });
        if (ok) return;
        // Sola could not be called: the waiting caller goes on (the backup number), never left in the queue
        const { getTwilio } = await import("@/lib/twilio-client");
        await getTwilio()?.calls(callerSid).update({ url: done, method: "POST" }).catch(() => null);
      });
      await track(ctx.callSid, "step", `Card payment try ${n}: call to Sola starts after the 3-second wait, during the hold line`, { attempt: attempt.id });
      return enqueue();
    }
    // The direct way (no songs for the payment line): the hold line, then the dial
    sp(vr, ctx, "pay_hold_secure", undefined, { draftOk: true });
    // Sola hang-up helper (option a, once the Owner turns it on after the real test call): Sola's voice is what we send
    // to the caller on this call
    if (s.solaListenOn) startSolaListen(vr, attempt.id, "outbound", s);
    await track(ctx.callSid, "step", `Card payment try ${n}: dialing the Sola line (no music: no songs set for the payment line)`, { attempt: attempt.id });
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
    return back(vr, "pay-leg-wait", { a: attempt.id });
  },

  /** The call to Sola is ready: join the waiting caller once the hold line has finished (checked every second). */
  async "pay-leg-wait"(ctx, vr) {
    const a = Number(ctx.query.get("a"));
    const n = Number(ctx.query.get("n") || 0);
    const [attempt] = a ? await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, a)).limit(1) : [];
    if (!attempt) {
      vr.hangup();
      return vr;
    }
    // Still in the hold line (an older try with no line in the queue joins right away; at most 60 seconds of waiting)
    if (attempt.holdStartedAt && !attempt.holdDoneAt && n < 60) {
      vr.pause({ length: 1 });
      return back(vr, "pay-leg-wait", { a, n: n + 1 });
    }
    const dial = vr.dial({ record: "do-not-record", timeLimit: 900 });
    // The queue's url runs for the waiting caller right as the two calls join: that marks the try as joined
    dial.queue({ url: url("pay-leg-joined", { a: attempt.id }), method: "POST" }, payQueueName(attempt.callSid));
    return vr;
  },

  /** The call to Sola just joined the waiting caller (nothing is played). */
  async "pay-leg-joined"(ctx, vr) {
    const a = Number(ctx.query.get("a"));
    if (!a) return vr;
    const now = new Date();
    const [attempt] = await db.update(schema.phonepayAttempts).set({ bridgedAt: now }).where(eq(schema.phonepayAttempts.id, a)).returning();
    // Abraham, Nov 25, 2026: how long the caller heard music after the hold line (target: 5 seconds at most)
    if (attempt?.holdDoneAt) {
      const secs = Math.max(0, Math.round((now.getTime() - attempt.holdDoneAt.getTime()) / 1000));
      await track(attempt.callSid, "step", `Payment line joined: ${secs} seconds of music after the hold line (try ${attempt.tryNumber ?? "?"})`, { attempt: a, musicSeconds: secs });
    }
    return vr;
  },

  /**
   * The call to Sola ended (Abraham, Nov 23, 2026). If it never joined the waiting caller, the caller is moved right
   * away: one redial after a short wait, then the backup number (Sola never answered) or the try-again menu. Main
   * Twilio account only.
   */
  async "pay-leg-status"(ctx, vr) {
    const a = Number(ctx.query.get("a"));
    const status = ctx.body.CallStatus ?? "";
    const [attempt] = a ? await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, a)).limit(1) : [];
    if (!attempt?.orderId || attempt.bridgedAt || attempt.endedAt || attempt.result) return vr;
    const redialed = ctx.query.get("r") === "1";
    const moveCaller = async (params: Record<string, string | number>) => {
      try {
        const { getTwilio } = await import("@/lib/twilio-client");
        await getTwilio()?.calls(attempt.callSid).update({ url: url("phonepay-done", params), method: "POST" });
      } catch {
        /* the caller already left */
      }
    };
    await track(attempt.callSid, "step", `Payment line call ended before joining the caller (${status || "no status"}${ctx.body.CallDuration ? `, ${ctx.body.CallDuration} seconds` : ""})${redialed ? " on the redial" : ""}`, { attempt: a });
    if (!redialed) {
      const s = await getSettings();
      const ok = await startPayLegWithMusic({ callerSid: attempt.callSid, number: s.solaPhonePayNumber, attemptId: a, baseUrl: config.baseUrl(), redial: true, waitMs: process.env.VITEST ? 0 : 3000 });
      if (ok) {
        await track(attempt.callSid, "step", "Payment line: calling Sola again once", { attempt: a });
        return vr;
      }
    }
    // Sola never answered: the backup number (as before); answered but dropped: the try-again menu
    await moveCaller(PHONEPAY_NOT_REACHED.includes(status) ? { o: attempt.orderId, a, nr: 1 } : { o: attempt.orderId, a });
    return vr;
  },

  /**
   * Box 148 (Abraham, Nov 18, 2026), only after Sola shows the payment approved: "You are all set, {name}! ... Your order
   * number is {number}. ... To send it to a different number, press 1. ..." No key: on with the call.
   */
  /*
   * Box 148 (Abraham, Nov 25, 2026, 00:29): "Thank you! Your payment was approved, and your booking is confirmed. Your
   * order number is {number}." (no name), "To hear it again, press star.", then, only for a caller who agreed to order
   * texts, "We will text your confirmation ... press 1.", else the line for texts (draft, preview only until approved),
   * then "We look forward to serving you again. ..." Star replays "Your order number is {number}." and the rest.
   * r=1: the rest only (after a wrong key); st=1: the number again (star).
   */
  async "pay-approved"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const group = o ? await getPaymentGroup(o) : null;
    if (!group) return back(vr, "promo-consent");
    const number = spokenDigits(orderNumber(o));
    const g = keypad(vr, url("pay-approved-choice", { o }), { numDigits: 1, timeout: 5 }); // 5 seconds (Nov 25, 2026, 12:22)
    if (ctx.query.get("st")) sp(g, ctx, "checkout_order_number", { number });
    else if (!ctx.query.get("r")) sp(g, ctx, "phonepay_approved", { number });
    // The dates line (Abraham dictated 4:43 PM; held until he approves the exact words): right after the number, on
    // star too; several days = the first delivery date and the last pickup date (to confirm with Abraham)
    if (PAY_DATES_LIVE && !ctx.query.get("r")) {
      const days = group.orders.map((x) => x.order); // sorted by date
      sp(g, ctx, "pay_approved_dates", { date: spokenDate(days[0].eventDate), pickup: spokenDate(days.map((x) => x.pickupDate).sort().at(-1)!) });
    }
    // approved Nov 25, 2026, 12:22 (pay_approved_optin for callers not signed up for order texts)
    if (await orderTextsAgreed(ctx, o)) menuRun(g, ctx, "pay_approved_text", ["phonepay_approved_star", "phonepay_approved_text", "phonepay_approved_bye"]);
    else menuRun(g, ctx, "pay_approved_optin", ["phonepay_approved_star", "pay_approved_optin", "phonepay_approved_bye"]);
    return back(vr, "receipt-email", { o }); // no key: box 35, the receipt by email (Abraham, Nov 25, 2026, 11:51)
  },

  async "pay-approved-choice"(ctx, vr) {
    const o = ctx.query.get("o") ?? undefined;
    const d = ctx.body.Digits;
    if (d === "*") return back(vr, "pay-approved", { o, st: 1 }); // star: the order number again (nothing to go back to)
    if (d === "1") {
      // Agreed to order texts: a different number (box 143, then the read-back). Not agreed: pressing 1 signs up for this
      // order's texts, to the number they choose (box 142, then the read-back) (Abraham, Nov 25, 2026, 00:34)
      if (await orderTextsAgreed(ctx, Number(o))) return back(vr, "tx-enter", { p: "conf", o });
      // Not signed up (Abraham, Nov 25, 2026, 12:22): key 1 signs up the calling number for this order's texts (the same
      // consent record as box 49 key 1), the box 49 thank-you lines, the confirmation text, then box 35
      const phone = toE164(ctx.session?.fromNumber ?? ctx.from);
      if (phone && !(await customerByPhone(phone))?.smsOptOut) {
        await recordPhoneConsent(ctx, "transactional", "opt_in", phone, "pay_approved_optin");
        await updateSession(ctx.callSid, { data: { smsConsent: "yes" } }, ctx.session);
        await setOrderTextPhone(Number(o), phone);
        sp(vr, ctx, "consent_tx_thanks", { number: spokenPhone(phone) });
        const { confirmationText } = await import("@/lib/payment-result");
        const body = await confirmationText(Number(o));
        const r = body ? await sendMessage({ to: phone, body, kind: "transactional", event: "confirmation_resend", orderId: Number(o), callSid: ctx.callSid }) : null;
        await track(ctx.callSid, "step", `Box 148: signed up ${phone} for this order's texts${r?.sent ? "; confirmation texted" : ""}`, { to: phone });
      } else if (phone) sp(vr, ctx, "consent_stopped");
      return back(vr, "receipt-email", { o });
    }
    if (d === "#") return back(vr, "receipt-email", { o }); // pound: no texts, on to box 35
    if (d) {
      sp(vr, ctx, "not_valid");
      return back(vr, "pay-approved", { o, r: 1 });
    }
    return back(vr, "receipt-email", { o }); // box 35
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
      // Abraham, Nov 25, 2026, 12:27: no line here; straight to the result (box 148, 58, 147 ...)
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
      if (to) await sendEmail(to, subject, `${text}\n\n${config.baseUrl()}${orderPath(o)}`).catch(() => null);
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
    if (!unclear) {
      // Declined (Abraham's test call, Nov 24, 2026 bug): the line plays once, then the caller goes straight back to Sola
      // PhonePay for the same order and amount. It used to wait for key 1 and replay the line again and again.
      const g = keypad(vr, url("phonepay-retry-answer", { o, n, d: 1 }), { numDigits: 1, timeout: 1 });
      sp(g, ctx, n === max - 1 ? "phonepay_retry_last" : "phonepay_retry", undefined, { draftOk: true });
      await track(ctx.callSid, "step", `Card try ${n} did not go through: declined line played once; back to the payment line`);
      return back(vr, "phonepay-go", { o });
    }
    const g = keypad(vr, url("phonepay-retry-answer", { o, n, r: asked, u: 1 }), { numDigits: 1, timeout: 8 });
    sp(g, ctx, "phonepay_unclear", undefined, { draftOk: true });
    return back(vr, "phonepay-retry", { o, n, r: asked + 1, u: 1 });
  },

  "phonepay-retry-answer"(ctx, vr) {
    const o = Number(ctx.query.get("o"));
    const n = Number(ctx.query.get("n") || 1);
    if (ctx.body.Digits === "1") return back(vr, "phonepay-go", { o });
    // After a decline any key (or none) goes back to the payment line: the declined line is never repeated
    if (ctx.query.get("d") === "1") return back(vr, "phonepay-go", { o });
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
    if (waiting.length) await db.update(orders).set({ holdExpiresAt: minutesFromNow(await linkHoldMinutes("phone")), updatedAt: new Date() }).where(inArray(orders.id, waiting));
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
    menuRun(g, ctx, "promo_ask", ["promo_ask", "pause", "skip_pound"]);
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
    const g = keypad(vr, url("promo-heard", { t: tries }), { numDigits: 11, timeout: 10, finishOnKey: "#" }); // 10 digits + pound (audit M2)
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
    // Batch 3 item 2 (Abraham, Nov 25, 2026): the order goodbye lines only once the order is paid
    const group = id ? await getPaymentGroup(id) : null;
    const full = group && group.due <= 0 ? await getOrderWithItems(id!) : null;
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
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "forwarded", data: { ringStart: Date.now() } }, ctx.session);
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
    for (const line of hoursForSpeech(settings)) playText(vr, ctx, line, "hours"); // recordings word by word (Nov 24, 2026)
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
    const i = Number(ctx.query.get("i") ?? -1);
    const next = i + 1;
    const steps = (list.mode === "simultaneous" ? 1 : list.targets.length) * ringAttempts(settings, k);
    // Customer service (Abraham, Nov 25, 2026, 4:14 PM): every call lasts its full ring time; a call that ends early
    // (rejected, key 2, busy, failed) is waited out with the same ringing, then a new call
    if (k === "4" && ctx.query.get("w") !== "1" && i >= 0 && list.targets.length) {
      const ring = list.mode === "simultaneous" ? list.targets : [list.targets[i % list.targets.length]];
      const perCall = Math.max(...ring.map((t) => t.ringSeconds));
      const started = Number(ctx.session?.data.ringStart ?? 0);
      const elapsed = started ? Math.floor((Date.now() - started) / 1000) : perCall;
      if (elapsed < perCall) {
        for (let sec = Math.max(0, elapsed); sec < perCall; sec++) vr.play(`${config.baseUrl()}/audio/${sec % 6 < 2 ? "ring-on-1s" : "ring-off-1s"}.wav`); // US ringing: 2 s on, 4 s off
        return back(vr, "operator-done", { i, k, w: 1, r: rejected ? 1 : undefined });
      }
    }
    if (next > 0 && next < steps && (await lineRingsNowFor(k, settings))) {
      await updateSession(ctx.callSid, { data: { ringStart: Date.now() } }, ctx.session);
      return dialTargets(vr, list, k, next, ctx.session?.fromNumber ?? ctx.from);
    }
    // Abraham's missed-call line, then straight to the voicemail beep
    await updateSession(ctx.callSid, { data: { missed: rejected || ctx.query.get("r") === "1" ? "rejected" : "no_answer" } }, ctx.session); // dashboard: missed call
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
    let x = ctx.query.get("x");
    let box = await vmBox(x);
    if (!box.enabled && x) {
      // Batch 3 item 26b (Nov 25, 2026): a switched-off extension box uses the Main box, with its greeting
      const main = await mainBox();
      if (main.enabled) {
        box = main;
        x = null;
      }
    }
    if (!box.enabled) {
      sp(vr, ctx, "operator_unavailable");
      return back(vr, "menu");
    }
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "voicemail", data: { vmEntry: x ?? undefined } }, ctx.session);
    return vmGreetingThenTone(vr, ctx, box, x, await vmGreeting(x, ctx.prompts));
  },

  /** A key during the Shabbes / Yom Tov closed message: pound or the end = the tone; any other key = the message again. */
  async "closed-key"(ctx, vr) {
    const d = ctx.body.Digits ?? "";
    const n = Number(ctx.query.get("n") || 0);
    if (d && n < VM_GREETING_REPLAYS) {
      const again = await hotlineClosed(ctx, vr, n + 1);
      if (again) return again;
    }
    return vmRecord(vr, await vmBox("9"), "closed");
  },

  /**
   * A key during a voicemail greeting (Hark for Abraham, Nov 19, 2026): pound skips to the tone (the only skip). The
   * greeting has no keys, so any other key is not acted on: the greeting starts over. Staff access (star 7 4, general
   * voicemail only, never announced) stays as before.
   */
  async "vm-greeting-key"(ctx, vr) {
    const x = ctx.query.get("x");
    const d = ctx.body.Digits ?? "";
    if (d === VM_ACCESS_KEYS && x === "9" && vmAccessActive()) return back(vr, "vm-start"); // the full voicemail (Nov 23, 2026)
    const box = await vmBox(x);
    const n = Number(ctx.query.get("n") || 0);
    // pound (no other key) or the greeting ended: the tone. Another key: the greeting again (at most 3 times).
    if (!d || n >= VM_GREETING_REPLAYS) return vmRecord(vr, box, x);
    const gq = ctx.query.get("g");
    const greet = gq && gq in PROMPTS ? (gq as PromptKey) : await vmGreeting(x, ctx.prompts);
    return vmGreetingThenTone(vr, ctx, box, x, greet, n + 1);
  },

  /* ---- Staff voicemail access by phone (Abraham, Nov 13, 2026; preview only; every line a draft) ---- */

  async "vma-pin"(ctx, vr) {
    if (!vmAccessActive()) return back(vr, "menu");
    if (ctx.query.get("old") !== "1") return back(vr, "vm-start"); // Nov 23, 2026: the full voicemail replaces this
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
    if (ctx.session?.data.vmMine) return back(vr, "vm-main", { s: 1 }); // back to the full voicemail main menu (Nov 23, 2026)
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

  /*
   * Owner custom charge (Abraham, Nov 24, 2026): no amount on our line (Sola PhonePay asks for it itself) and no hold
   * line. The optional order number, then Sola; the charge made during this call to Sola is matched by its time.
   */
  async "vma-charge"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
    const settings = await getSettings();
    if (!phonePayOffered(ctx.session?.fromNumber ?? ctx.from, { ...settings, solaPhonePayOwnerOnly: false })) {
      sp(vr, ctx, "not_valid"); // PhonePay is switched off (or not set up): this key does nothing
      return back(vr, "vma-box");
    }
    const g = vr.gather({ input: ["dtmf"], finishOnKey: "#", timeout: 10, action: url("vma-charge-go"), method: "POST", actionOnEmptyResult: true });
    sp(g, ctx, "vma_charge_note", undefined, { draftOk: true });
    return back(vr, "vma-charge-go");
  },

  /** Older links to the removed amount steps: the charge from the start. */
  "vma-charge-amount"(ctx, vr) {
    return back(vr, "vma-charge");
  },
  "vma-charge-confirm"(ctx, vr) {
    return back(vr, "vma-charge");
  },

  async "vma-charge-go"(ctx, vr) {
    if (!vmaSignedIn(ctx)) return back(vr, "vma-pin");
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
    const attempt = await startAttempt(order?.id ?? null, ctx.callSid, 0, "custom");
    await track(ctx.callSid, "vm_access", `Owner custom charge started${order ? ` for order #${orderNumber(order.id)}` : ""} (the amount is typed on Sola's line)`, { attempt: attempt.id });
    const s = await getSettings();
    const digits = buildSendDigits(s.solaPhonePayCustomDigits, { pin: process.env.SOLA_PHONEPAY_PIN ?? "", amountCents: 0, orderNumber: order ? orderNumber(order.id) : "" });
    phonePayDirectDial(vr, { number: s.solaPhonePayNumber, digits, action: url("vma-charge-done", { a: attempt.id, o: order?.id ?? 0 }) });
    return vr;
  },

  async "vma-charge-done"(ctx, vr) {
    if (ctx.session?.data.recording) await resumeRecording(ctx.callSid).catch(() => null);
    const a = Number(ctx.query.get("a"));
    const o = Number(ctx.query.get("o")) || null;
    if (a) await matchCustomCharge(a, null, o, { madeBy: await customChargeMadeBy(ctx.session?.fromNumber ?? ctx.from) });
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
/** The step before a question, for star (Abraham, Nov 24, 2026: star = go back everywhere). */
function prevStep(f: Field): [string, Record<string, string>] {
  return f === "street" ? ["addr-street", {}] : f === "unit" ? ["addr-street", {}] : f === "address" ? ["ask", { f: "name" }] : ["cart", {}];
}
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
    next: "addr-unit-ask",
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
  // Audit C2: every step keeps every day of the cart held (only holds that are still active)
  if (session?.data?.dayOrderIds?.length || session?.orderId) {
    const { keepCartHeld } = await import("@/lib/orders");
    const keyPressed = Boolean(ctx.body.Digits || (ctx.body.SpeechResult || "").trim());
    await keepCartHeld([...new Set([...(session.data?.dayOrderIds ?? []), ...(session.orderId ? [session.orderId] : [])])], { keyPressed }).catch((e) => console.error("[keep cart held]", e));
  }
  // Abraham's idle rule inside a booking: remember when the caller last pressed a key (or said something)
  let current = session;
  if ((ctx.body.Digits || (ctx.body.SpeechResult || "").trim()) && current) {
    await updateSession(ctx.callSid, { data: { lastKeyAt: Date.now() } }, current);
    current = await getSession(ctx.callSid);
  }
  try {
    await handler({ ...ctx, session: current ?? session ?? (await getSession(ctx.callSid)) }, vr);
    const voice = VOICE_LOG.get(prompts);
    if (voice?.length) await track(ctx.callSid, "step", `Voice: ${voice.join(" | ")}`).catch(() => undefined);
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
  const dayIds = [...new Set([...(s.data?.dayOrderIds ?? []), ...(s.orderId ? [s.orderId] : [])])];
  // Welcome back (Abraham, Nov 23, 2026): remember which carts this call ended with, still holding at least one item
  const left = dayIds.length
    ? (await db.selectDistinct({ id: orders.id }).from(orders).innerJoin(orderItems, eq(orderItems.orderId, orders.id)).where(and(inArray(orders.id, dayIds), eq(orders.status, "HOLD")))).map((r) => r.id)
    : [];
  await updateSession(callSid, { data: { cartLeft: left } }, s).catch(() => null);
  for (const id of dayIds) await cancelHold(id);
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

import twilio from "twilio";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { addDays, longDate, todayISO } from "@/lib/dates";
import { spokenMoney } from "@/lib/money";
import { last4, spokenDigits, toE164 } from "@/lib/phone";
import { checkBookable, pickupDateFor } from "@/lib/availability";
import { checkEventDate } from "@/lib/jewish-calendar";
import { officeOpenNow } from "@/lib/business-hours";
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
import { CURRENT_TERMS_VERSION, recordTermsAcceptance } from "@/lib/rental-terms";
import { sendMessage } from "@/lib/sms";
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
import { matchMenuSpeech, menuSpeechHints } from "./category-speech";
import { boxById, mainBox, saveRecording, saveTranscription } from "@/lib/voicemail";
import { PROMPTS, loadPromptOverrides, promptAudio, promptText, type PromptKey, type PromptOverrides } from "./prompts";

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

/** Speech (plus optional keypad) gather tuned for phone audio. */
function speech(vr: VR, action: string, hints: string, opts: { dtmf?: boolean; numDigits?: number } = {}) {
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
    ...(opts.dtmf ? { finishOnKey: "#", numDigits: opts.numDigits } : {}),
  });
}

/** Handle "no input" loops: retry a few times then politely hang up. */
function noInput(vr: VR, ctx: Ctx, retryAction: string, retryParams: Record<string, string | number | undefined> = {}) {
  const n = Number(ctx.query.get("n") || 0) + 1;
  if (n >= MAX_NO_INPUT) {
    sp(vr, ctx, "no_input_final");
    vr.hangup();
    return vr;
  }
  sp(vr, ctx, "no_input");
  vr.redirect({ method: "POST" }, url(retryAction, { ...retryParams, n }));
  return vr;
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

/** Store a phone consent decision with the exact language the caller heard. */
async function recordPhoneConsent(ctx: Ctx, scope: "transactional" | "marketing", action: "opt_in" | "declined", phone: string) {
  const key = scope === "transactional" ? "consent_transactional" : "consent_marketing";
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

/* ------------------------------------------------------------------ handlers */

type Handler = (ctx: Ctx, vr: VR) => Promise<VR> | VR;

const handlers: Record<string, Handler> = {
  async incoming(ctx, vr) {
    await ensureSession(ctx.callSid, ctx.from);
    sp(vr, ctx, "greeting");
    // Booking by phone is available 24/7; outside office hours (Jewish calendar + business hours) callers are told
    // the office is closed and the live-person option is not offered.
    if (!officeOpenNow(new Date(), await getSettings())) sp(vr, ctx, "office_closed");
    return back(vr, "menu");
  },

  async menu(ctx, vr) {
    const cats = await phoneCategories();
    const order = await currentOrder(ctx);
    // Keypad OR speech: callers can press a key or just say what they want ("bounce house" works too).
    const g = vr.gather({
      input: ["dtmf", "speech"],
      numDigits: 1,
      timeout: 6,
      action: url("menu-choice"),
      method: "POST",
      language: "en-US",
      speechModel: "phone_call",
      enhanced: true,
      speechTimeout: "auto",
      hints: menuSpeechHints(cats),
    });
    if (!cats.length) sp(g, ctx, "menu_empty");
    for (const c of cats) sp(g, ctx, "menu_category", { category: c.spokenName || c.name, key: c.ivrDigit! });
    if (order?.items.length) sp(g, ctx, "menu_cart");
    const officeOpen = officeOpenNow(new Date(), await getSettings());
    // Option 0: a live person while the office is open; otherwise leave a message (voicemail).
    if (config.forwardPhone() && officeOpen) sp(g, ctx, "menu_operator");
    else sp(g, ctx, "menu_voicemail");
    if (cats.length) sp(g, ctx, "menu_speech");
    sp(g, ctx, "menu_repeat");
    return noInput(vr, ctx, "menu");
  },

  async "menu-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    const said = (ctx.body.SpeechResult || "").trim();
    if (!d && said) {
      const choice = matchMenuSpeech(said, await phoneCategories());
      if (choice?.kind === "category") return back(vr, "category", { c: choice.categoryId });
      if (choice?.kind === "cart") return back(vr, "cart");
      if (choice?.kind === "operator") return back(vr, "operator");
      if (choice?.kind === "repeat") return back(vr, "menu");
      sp(vr, ctx, "invalid");
      return back(vr, "menu");
    }
    if (!d) return noInput(vr, ctx, "menu", {});
    if (d === "*") return back(vr, "menu");
    if (d === "9") return back(vr, "cart");
    if (d === "0") return back(vr, "operator");
    const cats = await phoneCategories();
    const cat = cats.find((c) => String(c.ivrDigit) === d);
    if (!cat) {
      sp(vr, ctx, "invalid");
      return back(vr, "menu");
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
    const g = keypad(vr, url("category-choice", { c }));
    sp(g, ctx, "category_intro", { category: cat.spokenName || cat.name });
    items.forEach((p, i) => sp(g, ctx, "category_item", { item: p.name, key: i + 1 }));
    sp(g, ctx, "back_to_menu");
    return noInput(vr, ctx, "category", { c });
  },

  async "category-choice"(ctx, vr) {
    const c = Number(ctx.query.get("c"));
    const d = ctx.body.Digits;
    if (!d) return noInput(vr, ctx, "category", { c });
    if (d === "*") return back(vr, "menu");
    const items = await phoneProducts(c);
    const p = items[Number(d) - 1];
    if (!p) {
      sp(vr, ctx, "invalid");
      return back(vr, "category", { c });
    }
    return back(vr, "product", { p: p.id });
  },

  async product(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p || !p.active) return back(vr, "menu");
    const g = keypad(vr, url("product-choice", { p: p.id }));
    if (!ctx.query.get("again")) sp(g, ctx, "product_intro", { item: p.name, price: spokenMoney(p.priceCents) });
    sp(g, ctx, "product_options");
    return noInput(vr, ctx, "product", { p: p.id, again: 1 });
  },

  async "product-choice"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p) return back(vr, "menu");
    const d = ctx.body.Digits;
    if (!d) return noInput(vr, ctx, "product", { p: p.id, again: 1 });
    if (d === "*") return back(vr, "category", { c: p.categoryId });
    if (d === "1") {
      if (p.spokenDescription || p.description) say(vr, p.spokenDescription || p.description);
      else sp(vr, ctx, "product_default_desc", { item: p.name });
      pause(vr);
      return back(vr, "product", { p: p.id, again: 1 });
    }
    if (d === "2") {
      const order = await currentOrder(ctx);
      if (order) return back(vr, "qty", { p: p.id, d: order.order.eventDate });
      return back(vr, "date", { p: p.id });
    }
    sp(vr, ctx, "invalid");
    return back(vr, "product", { p: p.id, again: 1 });
  },

  date(ctx, vr) {
    const p = ctx.query.get("p")!;
    const g = speech(vr, url("date-heard", { p, n: ctx.query.get("n") ?? undefined }), "today, tomorrow, Sunday, Monday, January, February, March, April, May, June, July, August, September, October, November, December", { dtmf: true, numDigits: 4 });
    sp(g, ctx, "date_prompt");
    return vr;
  },

  async "date-heard"(ctx, vr) {
    const p = ctx.query.get("p")!;
    const digits = ctx.body.Digits;
    const speechResult = ctx.body.SpeechResult;
    if (!digits && !speechResult) return noInput(vr, ctx, "date", { p });
    const today = todayISO();
    const r = parseDateInput({ digits, speech: speechResult }, today);
    if (!r.ok) {
      sp(vr, ctx, r.reason === "past" ? "date_past" : r.reason === "too_far" ? "date_too_far" : "date_unclear");
      return back(vr, "date", { p, n: Number(ctx.query.get("n") || 0) + 1 });
    }
    const cal = await getSettings();
    const chk = checkEventDate(r.date, cal);
    if (!chk.ok) {
      sp(vr, ctx, "date_closed", { date: longDate(r.date), reason: chk.day.reason ?? "a holiday" });
      return back(vr, "date", { p, n: Number(ctx.query.get("n") || 0) + 1 });
    }
    const g = keypad(vr, url("date-confirm", { p, d: r.date }));
    sp(g, ctx, "date_confirm", { date: longDate(r.date), pickup: longDate(pickupDateFor(r.date, cal)) });
    return noInput(vr, ctx, "date", { p });
  },

  async "date-confirm"(ctx, vr) {
    const p = Number(ctx.query.get("p"));
    const date = ctx.query.get("d")!;
    const d = ctx.body.Digits;
    if (d === "2" || !d) return back(vr, "date", { p });
    if (d !== "1") return back(vr, "date", { p });
    return back(vr, "qty", { p, d: date });
  },

  async qty(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    const date = ctx.query.get("d")!;
    if (!p) return back(vr, "menu");
    const free = await checkBookable(p.id, p.quantity, date);
    if (free <= 0) {
      const g = keypad(vr, url("soldout-choice", { p: p.id }));
      sp(g, ctx, "sold_out", { item: p.name, date: longDate(date) });
      const order = await currentOrder(ctx);
      sp(g, ctx, order ? "sold_out_options_cart" : "sold_out_options");
      return noInput(vr, ctx, "menu");
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
    if (d === "9") return back(vr, "cart");
    if (d === "1" && !order && p) return back(vr, "date", { p: p.id });
    if ((d === "1" && order) || d === "2") return back(vr, p ? "category" : "menu", p ? { c: p.categoryId } : {});
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
    const session = ctx.session ?? (await ensureSession(ctx.callSid, ctx.from));
    const existing = await currentOrder(ctx);
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
        if (r.free > 0) sp(vr, ctx, "only_some_left", { count: r.free });
        else sp(vr, ctx, "just_booked", { item: p.name });
        return back(vr, r.free > 0 ? "qty" : "menu", r.free > 0 ? { p: p.id, d: date } : {});
      }
      sp(vr, ctx, "went_wrong");
      return back(vr, "menu");
    }
    await updateSession(ctx.callSid, { orderId: r.orderId, outcome: "carted" }, session);
    const g = keypad(vr, url("after-add"));
    sp(g, ctx, "added", { items: itemPhrase(q, p.name), date: longDate(date) });
    sp(g, ctx, "after_add");
    return noInput(vr, ctx, "cart");
  },

  async "after-add"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "9") return back(vr, "cart");
    if (d === "1") return back(vr, "menu");
    return noInput(vr, ctx, "cart");
  },

  async cart(ctx, vr) {
    const order = await currentOrder(ctx);
    if (!order || !order.items.length) {
      sp(vr, ctx, "cart_empty");
      return back(vr, "menu");
    }
    const list = order.items.map((i) => itemPhrase(i.qty, i.name)).join(", ");
    const g = keypad(vr, url("cart-choice"));
    sp(g, ctx, "cart_summary", { items: list, date: longDate(order.order.eventDate), total: spokenMoney(order.order.subtotalCents) });
    sp(g, ctx, "cart_options");
    return noInput(vr, ctx, "cart");
  },

  async "cart-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "ask", { f: "name" });
    if (d === "2") return back(vr, "menu");
    if (d === "3") {
      if (ctx.session?.orderId) await cancelHold(ctx.session.orderId);
      await updateSession(ctx.callSid, { orderId: null, outcome: "browsing" }, ctx.session);
      sp(vr, ctx, "cart_cleared");
      return back(vr, "menu");
    }
    return noInput(vr, ctx, "cart");
  },

  /* ---- checkout: name -> address -> email -> phone -> finalize ---- */

  async ask(ctx, vr) {
    if (!(await currentOrder(ctx))) {
      sp(vr, ctx, "cart_empty");
      return back(vr, "menu");
    }
    const f = ctx.query.get("f") as Field;
    const n = ctx.query.get("n") ?? undefined;
    const spec = FIELDS[f];
    const g = speech(vr, url("heard", { f, n }), spec.hints, { dtmf: f === "email" });
    sp(g, ctx, spec.prompt);
    return vr;
  },

  async heard(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const spec = FIELDS[f];
    if (f === "email" && ctx.body.Digits === "#") return back(vr, "phone");
    if (f === "email" && ctx.body.Digits !== undefined && !ctx.body.SpeechResult) return back(vr, "phone");
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
    const order = await currentOrder(ctx);
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
      await recordTermsAcceptance({
        orderId: order.order.id,
        phone: ctx.session?.data.phone ?? toE164(ctx.from),
        termsVersion: CURRENT_TERMS_VERSION,
        termsText: TERMS_TEXT,
        method: "phone_hash",
        acceptanceStatement: `Pressed "#" for reservation #${orderNumber(order.order.id)} after hearing: "${notice}"`,
        amountCents: order.order.subtotalCents,
      });
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
    const order = await currentOrder(ctx);
    const data = ctx.session?.data ?? {};
    if (!order || !order.items.length) {
      sp(vr, ctx, "cart_expired");
      return back(vr, "menu");
    }
    if (!data.name || !data.address) return back(vr, "ask", { f: !data.name ? "name" : "address" });
    if (!data.termsAccepted) return back(vr, "terms");
    const settings = await getSettings();
    const totals = computeTotals(order.order.subtotalCents, deliveryZone(data.address, settings), settings);
    if (!totals) {
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
    await db
      .update(orders)
      .set({
        customerId,
        deliveryAddress: data.address,
        status: "PENDING_PAYMENT",
        holdExpiresAt: minutesFromNow(PAYMENT_HOLD_MINUTES),
        deliveryZone: totals.zone,
        deliveryFeeCents: totals.deliveryFeeCents,
        taxPercent: totals.taxPercent,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, order.order.id), eq(orders.status, "HOLD")));
    await updateSession(ctx.callSid, { outcome: "checked_out" }, ctx.session);

    const num = orderNumber(order.order.id);
    const link = payPageLink(order.order.id); // review-and-pay page: Terms box, then Sola
    const lines = order.items.map((i) => `${i.qty} x ${i.name}`).join(", ");
    const details =
      `${BUSINESS_NAME} order #${num}: ${lines} for ${longDate(order.order.eventDate)} (pickup ${longDate(order.order.pickupDate)}). ` +
      `Rentals $${money(totals.subtotalCents)} + delivery $${money(totals.deliveryFeeCents)} + sales tax $${money(totals.taxCents)} = total $${money(totals.totalCents)}. ` +
      `Pay securely within ${PAYMENT_HOLD_MINUTES} minutes to confirm: ${link}`;
    // Texts go out only with transactional consent given on this call or recorded before.
    const consented = data.smsConsent === "yes" || data.smsConsent === "existing";
    let texted = false;
    let emailed = false;
    if (phone && consented) {
      const res = await sendSms(phone, `${details} ${TRANSACTIONAL_FOOTER}`, { kind: "transactional", event: "order_payment_link", customerId, orderId: order.order.id, callSid: ctx.callSid });
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
    await updateSession(ctx.callSid, { data: { placedOrderId: order.order.id } }, ctx.session);
    return back(vr, "promo-consent");
  },

  async "promo-consent"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    const retry = Number(ctx.query.get("n") || 0) > 0;
    if (!phone) return back(vr, "goodbye");
    if (!retry) {
      const customer = await customerByPhone(phone);
      if (!shouldAskMarketing(await consentState(phone), customer)) return back(vr, "goodbye");
    }
    const g = speech(vr, url("promo-consent-answer", { n: ctx.query.get("n") ?? undefined }), CONSENT_HINTS, { dtmf: true, numDigits: 1 });
    sp(g, ctx, retry ? "consent_unclear" : "consent_marketing");
    return vr;
  },

  async "promo-consent-answer"(ctx, vr) {
    const phone = ctx.session?.data.phone;
    if (!phone) return back(vr, "goodbye");
    const n = Number(ctx.query.get("n") || 0);
    const answer = parseConsentAnswer({ digits: ctx.body.Digits, speech: ctx.body.SpeechResult, confidence: ctx.body.Confidence });
    if (answer === "unclear" && n < 1) return back(vr, "promo-consent", { n: n + 1 });
    // Never auto-enroll: only a clear "yes" (key 1, or a confident spoken yes) opts in.
    const customerId = await recordPhoneConsent(ctx, "marketing", answer === "yes" ? "opt_in" : "declined", phone);
    if (answer === "yes") {
      await sendMessage({ to: phone, body: MARKETING_CONFIRMATION_SMS, kind: "system", event: "consent_confirmation", customerId, callSid: ctx.callSid });
      sp(vr, ctx, "consent_marketing_yes");
      return back(vr, "tz");
    }
    if (answer === "no") sp(vr, ctx, "consent_marketing_no");
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
    if (full) sp(vr, ctx, "goodbye_order", { date: longDate(full.order.eventDate), pickup: longDate(full.order.pickupDate) });
    vr.hangup();
    return vr;
  },

  async operator(ctx, vr) {
    const to = config.forwardPhone();
    if (!to || !officeOpenNow(new Date(), await getSettings())) return back(vr, "voicemail");
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "forwarded" }, ctx.session);
    sp(vr, ctx, "transfer_connecting");
    vr.dial({ callerId: process.env.TWILIO_PHONE_NUMBER || undefined, timeout: 25, action: url("operator-done"), method: "POST" }, to);
    return vr;
  },

  /** After the transfer: a finished conversation ends the call; otherwise offer a message or more booking. */
  async "operator-done"(ctx, vr) {
    if (ctx.body.DialCallStatus === "completed") {
      vr.hangup();
      return vr;
    }
    sp(vr, ctx, "transfer_failed");
    const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 6, action: url("voicemail-offer"), method: "POST" });
    sp(g, ctx, "voicemail_offer");
    return back(vr, "menu");
  },

  async "voicemail-offer"(ctx, vr) {
    if (ctx.body.Digits === "1") return back(vr, "voicemail");
    return back(vr, "menu");
  },

  /** Leave a message in the Main box: greeting, beep, record. Twilio posts the recording and transcription back. */
  async voicemail(ctx, vr) {
    const box = await mainBox();
    if (!box.enabled) {
      sp(vr, ctx, "operator_unavailable");
      return back(vr, "menu");
    }
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "voicemail" }, ctx.session);
    if (box.greetingText?.trim()) say(vr, box.greetingText.trim());
    else sp(vr, ctx, "voicemail_prompt");
    vr.record({
      maxLength: Math.min(Math.max(box.maxLengthSec, 10), 600),
      playBeep: true,
      finishOnKey: "#",
      timeout: 6,
      action: url("voicemail-done", { b: box.id }),
      method: "POST",
      recordingStatusCallback: url("vm-recording", { b: box.id, t: box.transcribe ? 1 : 0 }),
      recordingStatusCallbackEvent: ["completed"],
      recordingStatusCallbackMethod: "POST",
      transcribe: box.transcribe,
      ...(box.transcribe ? { transcribeCallback: url("vm-transcription", { b: box.id }) } : {}),
    });
    // Reached only if nothing was recorded.
    sp(vr, ctx, "voicemail_none");
    vr.hangup();
    return vr;
  },

  async "voicemail-done"(ctx, vr) {
    if (Number(ctx.body.RecordingDuration || 0) < 1) sp(vr, ctx, "voicemail_none");
    else sp(vr, ctx, "voicemail_thanks");
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
  const session = ctx.action === "incoming" ? null : await getSession(ctx.callSid);
  if (!session && ctx.action !== "incoming") await ensureSession(ctx.callSid, ctx.from);
  try {
    await handler({ ...ctx, session: session ?? (await getSession(ctx.callSid)) }, vr);
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
  if (s.orderId) await cancelHold(s.orderId); // only affects orders still in HOLD
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

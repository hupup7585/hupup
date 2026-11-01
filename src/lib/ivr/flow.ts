import twilio from "twilio";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { addDays, longDate, todayISO } from "@/lib/dates";
import { spokenMoney } from "@/lib/money";
import { last4, spokenDigits, toE164 } from "@/lib/phone";
import { checkBookable } from "@/lib/availability";
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
import { paymentLink } from "@/lib/sola";
import { sendSms } from "@/lib/notify";
import { ensureSession, getSession, updateSession, type CallSession } from "./session";
import { normalizeSpokenAddress, normalizeSpokenEmail, normalizeSpokenName, parseDateInput } from "./parse";

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
    say(vr, `Sorry, I'm having trouble hearing you. Please call us back any time. Thank you for calling ${BUSINESS_NAME}. Goodbye.`);
    vr.hangup();
    return vr;
  }
  say(vr, "Sorry, I didn't catch that.");
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

function itemPhrase(qty: number, name: string) {
  return qty === 1 ? `one ${name}` : `${qty} ${name}`;
}

/* ------------------------------------------------------------------ handlers */

type Handler = (ctx: Ctx, vr: VR) => Promise<VR> | VR;

const handlers: Record<string, Handler> = {
  async incoming(ctx, vr) {
    await ensureSession(ctx.callSid, ctx.from);
    say(vr, `Thank you for calling ${BUSINESS_NAME}! Bounce houses, laser tag, and paddle boats, delivered right to your door.`);
    return back(vr, "menu");
  },

  async menu(ctx, vr) {
    const cats = await phoneCategories();
    const order = await currentOrder(ctx);
    const g = keypad(vr, url("menu-choice"));
    if (!cats.length) say(g, "We're updating our rental catalog right now.");
    for (const c of cats) say(g, `For ${c.spokenName || c.name}, press ${c.ivrDigit}.`);
    if (order?.items.length) say(g, "To review your cart and check out, press 9.");
    if (config.forwardPhone()) say(g, "To speak with someone, press 0.");
    say(g, "To hear these options again, press star.");
    return noInput(vr, ctx, "menu");
  },

  async "menu-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (!d) return noInput(vr, ctx, "menu", {});
    if (d === "*") return back(vr, "menu");
    if (d === "9") return back(vr, "cart");
    if (d === "0") return back(vr, "operator");
    const cats = await phoneCategories();
    const cat = cats.find((c) => String(c.ivrDigit) === d);
    if (!cat) {
      say(vr, "Sorry, that's not one of the options.");
      return back(vr, "menu");
    }
    return back(vr, "category", { c: cat.id });
  },

  async category(ctx, vr) {
    const c = Number(ctx.query.get("c"));
    const [cat] = await db.select().from(categories).where(eq(categories.id, c));
    const items = cat ? await phoneProducts(c) : [];
    if (!cat || !items.length) {
      say(vr, "Sorry, there are no items available in that category right now.");
      return back(vr, "menu");
    }
    const g = keypad(vr, url("category-choice", { c }));
    say(g, `${cat.spokenName || cat.name}.`);
    items.forEach((p, i) => say(g, `For the ${p.name}, press ${i + 1}.`));
    say(g, "To go back to the main menu, press star.");
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
      say(vr, "Sorry, that's not one of the options.");
      return back(vr, "category", { c });
    }
    return back(vr, "product", { p: p.id });
  },

  async product(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p || !p.active) return back(vr, "menu");
    const g = keypad(vr, url("product-choice", { p: p.id }));
    if (!ctx.query.get("again")) say(g, `The ${p.name}. ${spokenMoney(p.priceCents)}, with delivery and next-day pickup.`);
    say(g, "To hear a description, press 1. To add it to your cart, press 2. To go back, press star.");
    return noInput(vr, ctx, "product", { p: p.id, again: 1 });
  },

  async "product-choice"(ctx, vr) {
    const p = await getProduct(Number(ctx.query.get("p")));
    if (!p) return back(vr, "menu");
    const d = ctx.body.Digits;
    if (!d) return noInput(vr, ctx, "product", { p: p.id, again: 1 });
    if (d === "*") return back(vr, "category", { c: p.categoryId });
    if (d === "1") {
      say(vr, p.spokenDescription || p.description || `The ${p.name} is one of our most popular rentals.`);
      pause(vr);
      return back(vr, "product", { p: p.id, again: 1 });
    }
    if (d === "2") {
      const order = await currentOrder(ctx);
      if (order) return back(vr, "qty", { p: p.id, d: order.order.eventDate });
      return back(vr, "date", { p: p.id });
    }
    say(vr, "Sorry, that's not one of the options.");
    return back(vr, "product", { p: p.id, again: 1 });
  },

  date(ctx, vr) {
    const p = ctx.query.get("p")!;
    const g = speech(vr, url("date-heard", { p, n: ctx.query.get("n") ?? undefined }), "today, tomorrow, Sunday, Monday, January, February, March, April, May, June, July, August, September, October, November, December", { dtmf: true, numDigits: 4 });
    say(g, "What date is your event? You can say the date, like November 8th, or enter the month and day on your keypad as four digits. For example, for November 8th, press 1 1 0 8.");
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
      const why =
        r.reason === "past"
          ? "That date has already passed."
          : r.reason === "too_far"
            ? "We can only book up to one year ahead."
            : "Sorry, I didn't understand that date.";
      say(vr, why);
      return back(vr, "date", { p, n: Number(ctx.query.get("n") || 0) + 1 });
    }
    const g = keypad(vr, url("date-confirm", { p, d: r.date }));
    say(g, `That's ${longDate(r.date)}. We deliver that day and pick up on ${longDate(addDays(r.date, 1))}. To confirm, press 1. To choose a different date, press 2.`);
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
      say(g, `Sorry, the ${p.name} is fully booked for ${longDate(date)}.`);
      const order = await currentOrder(ctx);
      if (order) say(g, "To hear other items, press 1. To review your cart, press 9.");
      else say(g, "To choose a different date, press 1. To hear other items, press 2.");
      say(g, "For the main menu, press star.");
      return noInput(vr, ctx, "menu");
    }
    if (free === 1) return back(vr, "add", { p: p.id, d: date, q: 1 });
    const max = Math.min(free, 9);
    const g = keypad(vr, url("add", { p: p.id, d: date }));
    say(g, `Good news, we have ${free} available for ${longDate(date)}. How many would you like? Enter a number from 1 to ${max}.`);
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
      say(vr, "Sorry, please enter a number from 1 to 9.");
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
        say(vr, r.free > 0 ? `Sorry, only ${r.free} are available for that date.` : `Sorry, the ${p.name} was just booked for that date.`);
        return back(vr, r.free > 0 ? "qty" : "menu", r.free > 0 ? { p: p.id, d: date } : {});
      }
      say(vr, "Sorry, something went wrong adding that item.");
      return back(vr, "menu");
    }
    await updateSession(ctx.callSid, { orderId: r.orderId, outcome: "carted" }, session);
    const g = keypad(vr, url("after-add"));
    say(g, `Great! I've added ${itemPhrase(q, p.name)} to your cart for ${longDate(date)}. It's reserved for you while we're on the call.`);
    say(g, "To keep shopping, press 1. To check out, press 9.");
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
      say(vr, "Your cart is empty.");
      return back(vr, "menu");
    }
    const list = order.items.map((i) => itemPhrase(i.qty, i.name)).join(", ");
    const g = keypad(vr, url("cart-choice"));
    say(g, `Your cart has ${list}, for ${longDate(order.order.eventDate)}. Your total is ${spokenMoney(order.order.subtotalCents)}.`);
    say(g, "To check out, press 1. To keep shopping, press 2. To empty your cart and start over, press 3.");
    return noInput(vr, ctx, "cart");
  },

  async "cart-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") return back(vr, "ask", { f: "name" });
    if (d === "2") return back(vr, "menu");
    if (d === "3") {
      if (ctx.session?.orderId) await cancelHold(ctx.session.orderId);
      await updateSession(ctx.callSid, { orderId: null, outcome: "browsing" }, ctx.session);
      say(vr, "Okay, your cart is now empty.");
      return back(vr, "menu");
    }
    return noInput(vr, ctx, "cart");
  },

  /* ---- checkout: name -> address -> email -> phone -> finalize ---- */

  async ask(ctx, vr) {
    if (!(await currentOrder(ctx))) {
      say(vr, "Your cart is empty.");
      return back(vr, "menu");
    }
    const f = ctx.query.get("f") as Field;
    const n = ctx.query.get("n") ?? undefined;
    const spec = FIELDS[f];
    const g = speech(vr, url("heard", { f, n }), spec.hints, { dtmf: f === "email" });
    say(g, spec.prompt);
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
        say(vr, "No problem, we'll skip the email.");
        return back(vr, "phone");
      }
      if (n >= MAX_NO_INPUT) {
        say(vr, "Sorry, I'm having trouble understanding.");
        return back(vr, config.forwardPhone() ? "operator" : "phone");
      }
      say(vr, f === "email" ? "Sorry, I couldn't make out that email address." : "Sorry, I didn't catch that.");
      return back(vr, "ask", { f, n });
    }
    await updateSession(ctx.callSid, { data: { heard: value } }, ctx.session);
    const g = keypad(vr, url("confirm", { f }));
    say(g, `I heard: ${spec.readBack(value)}. If that's correct, press 1. To try again, press 2.`);
    return noInput(vr, ctx, "ask", { f });
  },

  async confirm(ctx, vr) {
    const f = ctx.query.get("f") as Field;
    const d = ctx.body.Digits;
    if (d !== "1") return back(vr, "ask", { f });
    const heard = ctx.session?.data.heard;
    if (!heard) return back(vr, "ask", { f });
    await updateSession(ctx.callSid, { data: { [f]: heard, heard: undefined } }, ctx.session);
    return back(vr, FIELDS[f].next);
  },

  async phone(ctx, vr) {
    const from = toE164(ctx.from);
    if (!from) return back(vr, "phone-enter");
    const g = keypad(vr, url("phone-choice"));
    say(g, `We'll text your secure payment link to the number you're calling from, ending in ${spokenDigits(last4(from))}. To use this number, press 1. To enter a different mobile number, press 2.`);
    return noInput(vr, ctx, "phone");
  },

  async "phone-choice"(ctx, vr) {
    const d = ctx.body.Digits;
    if (d === "1") {
      await updateSession(ctx.callSid, { data: { phone: toE164(ctx.from)! } }, ctx.session);
      return back(vr, "finalize");
    }
    if (d === "2") return back(vr, "phone-enter");
    return noInput(vr, ctx, "phone");
  },

  "phone-enter"(ctx, vr) {
    const g = keypad(vr, url("phone-heard"), { numDigits: 10, timeout: 10, finishOnKey: "#" });
    say(g, "Please enter your 10-digit mobile number, starting with the area code.");
    return noInput(vr, ctx, "phone-enter");
  },

  async "phone-heard"(ctx, vr) {
    const e164 = toE164(ctx.body.Digits);
    if (!e164) {
      say(vr, "Sorry, that doesn't look like a 10-digit number.");
      return back(vr, "phone-enter");
    }
    await updateSession(ctx.callSid, { data: { heard: e164 } }, ctx.session);
    const g = keypad(vr, url("phone-confirm"));
    say(g, `I have ${spokenDigits(e164.slice(2, 5))}, ${spokenDigits(e164.slice(5, 8))}, ${spokenDigits(e164.slice(8))}. If that's correct, press 1. To re-enter it, press 2.`);
    return noInput(vr, ctx, "phone-enter");
  },

  async "phone-confirm"(ctx, vr) {
    if (ctx.body.Digits !== "1" || !ctx.session?.data.heard) return back(vr, "phone-enter");
    await updateSession(ctx.callSid, { data: { phone: ctx.session.data.heard, heard: undefined } }, ctx.session);
    return back(vr, "finalize");
  },

  async finalize(ctx, vr) {
    const order = await currentOrder(ctx);
    const data = ctx.session?.data ?? {};
    if (!order || !order.items.length) {
      say(vr, "Sorry, your cart has expired.");
      return back(vr, "menu");
    }
    if (!data.name || !data.address) return back(vr, "ask", { f: !data.name ? "name" : "address" });
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
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, order.order.id), eq(orders.status, "HOLD")));
    await updateSession(ctx.callSid, { outcome: "checked_out" }, ctx.session);

    const num = orderNumber(order.order.id);
    const link = paymentLink({
      orderId: order.order.id,
      amountCents: order.order.subtotalCents,
      name: data.name,
      email: data.email,
      phone,
    });
    const lines = order.items.map((i) => `${i.qty} x ${i.name}`).join(", ");
    let texted = false;
    if (phone) {
      const res = await sendSms(
        phone,
        `${BUSINESS_NAME} order #${num}: ${lines} for ${longDate(order.order.eventDate)} (pickup ${longDate(order.order.pickupDate)}). ` +
          `Total $${(order.order.subtotalCents / 100).toFixed(2)}. Pay securely within ${PAYMENT_HOLD_MINUTES} minutes to confirm: ${link}`,
      );
      texted = res.sent;
    }

    const first = data.name.split(" ")[0];
    say(vr, `Thank you, ${first}! Your order number is ${spokenDigits(num)}.`);
    if (texted) {
      say(vr, `We just texted you a secure payment link. Your items are reserved for ${PAYMENT_HOLD_MINUTES} minutes while you complete payment, and you'll get a text as soon as it's confirmed.`);
    } else {
      say(vr, "We weren't able to text you a payment link, so we'll call you back shortly to complete your booking.");
    }
    say(vr, `We'll deliver on ${longDate(order.order.eventDate)} and pick up on ${longDate(order.order.pickupDate)}. Thank you for choosing ${BUSINESS_NAME}. Goodbye!`);
    vr.hangup();
    return vr;
  },

  async operator(ctx, vr) {
    const to = config.forwardPhone();
    if (!to) {
      say(vr, "Sorry, no one is available right now.");
      return back(vr, "menu");
    }
    await updateSession(ctx.callSid, { outcome: ctx.session?.outcome === "carted" ? "carted" : "forwarded" }, ctx.session);
    say(vr, "Please hold while I connect you.");
    vr.dial({ callerId: process.env.TWILIO_PHONE_NUMBER || undefined, timeout: 25 }, to);
    say(vr, "Sorry, no one could take your call. Please try again later, or continue with our automated booking.");
    return back(vr, "menu");
  },
};

/* ------------------------------------------------------------------ checkout fields */

type Field = "name" | "address" | "email";
const FIELDS: Record<
  Field,
  { prompt: string; hints: string; normalize: (s: string) => string | null; readBack: (v: string) => string; next: string }
> = {
  name: {
    prompt: "Let's get your details. Please say your first and last name.",
    hints: "Friedman, Weiss, Schwartz, Klein, Gross, Teitelbaum, Goldberger, Weinberger, Rosenberg, Stein",
    normalize: (s) => normalizeSpokenName(s) || null,
    readBack: (v) => v,
    next: "ask?f=address",
  },
  address: {
    prompt: "Please say the full delivery address, including the house number, street, and town.",
    hints: "Kiryas Joel, Monroe, Palm Tree, Forest Road, Garfield Road, Bakertown Road, Mountain Road, Acres Road, Schunnemunk, Quickway Road, Seven Springs Road, Harriman, Chester, Blooming Grove",
    normalize: (s) => normalizeSpokenAddress(s) || null,
    readBack: (v) => v,
    next: "ask?f=email",
  },
  email: {
    prompt: "Please say your email address for your receipt, for example, john at gmail dot com. Or press pound to skip.",
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

export async function handleVoice(ctx: Omit<Ctx, "session">): Promise<string> {
  const vr = new twilio.twiml.VoiceResponse();
  const handler = handlers[ctx.action];
  if (!handler) {
    say(vr, "Sorry, something went wrong.");
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
    say(err, "Sorry, we're having a technical problem. Please call back in a few minutes.");
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

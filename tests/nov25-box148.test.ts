import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Box 148 and order texts (Abraham, Nov 25, 2026, 00:29 to 00:34). In-memory database; Twilio is a stand-in. */
const h = vi.hoisted(() => ({
  session: { callSid: "CA148", fromNumber: "+18455550501", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "checked_out", startedAt: new Date() },
  sent: [] as { to: string; body: string }[],
  receipts: [] as { to: string; orderId: number }[],
}));
vi.mock("@/lib/phone-receipt", () => ({
  RECEIPT_APPROVED: true,
  sendPhoneReceipt: async (to: string, input: { orderId: number }) => (h.receipts.push({ to, orderId: input.orderId }), { sent: true }),
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string }) => (h.sent.push({ to: p.to, body: p.body }), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CA148", ...body }, callSid: "CA148", from: "+18455550501" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const CALLER = "+18455550501";
let orderId = 0;
let customerId = 0;
const digits = () => String(1000 + orderId).split("").join(" ");

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  const [c] = await db.insert(schema.customers).values({ name: "Klein, Sara", phone: CALLER }).returning();
  customerId = c.id;
  const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", customerId: c.id, eventDate: "2026-12-07", pickupDate: "2026-12-08", subtotalCents: 20000, totalCents: 21625, paidCents: 21625 }).returning();
  orderId = o.id;
});
beforeEach(() => {
  h.sent.length = 0;
  h.session.data = {};
});
const optIn = (phone: string) => db.insert(schema.smsConsents).values({ customerId, phone, scope: "transactional", action: "opt_in", source: "phone", method: "keypad", wording: "x" });

describe("the approved texts, word for word (Admin slots)", () => {
  it("box 148 parts, box 140, box 58, box 59 and the hold line", async () => {
    const { allSlots } = await import("@/lib/recording-slots");
    const slot = new Map(allSlots().map((s) => [s.key, s.text]));
    expect(slot.get("phonepay_approved#1")).toBe("Thank you! Your payment was approved, and your booking is confirmed. Your order number is");
    expect(slot.get("phonepay_approved_star")).toBe("To hear it again, press star.");
    expect(slot.get("phonepay_approved_text")).toBe("We will text your confirmation to the number you are calling from. To send it to a different number, press 1.");
    expect(slot.get("phonepay_approved_bye")).toBe("We look forward to serving you again. Thank you for choosing Hup Up Attractions!");
    expect(slot.get("phonepay_approved_join")).toBe("To receive your confirmation and order updates by text, press 1.");
    expect(slot.get("pay_card_line")).toBe("If you would like to pay by credit or debit card, please stay on the line. To receive a payment link instead, press 0.");
    expect(slot.get("phonepay_retry")).toBe("We are sorry, your card did not go through. To try again, press 1.");
    expect(slot.get("phonepay_retry_last")).toBe("We are sorry, your card did not go through. You have one more chance. To try again, press 1.");
    expect(slot.get("phonepay_failed")).toBe("We are sorry, we were not able to process your card at this time. Please call us back later to complete your order, or you can contact customer service at extension 3 from the main menu. Thank you for calling Hup Up Attractions. Goodbye.");
    expect(slot.get("pay_hold_secure")).toBe("We will now connect you to our secure payment line. All card information is processed securely and directly by our provider, to ensure your card details remain private and protected. This may take a few moments. Please stay on the line while we connect you. Once your payment has been processed, please remain on the line to receive your booking confirmation.");
    expect(PROMPTS.phonepay_approved.vars).toEqual(["number"]); // no name
  });
});

describe("box 148", () => {
  it("a caller who did not agree to order texts: no B2 (the draft text line on preview), no name", async () => {
    const x = await call("pay-approved", {}, `o=${orderId}`);
    expect(said(x)).toEqual([
      `Thank you! Your payment was approved, and your booking is confirmed. Your order number is ${digits()}.`,
      "To hear it again, press star.",
      "To receive your confirmation and order updates by text, press 1.",
      "We look forward to serving you again. Thank you for choosing Hup Up Attractions!",
    ]);
    expect(said(x).join(" ")).not.toMatch(/Sara|Klein|We will text your confirmation/);
  });
  it("live line: the draft line waits for approval", async () => {
    process.env.VERCEL_ENV = "production";
    try {
      expect(said(await call("pay-approved", {}, `o=${orderId}`)).join(" ")).not.toContain("order updates by text");
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
  it("star replays the order number and the rest; a wrong key replays the rest; no key goes on", async () => {
    expect(redirect(await call("pay-approved-choice", { Digits: "*" }, `o=${orderId}`))).toBe(`pay-approved?o=${orderId}&st=1`);
    const again = said(await call("pay-approved", {}, `o=${orderId}&st=1`));
    expect(again[0]).toBe(`Your order number is ${digits()}.`);
    expect(again[1]).toBe("To hear it again, press star.");
    const bad = await call("pay-approved-choice", { Digits: "5" }, `o=${orderId}`);
    expect(said(bad)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(bad)).toBe(`pay-approved?o=${orderId}&r=1`);
    expect(said(await call("pay-approved", {}, `o=${orderId}&r=1`))[0]).toBe("To hear it again, press star.");
    expect(redirect(await call("pay-approved-choice", {}, `o=${orderId}`))).toBe(`receipt-email?o=${orderId}`); // no key: box 35 (Nov 25, 2026, 11:51)
  });
  it("not agreed, key 1: box 142 (which number); the chosen number signs up, gets the confirmation and becomes the order's text number", async () => {
    expect(redirect(await call("pay-approved-choice", { Digits: "1" }, `o=${orderId}`))).toBe(`tx-which?p=conf&o=${orderId}`);
    await call("tx-which-choice", { Digits: "1" }, `p=conf&o=${orderId}`); // the number calling
    expect(h.sent.map((m) => m.to)).toEqual([CALLER]);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(o.textPhone).toBe(CALLER);
    const consents = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, CALLER));
    expect(consents.some((c) => c.action === "opt_in" && c.scope === "transactional")).toBe(true);
  });
  it("agreed: B2 plays; key 1 = a different number, which then receives every later order update text", async () => {
    await optIn(CALLER);
    const x = said(await call("pay-approved", {}, `o=${orderId}`));
    expect(x[2]).toBe("We will text your confirmation to the number you are calling from. To send it to a different number, press 1.");
    expect(redirect(await call("pay-approved-choice", { Digits: "1" }, `o=${orderId}`))).toBe(`tx-enter?p=conf&o=${orderId}`);
    await call("tx-heard", { Digits: "8455550777" }, `p=conf&o=${orderId}`);
    await call("tx-confirm", { Digits: "1" }, `p=conf&o=${orderId}`);
    expect(h.sent.map((m) => m.to)).toEqual(["+18455550777"]);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(o.textPhone).toBe("+18455550777");
    // a later update for this order (the payment confirmation, here) goes to the new number, not the caller's phone
    h.sent.length = 0;
    const { recordPaymentResult } = await import("@/lib/payment-result");
    void recordPaymentResult;
    const { sendOrderText } = await import("@/lib/notify");
    const { orderTextPhone, getOrderWithItems } = await import("@/lib/orders");
    const full = await getOrderWithItems(orderId);
    await sendOrderText({ phone: orderTextPhone(full!.order, full!.customer)!, subject: "x", body: "Your driver is on the way.", orderId, event: "delivery_on_the_way" });
    expect(h.sent.map((m) => m.to)).toEqual(["+18455550777"]);
  });
});

describe("Box 35 after payment (Abraham, Nov 25, 2026, 11:51)", () => {
  it("the exact text; plays after the approved payment (box 148 no key), never with money still due", async () => {
    expect(PROMPTS.box35_receipt.text).toBe("To receive a receipt by email, press 1. To skip, press pound.");
    const { allSlots } = await import("@/lib/recording-slots");
    expect(new Map(allSlots().map((x) => [x.key, x.text])).get("box35_receipt")).toBe("To receive a receipt by email, press 1. To skip, press pound.");
    expect(Object.values(PROMPTS).some((p) => p.text.includes("Almost done! To get your receipt"))).toBe(false);
    expect(redirect(await call("pay-approved", {}, `o=${orderId}`))).toBe(`receipt-email?o=${orderId}`);
    const box = await call("receipt-email", {}, `o=${orderId}`);
    expect(said(box)).toEqual(["To receive a receipt by email, press 1. To skip, press pound."]);
    expect(box).not.toContain("press star");
    const [unpaid] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId, eventDate: "2026-12-09", pickupDate: "2026-12-10", subtotalCents: 20000, totalCents: 21625, paidCents: 0 }).returning();
    expect(redirect(await call("receipt-email", {}, `o=${unpaid.id}`))).toBe("promo-consent");
  });
  it("pound skips to the goodbye; a wrong key: not valid, then box 35 again", async () => {
    expect(redirect(await call("receipt-email-choice", { Digits: "#" }, `o=${orderId}`))).toBe("promo-consent");
    const bad = await call("receipt-email-choice", { Digits: "*" }, `o=${orderId}`);
    expect(said(bad)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(bad)).toBe(`receipt-email?o=${orderId}`);
  });
  it("after the box 148 different-number step: box 35", async () => {
    await optIn(CALLER);
    await call("tx-heard", { Digits: "8455550888" }, `p=conf&o=${orderId}`);
    expect(redirect(await call("tx-confirm", { Digits: "1" }, `p=conf&o=${orderId}`))).toBe(`receipt-email?o=${orderId}`);
  });
  it("key 1: the email steps, and the receipt goes to the entered email; a customer with no email gets it saved", async () => {
    h.receipts.length = 0;
    expect(redirect(await call("receipt-email-choice", { Digits: "1" }, `o=${orderId}`))).toBe(`catalog-email?p=rcpt&o=${orderId}`);
    await call("catalog-email", {}, `p=rcpt&o=${orderId}`);
    h.session.data = { ...h.session.data, catLocal: "sara", catDomain: "gmail.com" };
    expect(redirect(await call("catalog-final-choice", { Digits: "1" }))).toBe("promo-consent");
    expect(h.receipts).toEqual([{ to: "sara@gmail.com", orderId }]);
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId));
    expect(c.email).toBe("sara@gmail.com");
  });
});

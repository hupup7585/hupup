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

// The old box 148 text lines (Line 5a/5b) and box 35 were replaced by line 5 (Hark for Abraham, Nov 26, 2026, 3:56 PM
// ET): see tests/nov26-after-payment-v2.test.ts. Their removed checks are covered there.
describe("the receipt by email (now reached from line 5)", () => {
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

describe("back from the payment line (Abraham, Nov 25, 2026, 12:27)", () => {
  it("no 'Thank you. Let us finish your order.' line: straight to the result; the line is retired in Admin", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toContain('"phonepay_back"');
    const { RETIRED_PROMPTS } = await import("@/lib/ivr/prompts");
    expect(RETIRED_PROMPTS.has("phonepay_back")).toBe(true);
  });
});

describe("item 11 (Abraham, Nov 25, 2026, 4:42 PM): what is live and what waits", () => {
  it("every approved slot word for word; the dates line plays right after the order number (approved Nov 26, 2026, 01:25 ET)", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.phonepay_approved.text).toBe("Thank you! Your payment was approved, and your booking is confirmed. Your order number is {number}.");
    expect(PROMPTS.phonepay_approved_star.text).toBe("To hear it again, press star.");
    expect(PROMPTS.phonepay_approved_text.text).toBe("We will text your confirmation to the number you are calling from. To send it to a different number, press 1.");
    expect(PROMPTS.phonepay_approved_bye.text).toBe("We look forward to serving you again. Thank you for choosing Hup Up Attractions!");
    expect(PROMPTS.pay_approved_dates.text).toBe("We will deliver on {date} and pick up on {pickup}.");
    expect(PROMPTS.pay_hold_secure.text).toBe("We will now connect you to our secure payment line. All card information is processed securely and directly by our provider, to ensure your card details remain private and protected. This may take a few moments. Please stay on the line while we connect you. Once your payment has been processed, please remain on the line to receive your booking confirmation.");
    expect(PROMPTS.pay_card_line.text).toBe("If you would like to pay by credit or debit card, please stay on the line. To receive a payment link instead, press 0.");
    expect(PROMPTS.phonepay_retry.text).toBe("We are sorry, your card did not go through. To try again, press 1.");
    expect(PROMPTS.phonepay_retry_last.text).toBe("We are sorry, your card did not go through. You have one more chance. To try again, press 1.");
    expect(PROMPTS.phonepay_failed.text).toBe("We are sorry, we were not able to process your card at this time. Please call us back later to complete your order, or you can contact customer service at extension 3 from the main menu. Thank you for calling Hup Up Attractions. Goodbye.");
    const { lineStatus } = await import("@/lib/prompt-status");
    expect(lineStatus("pay_approved_dates", {}).reason ?? "").not.toMatch(/Waiting for Abraham/);
    const DATES = "We will deliver on Monday, December seventh and pick up on Tuesday, December eighth.";
    const x = said(await call("pay-approved", {}, `o=${orderId}`));
    const num = x.findIndex((l) => l.startsWith("Thank you! Your payment was approved"));
    expect(num).toBeGreaterThan(-1);
    expect(x[num + 1]).toBe(DATES); // right after the order number
    expect(x[num + 2]).toBe("To hear it again, press star."); // line 3 (Nov 26, 2026, 3:56 PM ET); the pickup note is line 4, next
    expect(said(await call("pay-approved-text", {}, `o=${orderId}`))[0]).toBe("Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup.");
    expect(PROMPTS.pay_approved_pickup_note.text).toBe("Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup.");
    // star (Nov 26, 2026): from Line 1, with the dates and the note again
    expect(redirect(await call("pay-approved-choice", { Digits: "*" }, `o=${orderId}`))).toBe(`pay-approved?o=${orderId}`);
  });
});

describe("the pickup note (Abraham, Nov 26, 2026, 01:28 ET)", () => {
  it("its own Admin slot with the exact text (Google voice until a recording is uploaded); its recording plays once chosen", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.pay_approved_pickup_note.text).toBe("Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup.");
    const { allSlots } = await import("@/lib/recording-slots");
    expect(new Map(allSlots().map((x) => [x.key, x.text])).get("pay_approved_pickup_note")).toBe("Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup.");
    const lines = said(await call("pay-approved-text", {}, `o=${orderId}`)); // line 4, before line 5 (Nov 26, 2026, 3:56 PM ET)
    expect(lines.filter((l) => l === "Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup.")).toHaveLength(1);
    expect(lines[0]).toBe("Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup.");
  });
});

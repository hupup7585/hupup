import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

/*
 * Sola payments (Abraham, Nov 12, 2026): the link charges items + delivery + tax; Sola's webhook marks the order
 * Paid or Declined with the date and time and the card's last 4 only. In-memory database; nothing is sent for real.
 */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[], sms: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendSms: async (_to: string, body: string) => (h.sms.push(body), { sent: true }),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ensurePriced } from "@/lib/order-pricing";
import { invoiceFor, last4Of, paymentLink, paymentResultOf } from "@/lib/sola";
import { paymentResultLabel } from "@/lib/payment-result";
import { POST as solaWebhook } from "@/app/api/sola/webhook/route";

const PIN = "test-pin";
function sign(fields: Record<string, string>) {
  const vals = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v).join("");
  return crypto.createHash("md5").update(vals + PIN).digest("hex");
}
const post = (fields: Record<string, string>) =>
  solaWebhook(new Request("https://hupup.example/api/sola/webhook", { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "ck-signature": sign(fields) } }));
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

let orderId = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_WEBHOOK_PIN = PIN;
  const [c] = await db.insert(schema.customers).values({ name: "Test Customer", phone: "+18455550166", email: "test@example.com" }).returning();
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "POS", customerId: c.id, eventDate: "2026-12-15", pickupDate: "2026-12-16", deliveryAddress: "12 Forest Road, Monroe", subtotalCents: 20000 })
    .returning();
  orderId = o.id;
});

describe("the link charges items + delivery + tax", () => {
  it("an order made in Admin gets priced before its link: $200 + $15 delivery (Monroe) + 8.125% tax = $232.47", async () => {
    expect((await order(orderId)).totalCents).toBeNull();
    expect(await ensurePriced(orderId)).toBe(true);
    const o = await order(orderId);
    expect([o.deliveryFeeCents, o.taxCents, o.totalCents]).toEqual([1500, 1747, 23247]);
    process.env.SOLA_PAYMENTSITE_NAME = "hupupattractions";
    const link = new URL(paymentLink({ orderId, amountCents: o.totalCents! })!);
    expect(link.host).toBe("secure.cardknox.com");
    expect(link.searchParams.get("xAmount")).toBe("232.47");
    expect(link.searchParams.get("xInvoice")).toBe(invoiceFor(orderId));
    delete process.env.SOLA_PAYMENTSITE_NAME;
    // Nov 24, 2026: on Vercel (preview or production) a missing page name means no link at all, never the test link
    process.env.VERCEL = "1";
    expect(paymentLink({ orderId, amountCents: o.totalCents! })).toBeNull();
    delete process.env.VERCEL;
  });
  it("no link for an address outside the delivery area (it couldn't include delivery and tax)", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "POS", eventDate: "2026-12-20", pickupDate: "2026-12-21", deliveryAddress: "5 Main St, Albany", subtotalCents: 10000 }).returning();
    expect(await ensurePriced(o.id)).toBe(false);
  });
});

describe("Sola's webhook: Paid or Declined, with date and time and last 4 only", () => {
  it("reads the result and the last 4 digits from Sola's masked number", () => {
    expect(paymentResultOf({ xResult: "A" })).toBe("approved");
    expect(paymentResultOf({ xResult: "D" })).toBe("declined");
    expect(paymentResultOf({ xResult: "E" })).toBe("declined");
    expect(last4Of({ xMaskedCardNumber: "4xxxxxxxxxxx1111" })).toBe("1111");
    expect(last4Of({})).toBeNull();
  });
  it("rejects a bad signature", async () => {
    const res = await solaWebhook(new Request("https://hupup.example/api/sola/webhook", { method: "POST", body: "xResult=A", headers: { "ck-signature": "bad" } }));
    expect(res.status).toBe(401);
  });
  it("declined: marked Declined with the time and last 4; still waiting for payment", async () => {
    const res = await post({ xResult: "D", xStatus: "Declined", xInvoice: invoiceFor(orderId), xAmount: "232.47", xMaskedCardNumber: "4xxxxxxxxxxx0002", xRefNum: "100" });
    expect(res.status).toBe(200);
    const o = await order(orderId);
    expect(o.paymentResult).toBe("declined");
    expect(o.cardLast4).toBe("0002");
    expect(o.status).toBe("PENDING_PAYMENT");
    expect(o.paidCents).toBe(0);
    expect(paymentResultLabel(o)).toMatch(/^Declined [A-Z][a-z]{2} \d{1,2}, 20\d\d, \d{1,2}:\d\d [AP]M, card ending 0002$/);
  });
  it("approved: Paid, confirmed, with the time and last 4; nothing else about the card is stored", async () => {
    const res = await post({ xResult: "A", xStatus: "Approved", xCommand: "cc:sale", xInvoice: invoiceFor(orderId), xAuthAmount: "232.47", xMaskedCardNumber: "4xxxxxxxxxxx1111", xRefNum: "101" });
    expect(res.status).toBe(200);
    const o = await order(orderId);
    expect(o.paymentResult).toBe("approved");
    expect(o.status).toBe("CONFIRMED");
    expect(o.paidCents).toBe(23247);
    expect(o.cardLast4).toBe("1111");
    expect(o.solaRefNum).toBe("101");
    expect(JSON.stringify(o)).not.toContain("4xxxxxxxxxxx1111");
    expect(paymentResultLabel(o)).toContain("Paid ");
  });
});

describe("no card digits on our side", () => {
  it("no card fields anywhere; Twilio <Pay> only in the payment subaccount's handler (Stripe), never on the main hotline", async () => {
    const { execSync } = await import("node:child_process");
    expect(execSync("grep -rlE 'xCardNum|xCVV|xExp' src || true").toString().trim()).toBe("");
    expect(execSync("grep -rlE 'vr\\.pay\\(|\\.pay\\(\\{' src || true").toString().trim()).toBe("src/lib/stripe-pay-voice.ts");
  });
});

describe("no fake payment on the live site (Nov 24, 2026)", () => {
  it("the test link only on a developer's own computer; the missing settings are named for Admin", async () => {
    const { devPaymentFallbackAllowed, onlinePaymentReady, solaMissing, PAYMENT_UNAVAILABLE } = await import("@/lib/sola");
    expect(PAYMENT_UNAVAILABLE).toBe("Online payment is not available right now. Please call us.");
    expect(devPaymentFallbackAllowed({ VERCEL: "1", NODE_ENV: "production" })).toBe(false);
    expect(devPaymentFallbackAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(devPaymentFallbackAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(onlinePaymentReady({ VERCEL: "1", NODE_ENV: "production" })).toBe(false);
    expect(onlinePaymentReady({ VERCEL: "1", NODE_ENV: "production", SOLA_PAYMENTSITE_NAME: "hupup" })).toBe(true);
    expect(solaMissing({})).toEqual(["SOLA_PAYMENTSITE_NAME", "SOLA_WEBHOOK_PIN"]);
    expect(solaMissing({ SOLA_PAYMENTSITE_NAME: "x", SOLA_WEBHOOK_PIN: "y" })).toEqual([]);
  });
  it("the webhook marks nothing paid without SOLA_WEBHOOK_PIN", async () => {
    delete process.env.SOLA_WEBHOOK_PIN;
    const { POST } = await import("@/app/api/sola/webhook/route");
    const r = await POST(new Request("https://x/api/sola/webhook", { method: "POST", body: "xResult=A&xInvoice=HU-1001&xAmount=10.00&xRefNum=1" }));
    expect(r.status).toBe(503);
  });
});

describe("Audit C1 (Nov 24, 2026): only a full sale confirms an order", () => {
  let small = 0;
  beforeAll(async () => {
    process.env.SOLA_WEBHOOK_PIN = PIN;
    process.env.ADMIN_EMAIL = "owner@example.com";
    const [c] = await db.insert(schema.customers).values({ name: "Short Payer", phone: "+18455550177" }).returning();
    const [o] = await db
      .insert(schema.orders)
      .values({ status: "PENDING_PAYMENT", channel: "POS", customerId: c.id, eventDate: "2026-12-15", pickupDate: "2026-12-16", deliveryAddress: "12 Forest Road, Monroe", subtotalCents: 20000 })
      .returning();
    small = o.id;
    expect(await ensurePriced(small)).toBe(true);
    expect((await order(small)).totalCents).toBe(23247);
  });
  const income = async (id: number) => (await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, id))).filter((e) => e.kind === "income");

  it("$1.00 approved on a $232.47 order: not confirmed, Needs attention, Owner emailed, no paid notice to the customer", async () => {
    h.emails.length = 0;
    h.sms.length = 0;
    const res = await post({ xResult: "A", xStatus: "Approved", xCommand: "cc:sale", xInvoice: invoiceFor(small), xAmount: "1.00", xRefNum: "201" });
    expect(res.status).toBe(200);
    const o = await order(small);
    expect(o.status).toBe("NEEDS_ATTENTION");
    expect(o.paidCents).toBe(100);
    expect(o.notes).toContain("Paid $1.00 of $232.47.");
    expect(h.emails.some((e) => e.to === "owner@example.com" && /paid less than the total/.test(e.subject))).toBe(true);
    expect(h.sms).toEqual([]); // no "paid" text
  });

  it("a $0.00 approval is ignored", async () => {
    const res = await post({ xResult: "A", xCommand: "cc:sale", xInvoice: invoiceFor(small), xAmount: "0.00", xRefNum: "202" });
    expect(await res.text()).toBe("ignored (zero amount)");
    expect((await order(small)).paidCents).toBe(100);
  });

  it("a signed refund or void with result A for the same invoice is not a new payment", async () => {
    const before = await income(small);
    for (const [cmd, ref] of [["cc:refund", "203"], ["cc:void", "204"], ["cc:authonly", "205"], ["cc:save", "206"], ["cc:adjust", "207"]]) {
      const res = await post({ xResult: "A", xStatus: "Approved", xCommand: cmd, xInvoice: invoiceFor(small), xAmount: "232.47", xRefNum: ref });
      expect(await res.text()).toBe(`ignored (${cmd})`);
    }
    expect((await order(small)).paidCents).toBe(100);
    expect(await income(small)).toHaveLength(before.length);
  });

  it("the rest paid as a sale (cc:sale): now paid in full, confirmed", async () => {
    const res = await post({ xResult: "A", xStatus: "Approved", xCommand: "cc:sale", xInvoice: invoiceFor(small), xAmount: "231.47", xRefNum: "208" });
    expect(res.status).toBe(200);
    const o = await order(small);
    expect(o.paidCents).toBe(23247);
    expect(o.status).toBe("NEEDS_ATTENTION"); // staff set it right after an underpayment; a later full payment never auto-confirms over a flag
  });
});


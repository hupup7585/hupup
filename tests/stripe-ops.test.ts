import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

/* Stripe refunds, fees, disputes (Abraham, Nov 12, 2026). In-memory database; Stripe is simulated. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
  sendSms: async () => ({ sent: false }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { disputeEvidence, disputesFor, handleStripeEvent, refundOrder, refundStatus, refundsFor, sendDisputeEvidence, syncStripeBalance } from "@/lib/stripe-ops";
import { formEncode, stripeMode, verifyStripeSignature } from "@/lib/stripe";
import { phonePayStatus } from "@/lib/phone-pay";
import { phoneReceipt, sendPhoneReceipt, RECEIPT_APPROVED } from "@/lib/phone-receipt";
import { POST as webhook } from "@/app/api/stripe/webhook/route";

let orderId = 0;
const order = async () => (await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0];
const calls: { url: string; body: string; key: string; idem?: string }[] = [];
const fakeStripe = (reply: (url: string) => unknown, status = 200) =>
  (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body ?? ""), key: String((init.headers as Record<string, string>).Authorization), idem: (init.headers as Record<string, string>)["Idempotency-Key"] });
    return new Response(JSON.stringify(reply(url)), { status });
  }) as unknown as typeof fetch;

beforeAll(async () => {
  process.env.ADMIN_EMAIL = "hupupattractions@gmail.com";
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.STRIPE_READ_KEY = "rk_test_read";
  process.env.STRIPE_REFUNDS_KEY = "rk_test_refunds";
  process.env.STRIPE_DISPUTES_KEY = "rk_test_disputes";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const [c] = await db.insert(schema.customers).values({ name: "Test Caller", phone: "+18455550144", email: "caller@example.com" }).returning();
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "CONFIRMED", channel: "PHONE", customerId: c.id, eventDate: "2026-12-15", pickupDate: "2026-12-16", deliveryAddress: "12 Forest Road, Monroe", subtotalCents: 20000, deliveryFeeCents: 1500, taxCents: 1747, totalCents: 23247, paidCents: 23247, paymentMethod: "stripe", stripePaymentId: "ch_test_1", paymentResult: "approved", paymentResultAt: new Date(), cardLast4: "4242" })
    .returning();
  orderId = o.id;
});

describe("status in Admin", () => {
  it("Off / Owner test / Live and Stripe test or live mode, from the key", () => {
    expect(phonePayStatus({ STRIPE_READ_KEY: "rk_test_x" }, "owner_test")).toMatchObject({ mode: "Owner test", configured: false, stripe: "Stripe test mode" });
    expect(phonePayStatus({ STRIPE_READ_KEY: "rk_live_x" }, "live").stripe).toBe("Stripe live mode");
    expect(phonePayStatus({}, "off")).toMatchObject({ mode: "Off", stripe: "Stripe keys not in Vercel yet" });
    expect(stripeMode({ STRIPE_REFUNDS_KEY: "rk_test_1" })).toBe("test");
  });
});

describe("refunds from Admin", () => {
  it("part, then the rest: Partly refunded, then Refunded; recorded with who and when; read key never used for refunds", async () => {
    const f = fakeStripe(() => ({ id: "re_1", status: "succeeded" }));
    const r1 = await refundOrder(orderId, 5000, 7, f);
    expect(r1.amountCents).toBe(5000);
    expect(calls.at(-1)!.url).toBe("https://api.stripe.com/v1/refunds");
    expect(calls.at(-1)!.body).toContain("charge=ch_test_1");
    expect(calls.at(-1)!.body).toContain("amount=5000");
    expect(calls.at(-1)!.key).toBe("Bearer rk_test_refunds");
    expect(calls.at(-1)!.idem).toMatch(/^refund-/);
    expect(refundStatus(await order())).toBe("Partly refunded");
    await expect(refundOrder(orderId, 99999, 7, f)).rejects.toThrow("At most $182.47");
    await refundOrder(orderId, "full", 7, fakeStripe(() => ({ id: "re_2", status: "succeeded" })));
    expect(refundStatus(await order())).toBe("Refunded");
    expect((await order()).refundedCents).toBe(23247);
    const list = await refundsFor(orderId);
    expect(list.map((r) => [r.amountCents, r.userId, r.source])).toEqual([[18247, 7, "admin"], [5000, 7, "admin"]]);
    const books = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.kind, "refund"));
    expect(books.map((b) => b.amountCents).sort()).toEqual([18247, 5000].sort());
  });
  it("a failed refund is kept and nothing changes on the order", async () => {
    const before = (await order()).refundedCents;
    await db.update(schema.orders).set({ refundedCents: 0 }).where(eq(schema.orders.id, orderId));
    h.emails.length = 0;
    await expect(refundOrder(orderId, 100, 7, fakeStripe(() => ({ error: { message: "Card closed" } }), 402))).rejects.toThrow("The card company didn't accept the refund (Card closed).");
    expect((await refundsFor(orderId))[0]).toMatchObject({ status: "failed", error: "The card company didn't accept the refund (Card closed)." });
    expect(h.emails.find((e) => e.subject.startsWith("Refund failed on order"))?.to).toBe("hupupattractions@gmail.com");
    await db.update(schema.orders).set({ refundedCents: before }).where(eq(schema.orders.id, orderId));
  });
  it("cash orders can't be refunded here", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2026-12-20", pickupDate: "2026-12-21", subtotalCents: 100, paidCents: 100, paymentMethod: "cash" }).returning();
    await expect(refundOrder(o.id, "full", 7, fakeStripe(() => ({})))).rejects.toThrow("no card payment to refund");
  });
});

describe("Stripe fees and payouts (read-only key)", () => {
  it("pulls balance lines and payouts; each fee goes in the books once", async () => {
    const f = fakeStripe((url) =>
      url.includes("/v1/payouts")
        ? { data: [{ id: "po_1", amount: 22540, status: "paid", arrival_date: 1794600000, created: 1794500000 }] }
        : { has_more: false, data: [{ id: "txn_1", type: "charge", amount: 23247, fee: 704, net: 22543, description: "order", source: "ch_test_1", created: 1794500000, available_on: 1794600000 }] },
    );
    expect(await syncStripeBalance(f)).toEqual({ added: 1, payouts: 1 });
    expect(calls.at(-1)!.key).toBe("Bearer rk_test_read");
    await syncStripeBalance(f);
    const fees = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.kind, "processor_fee"));
    expect(fees.map((x) => [x.amountCents, x.category, x.orderId])).toEqual([[704, "Stripe fees", orderId]]);
    const [line] = await db.select().from(schema.stripeBalanceLines);
    expect(line.orderId).toBe(orderId);
  });
});

describe("disputes", () => {
  const sign = (body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex")}`;
  it("Stripe's signature is checked", async () => {
    const body = JSON.stringify({ type: "charge.dispute.created", data: { object: {} } });
    expect(verifyStripeSignature(body, sign(body), "whsec_test")).toBe(true);
    expect(verifyStripeSignature(body, sign(body, 1000), "whsec_test")).toBe(false); // too old
    expect((await webhook(new Request("https://hupup.example/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=bad" } }))).status).toBe(400);
  });
  it("a dispute shows on the order and emails Abraham; Send proof sends the order, phone read-back and delivery record", async () => {
    const body = JSON.stringify({ type: "charge.dispute.created", data: { object: { id: "dp_1", amount: 23247, reason: "fraudulent", status: "needs_response", charge: "ch_test_1", evidence_details: { due_by: 1795000000 } } } });
    const res = await webhook(new Request("https://hupup.example/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": sign(body) } }));
    expect(res.status).toBe(200);
    const [d] = await disputesFor(orderId);
    expect(d).toMatchObject({ stripeDisputeId: "dp_1", amountCents: 23247, status: "needs_response" });
    const mail = h.emails.find((e) => e.subject.startsWith("Dispute on order"));
    expect(mail?.to).toBe("hupupattractions@gmail.com");
    const ev = await disputeEvidence(orderId);
    expect(ev.uncategorized_text).toContain("Your total is 232 dollars and 47 cents");
    expect(ev.uncategorized_text).toContain("card ending 4242");
    expect(ev.uncategorized_text).toContain("DELIVERY PHOTOS");
    const f = fakeStripe(() => ({ id: "dp_1" }));
    await sendDisputeEvidence(d.id, 7, f);
    expect(calls.at(-1)!.key).toBe("Bearer rk_test_disputes");
    expect(calls.at(-1)!.url).toBe("https://api.stripe.com/v1/disputes/dp_1");
    expect(decodeURIComponent(calls.at(-1)!.body)).toContain("evidence[uncategorized_text]=");
    expect(calls.at(-1)!.body).toContain("submit=true");
    await expect(sendDisputeEvidence(d.id, 7, f)).rejects.toThrow("already sent");
  });
  it("refunds made in Stripe's dashboard show on the order too", async () => {
    await db.update(schema.orders).set({ refundedCents: 0 }).where(eq(schema.orders.id, orderId));
    await handleStripeEvent({ type: "charge.refunded", data: { object: { id: "ch_test_1", refunds: { data: [{ id: "re_dash", amount: 1000, status: "succeeded" }] } } } });
    expect((await order()).refundedCents).toBe(1000);
    expect((await refundsFor(orderId))[0].source).toBe("stripe_dashboard");
  });
  it("nested params are encoded the way Stripe expects", () => {
    expect(formEncode({ evidence: { customer_name: "A B" }, submit: true })).toEqual(["evidence%5Bcustomer_name%5D=A%20B", "submit=true"]);
  });
});

describe("our receipt (draft until approved)", () => {
  it("order number, date and time with year, amount, last 4; not sent until Abraham approves", async () => {
    const r = phoneReceipt({ orderId: 5, paidAt: new Date("2026-11-12T20:05:00Z"), amountCents: 23247, last4: "4242", name: "Sara Klein" });
    expect(r.subject).toBe("Hup Up Attractions receipt for order #1005");
    expect(r.text).toContain("Paid on: Nov 12, 2026, 3:05 PM");
    expect(r.text).toContain("Amount: $232.47");
    expect(r.text).toContain("Card: ending in 4242");
    expect(RECEIPT_APPROVED).toBe(false);
    h.emails.length = 0;
    expect((await sendPhoneReceipt("caller@example.com", { orderId: 5, paidAt: new Date(), amountCents: 1, last4: null })).sent).toBe(false);
    expect(h.emails).toHaveLength(0);
  });
});

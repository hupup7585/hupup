import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { chargedCents, handlePayVoice, _payAmountToken, _payLegToken } from "@/lib/stripe-pay-voice";
import { releaseExpired, reserveItem } from "@/lib/orders";

let pid = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.STRIPE_PHONE_PAY_MODE = "owner_test";
  process.env.AUTH_SECRET = "test-secret";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  pid = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 1, active: true }).returning())[0].id;
});

describe("Hark's payment check, Nov 27, bug 5: Stripe keypad records what Stripe charged", () => {
  it("hold released between <Pay> and its result: Stripe charged $178.41, the order records $0", async () => {
    const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: "2027-03-09", channel: "PHONE", status: "PENDING_PAYMENT", holdExpiresAt: new Date(Date.now() - 60_000), callSid: "CAstripe" });
    if (!r.ok) throw new Error("no hold");
    const id = r.orderId;
    await db.update(schema.orders).set({ totalCents: 17841 }).where(eq(schema.orders.id, id));
    // <Pay chargeAmount="178.41"> was sent earlier; meanwhile the release job ran
    await releaseExpired();
    const sid = "CApayleg";
    await handlePayVoice("result", new URLSearchParams({ o: String(id), n: "1", t: _payLegToken(id, sid), c: "17841", ca: _payAmountToken(id, sid, 17841) }), { CallSid: sid, Result: "success", PaymentConfirmationCode: "ch_123", PaymentCardNumber: "xxxx-4242" });
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    console.log({ status: o.status, paidCents: o.paidCents, stripePaymentId: o.stripePaymentId, paymentResult: o.paymentResult });
    expect(o.paidCents).toBe(17841);
  });
  it("an amount that is not signed for this payment is never used", () => {
    expect(chargedCents(5, "CAx", "17841", _payAmountToken(5, "CAx", 17841))).toBe(17841);
    expect(chargedCents(5, "CAx", "99999", _payAmountToken(5, "CAx", 17841))).toBeNull();
    expect(chargedCents(5, "CAy", "17841", _payAmountToken(5, "CAx", 17841))).toBeNull();
    expect(chargedCents(5, "CAx", null, null)).toBeNull();
  });
});

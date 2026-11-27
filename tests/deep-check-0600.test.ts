import { beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 2026, 6:00 AM (docs/audit/2026-11-27-0600-deep-check.md): money items fixed by this check. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: false }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { refundOrder, refundTaxShare } from "@/lib/refunds";
import { recordBookingPayment } from "@/lib/books";

let n = 5000;
const solaOk = (async () => new Response(JSON.stringify({ xResult: "A", xRefNum: String(n++) }))) as unknown as typeof fetch;
beforeAll(() => {
  process.env.SOLA_API_KEY = "sola_sandbox_key";
  process.env.SOLA_REFUND_MODE = "sandbox";
});

describe("deep check 06:00 M1: one payment is booked once in Bookkeeping", () => {
  it("two records of the same payment at the same moment make one income entry", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-12-20", pickupDate: "2026-12-21", subtotalCents: 10000, deliveryFeeCents: 2000, taxCents: 975, totalCents: 12975, paidCents: 12975 }).returning();
    await Promise.all([recordBookingPayment(o.id, 12975, "sola", "R-M1"), recordBookingPayment(o.id, 12975, "sola", "R-M1"), recordBookingPayment(o.id, 12975, "sola", "R-M1")]);
    const rows = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, o.id));
    expect(rows.filter((r) => r.kind === "income")).toHaveLength(1);
  });
});

describe("deep check 06:00 M2: a refund on an order with services gives back the order's tax, not more", () => {
  it("tax_cents already includes the services' tax", async () => {
    // tax $11.38 of which $1.63 is the services' tax
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2026-12-20", pickupDate: "2026-12-21", subtotalCents: 10000, deliveryFeeCents: 2000, servicesCents: 2000, servicesTaxCents: 163, taxCents: 1138, totalCents: 15138, paidCents: 15138, paymentMethod: "sola", solaRefNum: "R-M2", cardLast4: "1111", paymentResult: "approved", paymentResultAt: new Date() }).returning();
    expect(await refundTaxShare(o.id, 15138)).toBe(1138);
  });
});

describe("deep check 06:00 M3: a refund on a tax-exempt order", () => {
  it("is booked as exempt in the order's county, so taxable sales never go negative", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2026-12-20", pickupDate: "2026-12-21", subtotalCents: 10000, deliveryFeeCents: 0, taxCents: 0, totalCents: 10000, paidCents: 10000, paymentMethod: "sola", solaRefNum: "R-M3", cardLast4: "1111", paymentResult: "approved", paymentResultAt: new Date(), deliveryAddress: "1 Main St, Monroe NY 10950" }).returning();
    await refundOrder(o.id, "full", 1, solaOk);
    const [r] = (await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, o.id))).filter((e) => e.kind === "refund");
    expect(r.taxExempt).toBe(true);
    expect(r.county).toBe("Orange");
  });
});

describe("deep check 06:00 M27: no opt-in while the number replied STOP on another record", () => {
  it("record A replied STOP, record B (same phone) did not: a marketing opt-in is refused", async () => {
    const phone = "+18455550627";
    await db.insert(schema.customers).values([{ phone, name: "B", smsOptOut: false }, { phone, name: "A", smsOptOut: true }]);
    const { recordConsent } = await import("@/lib/sms-consent");
    await expect(recordConsent({ phone, scope: "marketing", action: "opt_in", source: "phone", method: "keypad", wording: "test" } as never)).rejects.toThrow(/replied STOP/);
    const rows = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, phone));
    expect(rows).toHaveLength(0);
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 2026 (Admin and Bookkeeping): A4 a refund gives back its share of sales tax; A7 two refunds at
   once can never refund more than was paid; A14 a Sola void never takes back more than is still not refunded. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/sola-phonepay", async (orig) => ({ ...(await orig<typeof import("@/lib/sola-phonepay")>()), solaVoid: async () => ({ ok: true, error: null }) }));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: false }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { refundOrder, refundTaxShare } from "@/lib/refunds";

const mkOrder = async (ref: string) =>
  (
    await db
      .insert(schema.orders)
      .values({ status: "CONFIRMED", channel: "POS", eventDate: "2026-12-20", pickupDate: "2026-12-21", subtotalCents: 10000, deliveryFeeCents: 2000, taxCents: 975, totalCents: 12975, paidCents: 12975, paymentMethod: "sola", solaRefNum: ref, cardLast4: "1111", paymentResult: "approved", paymentResultAt: new Date() })
      .returning()
  )[0].id;
let n = 1000;
const solaOk = (delayMs = 0) => (async () => (await new Promise((r) => setTimeout(r, delayMs)), new Response(JSON.stringify({ xResult: "A", xRefNum: String(n++) })))) as unknown as typeof fetch;

beforeAll(() => {
  process.env.SOLA_API_KEY = "sola_sandbox_key";
  process.env.SOLA_REFUND_MODE = "sandbox";
});

describe("deep check A4: refunds give back their sales tax", () => {
  it("a half refund books half the tax as tax given back; the full rest never more than the order's tax", async () => {
    const id = await mkOrder("A4-1");
    expect(await refundTaxShare(id, 12975)).toBe(975);
    await refundOrder(id, 6488, 1, solaOk());
    await refundOrder(id, "full", 1, solaOk());
    const rows = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, id));
    const refunds = rows.filter((r) => r.kind === "refund");
    expect(refunds.map((r) => r.taxCents)).toEqual([488, 487]);
    expect(refunds.reduce((s, r) => s + r.taxCents, 0)).toBe(975);
  });
});

describe("deep check A7: two refunds at once", () => {
  it("only one full refund goes through; the other is refused, nothing refunded twice", async () => {
    const id = await mkOrder("A7-1");
    const results = await Promise.allSettled([refundOrder(id, "full", 1, solaOk(30)), refundOrder(id, "full", 1, solaOk(30))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    expect(o.refundedCents).toBe(12975);
    const rows = await db.select().from(schema.orderRefunds).where(eq(schema.orderRefunds.orderId, id));
    expect(rows.map((r) => r.status)).toEqual(["succeeded"]);
  });
});

describe("deep check A14: a Sola void after a refund", () => {
  it("takes back only what is still not refunded", async () => {
    const [x] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-03-10", pickupDate: "2027-03-11", subtotalCents: 10000, deliveryFeeCents: 2000, taxCents: 975, totalCents: 12975, cardLast4: "1111" }).returning();
    const id = x.id;
    const { markPaid } = await import("@/lib/orders");
    await markPaid(id, 12975, "sola", "77701");
    await refundOrder(id, 2975, 1, solaOk());
    const { POST } = await import("@/app/api/admin/sola/void/route");
    process.env.SOLA_BRIDGE_API_KEY = "k".repeat(30);
    const r = await POST(new Request("https://x/api/admin/sola/void", { method: "POST", headers: { "x-admin-api-key": "k".repeat(30), "content-type": "application/json" }, body: JSON.stringify({ ref: "77701" }) }));
    expect(r.status).toBe(200);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    expect(o.refundedCents).toBe(12975);
  });
});

describe("deep check 15a: refunded at the card company, then the save fails", () => {
  it("never says nothing was refunded; the row keeps the refund id; a second refund is not allowed by mistake", async () => {
    const id = await mkOrder("15A-1");
    const { vi: v } = await import("vitest");
    const real = db.update.bind(db);
    let fail = true;
    const spy = v.spyOn(db, "update").mockImplementation(((t: unknown) => {
      if (t === schema.orders && fail) {
        fail = false;
        throw new Error("database went away");
      }
      return real(t as never);
    }) as never);
    await expect(refundOrder(id, 1000, 1, solaOk())).rejects.toThrow(/went through/);
    spy.mockRestore();
    const rows = await db.select().from(schema.orderRefunds).where(eq(schema.orderRefunds.orderId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].stripeRefundId).toMatch(/^sola:/);
    expect(rows[0].error).toMatch(/not fully saved/);
    await expect(refundOrder(id, 12975, 1, solaOk())).rejects.toThrow(/At most \$119\.75/);
  });
});

describe("deep check 0600 M33, M34, M37 (refunds)", () => {
  it("M33: no answer from Sola: kept as 'unknown' (still counted), never 'nothing refunded'", async () => {
    const id = await mkOrder("M33-1");
    const timeout = (async () => { throw new Error("The operation was aborted due to timeout"); }) as unknown as typeof fetch;
    await expect(refundOrder(id, 1000, 1, timeout)).rejects.toThrow(/may have gone through/);
    const rows = await db.select().from(schema.orderRefunds).where(eq(schema.orderRefunds.orderId, id));
    expect(rows.map((r) => r.status)).toEqual(["unknown"]);
    // the unknown 10.00 still counts: at most 119.75 is left
    await expect(refundOrder(id, 12975, 1, solaOk())).rejects.toThrow(/At most \$119\.75/);
  });
  it("M34: giving back an overpayment is its own entry and lowers neither taxable sales nor tax", async () => {
    const [x] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-04-10", pickupDate: "2027-04-11", subtotalCents: 10000, deliveryFeeCents: 2000, taxCents: 975, totalCents: 12975, cardLast4: "1111" }).returning();
    const { markPaid } = await import("@/lib/orders");
    await markPaid(x.id, 12975, "sola", "88801");
    await markPaid(x.id, 5000, "sola", "88802"); // a second charge: overpayment
    await db.update(schema.orders).set({ solaRefNum: "88802" }).where(eq(schema.orders.id, x.id));
    await refundOrder(x.id, 5000, 1, solaOk());
    const refunds = (await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, x.id))).filter((e) => e.kind === "refund");
    expect(refunds.map((e) => [e.category, e.amountCents, e.taxCents])).toEqual([["Overpayment (refund due)", 5000, 0]]);
  });
  it("M37: the Sola sandbox setting is ignored on the live site", async () => {
    const { refundsSandbox } = await import("@/lib/refunds");
    expect(refundsSandbox("sola", { SOLA_REFUND_MODE: "sandbox" })).toBe(true);
    expect(refundsSandbox("sola", { SOLA_REFUND_MODE: "sandbox", VERCEL_ENV: "production" })).toBe(false);
  });
});

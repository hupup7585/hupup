import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 6:00 AM, M10: a card try whose result Sola could not report (check_failed) may still have been
   charged; the next try of the same order looks at that time too, so the charge is found and never left unseen. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { checkPhonePayTry } from "@/lib/sola-phonepay";

const eastern = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" });

describe("deep check 06:00 M10", () => {
  it("try 1 could not be checked but was charged; try 2 finds that charge (paid once), nothing charged again unseen", async () => {
    process.env.SOLA_API_KEY = "test";
    const now = Date.now();
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-02-10", pickupDate: "2027-02-11", subtotalCents: 50000, totalCents: 50000, holdExpiresAt: new Date(now + 600_000) }).returning();
    await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAm10", tryNumber: 1, amountCents: 50000, startedAt: new Date(now - 5 * 60_000), result: "check_failed" });
    const [t2] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAm10", tryNumber: 2, amountCents: 50000, startedAt: new Date(now - 60_000) }).returning();
    const sola = [{ xRefNum: "M10A", xAmount: "500.00", xEnteredDate: eastern(new Date(now - 4 * 60_000)) }];
    const fetcher = (async () => new Response(JSON.stringify({ xResult: "S", xReportData: sola }))) as unknown as typeof fetch;
    const r = await checkPhonePayTry(o.id, t2.id, 50000, { fetcher, waitMs: 0 });
    expect(r.result).toBe("paid");
    const { eq } = await import("drizzle-orm");
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.paidCents).toBe(50000);
  });
  it("extra check Pay1: try 1 not checked but charged, try 2 charged again (unclear), try 3 charged: try 3 is paid, the unclear charges are voided", async () => {
    process.env.SOLA_API_KEY = "test";
    const { eq } = await import("drizzle-orm");
    const now = Date.now();
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-02-17", pickupDate: "2027-02-18", subtotalCents: 45000, totalCents: 45000, holdExpiresAt: new Date(now + 600_000) }).returning();
    await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CApay1", tryNumber: 1, amountCents: 45000, startedAt: new Date(now - 9 * 60_000), result: "check_failed" });
    const [t2] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CApay1", tryNumber: 2, amountCents: 45000, startedAt: new Date(now - 6 * 60_000) }).returning();
    const sola = [
      { xRefNum: "P1A", xAmount: "450.00", xEnteredDate: eastern(new Date(now - 8 * 60_000)) },
      { xRefNum: "P1B", xAmount: "450.00", xEnteredDate: eastern(new Date(now - 5 * 60_000)) },
    ];
    const voided: string[] = [];
    const fetcher = (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.xCommand === "cc:void" || body.xCommand === "cc:voidrefund") return voided.push(String(body.xRefNum)), new Response(JSON.stringify({ xResult: "A" }));
      return new Response(JSON.stringify({ xResult: "S", xReportData: sola }));
    }) as unknown as typeof fetch;
    expect((await checkPhonePayTry(o.id, t2.id, 45000, { fetcher, waitMs: 0 })).result).toBe("unclear");
    // try 3: its own charge only
    const [t3] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CApay1", tryNumber: 3, amountCents: 45000, startedAt: new Date(now - 2 * 60_000) }).returning();
    sola.push({ xRefNum: "P1C", xAmount: "450.00", xEnteredDate: eastern(new Date(now - 60_000)) });
    expect((await checkPhonePayTry(o.id, t3.id, 45000, { fetcher, waitMs: 0 })).result).toBe("paid");
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.paidCents).toBe(45000);
    const [first] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.tryNumber, 1));
    expect(first.result).toBe("check_failed_seen");
    expect(voided.sort()).toEqual(["P1A", "P1B"]); // the two charges try 2 could not tell apart are voided; P1C is the payment
  });
});


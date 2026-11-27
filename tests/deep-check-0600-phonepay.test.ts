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
});

import { describe, expect, it, vi } from "vitest";

/* Owner custom charge with no order number (Abraham, Nov 14, 2026): a new order is made, details left empty, marked
   as made on the hotline by the Owner or the Secretary and from which phone. In-memory database; Sola is mocked. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { customChargeMadeBy, matchCustomCharge, startAttempt } from "@/lib/sola-phonepay";

const solaReturns = (amount: string, ref: string) =>
  (async () =>
    new Response(
      JSON.stringify({
        xResult: "S",
        xReportData: [{ xRefNum: ref, xAmount: amount, xEnteredDate: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }), xMaskedCardNumber: "4xxxxxxxxxxx1111", xCardType: "Visa" }],
      }),
    )) as unknown as typeof fetch;

describe("custom charge without an order number", () => {
  it("who made it: the Owner, a Secretary by name, with the phone used", async () => {
    await db.insert(schema.adminUsers).values({ name: "Sara", role: "secretary", phone: "+18455550301", active: true });
    expect(await customChargeMadeBy("+18457777585", { ADMIN_PHONE: "+18457777585" })).toBe("the Owner from (845) 777-7585");
    expect(await customChargeMadeBy("+18455550301", { ADMIN_PHONE: "+18457777585" })).toBe("the Secretary Sara from (845) 555-0301");
  });

  it("a found payment makes a new phone order with only the amount filled in and the note", async () => {
    process.env.SOLA_API_KEY = "test-key";
    const a = await startAttempt(null, "CAowner1", 12500, "custom");
    const r = await matchCustomCharge(a.id, 12500, null, { fetcher: solaReturns("125.00", "R-555"), waitMs: 0, madeBy: "the Owner from (845) 777-7585" });
    expect(r.found).toBe(true);
    expect(r.orderId).toBeTruthy();
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId!));
    expect(o.channel).toBe("PHONE");
    expect(o.customerId).toBeNull();
    expect(o.totalCents).toBe(12500);
    expect(o.notes).toBe("Custom charge made on the hotline by the Owner from (845) 777-7585. Fill in the customer and rental details.");
    const [att] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, a.id));
    expect(att.orderId).toBe(r.orderId);
    expect(att.solaRef).toBe("R-555");
  });

  it("no payment found: no order is made", async () => {
    const before = (await db.select().from(schema.orders)).length;
    const a = await startAttempt(null, "CAowner2", 9900, "custom");
    const r = await matchCustomCharge(a.id, 9900, null, { fetcher: solaReturns("50.00", "R-556"), waitMs: 0 });
    expect(r.found).toBe(false);
    expect((await db.select().from(schema.orders)).length).toBe(before);
  });
});

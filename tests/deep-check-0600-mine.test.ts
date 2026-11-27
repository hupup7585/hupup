import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 06:00 list, phone/payment items: M16, M20, M27 (and the M49 rule). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";

describe("M16: 4th Sunday free counts only booked and paid Sundays", () => {
  it("three earlier Sundays still waiting for payment do not make the 4th free; paid ones do", async () => {
    const { fourthSundayDiscount } = await import("@/lib/offers");
    const [c] = await db.insert(schema.customers).values({ name: "M16", phone: "+18455550601" }).returning();
    const [cat] = await db.insert(schema.categories).values({ name: "Bounce", sortOrder: 1 }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 20000, quantity: 5 }).returning();
    const sundays = ["2027-01-03", "2027-01-10", "2027-01-17"];
    const ids: number[] = [];
    for (const d of sundays) {
      const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: c.id, eventDate: d, pickupDate: d }).returning();
      await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
      ids.push(o.id);
    }
    const [fourth] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", customerId: c.id, eventDate: "2027-01-24", pickupDate: "2027-01-25" }).returning();
    const lines = [{ id: 1, orderId: fourth.id, productId: p.id, qty: 1, unitPriceCents: 20000, category: "Bounce" }] as never;
    expect(await fourthSundayDiscount(db, { id: fourth.id, customerId: c.id, eventDate: "2027-01-24" }, lines)).toBe(0);
    for (const id of ids) await db.update(schema.orders).set({ status: "CONFIRMED" }).where(eq(schema.orders.id, id));
    expect(await fourthSundayDiscount(db, { id: fourth.id, customerId: c.id, eventDate: "2027-01-24" }, lines)).toBeGreaterThan(0);
  });
});

describe("M20: voicemail box password, a burst of guesses", () => {
  it("only 3 guesses are ever compared before the lock, even the right one inside a burst", async () => {
    const { checkBoxPin } = await import("@/lib/vm-boxes");
    const [box] = await db.insert(schema.voicemailBoxes).values({ name: "M20 box", boxNumber: "620" }).returning();
    const results = await Promise.all(["1111", "2222", "3333", "1234", "1234"].map((pin) => checkBoxPin(box, pin)));
    expect(results.filter((r) => r === "ok").length).toBeLessThanOrEqual(1);
    expect(results.filter((r) => r !== "locked").length).toBeLessThanOrEqual(3);
    // after the burst the box is locked: the right password is refused too
    expect(await checkBoxPin(box, "1234")).toBe("locked");
  });
});

describe("M27: STOP on another record with the same number blocks an opt-in", () => {
  it("a second customer record that replied STOP blocks the sign-up", async () => {
    const consent = await import("@/lib/sms-consent");
    await db.insert(schema.customers).values({ name: "First", phone: "+18455550627" });
    await db.insert(schema.customers).values({ name: "Second", phone: "+18455550627", smsOptOut: true });
    await expect(consent.recordConsent({ phone: "+18455550627", scope: "marketing", action: "opt_in", source: "web", method: "checkbox", wording: "W", wordingVersion: "v1" })).rejects.toThrow(/STOP/);
  });
});

describe("M49 and M26 (code rules)", () => {
  it("the customer discount is worked out on the rentals only; the paid notice is claimed once per payment", () => {
    expect(readFileSync("src/lib/offers.ts", "utf8")).toContain("discountCents(cd, full.filter(isRental)");
    const hook = readFileSync("src/app/api/sola/webhook/route.ts", "utf8");
    expect(hook).toContain("paidNoticeRef: key");
    expect(hook).toMatch(/if \(claimed\) await paymentReceivedNotices/);
  });
});

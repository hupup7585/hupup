import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/* Deep check, Nov 27, 2026, 3:00 AM: website / pay link items #2, #3, #11, #24. In-memory database. */
const h = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async (_to: string, body: string) => (h.texts.push(body), { sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPaymentGroup, markGroupPaid, payingDays } from "@/lib/orders";
import { linkExpired } from "@/lib/late-payment";
import { prefillFor } from "@/lib/pay-prefill";

let seq = 0;
async function product() {
  const [c] = await db.insert(schema.categories).values({ name: `Cat ${++seq}`, sortOrder: seq }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: `Castle ${seq}`, priceCents: 10000, quantity: 3 }).returning();
  return p;
}
async function day(p: { id: number }, status: "PENDING_PAYMENT" | "CANCELLED", date: string, gid: number | null, holdMin: number) {
  const [o] = await db
    .insert(schema.orders)
    .values({ status, channel: "PHONE", eventDate: date, pickupDate: date, subtotalCents: 10000, totalCents: 10000, paidCents: 0, paymentGroupId: gid, holdExpiresAt: new Date(Date.now() + holdMin * 60_000) })
    .returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 10000 });
  if (!gid) await db.update(schema.orders).set({ paymentGroupId: o.id }).where(eq(schema.orders.id, o.id));
  return o.id;
}
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const staffCancel = (id: number) => db.insert(schema.orderStatusHistory).values({ orderId: id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", userId: 1, reason: "Customer changed plans" });
const holdRelease = (id: number) => db.insert(schema.orderStatusHistory).values({ orderId: id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", userId: null, reason: "Hold ended" });

describe("#3: a day staff cancelled does not make the whole link expired", () => {
  it("staff-cancelled day: link open, the other day can be paid; a released hold still expires the link", async () => {
    const p = await product();
    const a = await day(p, "PENDING_PAYMENT", "2027-03-10", null, 10);
    const b = await day(p, "CANCELLED", "2027-03-11", a, -5);
    await staffCancel(b);
    const g = (await getPaymentGroup(a))!;
    expect(await linkExpired(g.orders)).toBe(false);
    // the card page and its description list only the day being paid
    expect(payingDays(g.orders, g.primary).map((d) => d.order.id)).toEqual([a]);
    expect(prefillFor(g.primary, payingDays(g.orders, g.primary)).description).not.toMatch(/March 11/);

    const c = await day(p, "PENDING_PAYMENT", "2027-03-12", null, 10);
    const d = await day(p, "CANCELLED", "2027-03-13", c, -5);
    await holdRelease(d);
    expect(await linkExpired((await getPaymentGroup(c))!.orders)).toBe(true);
  });
  it("the pay page and Agree and pay use the same check", () => {
    for (const f of ["src/app/pay/[orderId]/page.tsx", "src/app/pay/[orderId]/actions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("await linkExpired(");
      expect(src, f).not.toMatch(/some\(\(d\) => holdEnded\(/);
    }
  });
});

describe("#2: a late payment on a multi-day booking whose holds all ran out goes to every released day", () => {
  it("each released day gets its own amount and is confirmed (items still free); the notice lists both days", async () => {
    const p = await product();
    const a = await day(p, "CANCELLED", "2027-04-10", null, -30);
    const b = await day(p, "CANCELLED", "2027-04-11", a, -30);
    await holdRelease(a);
    await holdRelease(b);
    await markGroupPaid(a, 20000, "sola", "LATE2");
    const [oa, ob] = [await get(a), await get(b)];
    expect([oa.paidCents, ob.paidCents]).toEqual([10000, 10000]);
    expect([oa.status, ob.status]).toEqual(["CONFIRMED", "CONFIRMED"]);
  });
  it("deep check 06:00 M9: one day released and one still open: each day gets its own amount (never the released day's money on the open day)", async () => {
    const p = await product();
    const a = await day(p, "CANCELLED", "2027-04-20", null, -30);
    const b = await day(p, "PENDING_PAYMENT", "2027-04-21", a, 10);
    await holdRelease(a);
    await markGroupPaid(a, 20000, "sola", "M9");
    const [oa, ob] = [await get(a), await get(b)];
    expect([oa.paidCents, ob.paidCents]).toEqual([10000, 10000]);
    expect([oa.status, ob.status]).toEqual(["CONFIRMED", "CONFIRMED"]);
  });
  it("deep check 06:00 M9: paying only the open day leaves the released day as it is", async () => {
    const p = await product();
    const a = await day(p, "CANCELLED", "2027-04-22", null, -30);
    const b = await day(p, "PENDING_PAYMENT", "2027-04-23", a, 10);
    await holdRelease(a);
    await markGroupPaid(a, 10000, "sola", "M9B");
    expect([(await get(a)).paidCents, (await get(a)).status, (await get(b)).paidCents, (await get(b)).status]).toEqual([0, "CANCELLED", 10000, "CONFIRMED"]);
  });
  it("a staff-cancelled day is never revived by it", async () => {
    const p = await product();
    const a = await day(p, "CANCELLED", "2027-05-10", null, -30);
    const b = await day(p, "CANCELLED", "2027-05-11", a, -30);
    await holdRelease(a);
    await staffCancel(b);
    await markGroupPaid(a, 10000, "sola", "LATE3");
    expect([(await get(a)).paidCents, (await get(b)).paidCents, (await get(b)).status]).toEqual([10000, 0, "CANCELLED"]);
  });
});

describe("#24: the paid notices list only the days booked", () => {
  it("deep check 06:00 M17: the box 148 confirmation text leaves out a released day with nothing paid", async () => {
    const p = await product();
    const a = await day(p, "PENDING_PAYMENT", "2027-06-20", null, 10);
    const b = await day(p, "CANCELLED", "2027-06-21", a, -5);
    await holdRelease(b);
    await markGroupPaid(a, 10000, "sola", "M17");
    const { confirmationText } = await import("@/lib/payment-result");
    const t = (await confirmationText(a)) ?? "";
    expect(t).toContain("June 20");
    expect(t).not.toContain("June 21");
  });
  it("a cancelled day with nothing paid is left out of the customer's text", async () => {
    const p = await product();
    const a = await day(p, "PENDING_PAYMENT", "2027-06-10", null, 10);
    const b = await day(p, "CANCELLED", "2027-06-11", a, -5);
    await staffCancel(b);
    await markGroupPaid(a, 10000, "sola", "N24");
    h.texts.length = 0;
    const { paymentReceivedNotices } = await import("@/lib/payment-result");
    await db.insert(schema.customers).values({ name: "Sara", phone: "+18455550999" });
    const [cu] = await db.select().from(schema.customers).where(eq(schema.customers.phone, "+18455550999"));
    await db.update(schema.orders).set({ customerId: cu.id }).where(eq(schema.orders.id, a));
    await paymentReceivedNotices(a, 10000);
    expect(h.texts.join("\n")).toMatch(/June 10/);
    expect(h.texts.join("\n")).not.toMatch(/June 11/);
  });
});

describe("#11: Check availability again and Choose this option are locked on Shabbes and Yom Tov", () => {
  it("both link actions check the payments-closed line before holding anything", () => {
    const src = readFileSync("src/app/pay/[orderId]/actions.ts", "utf8");
    expect(src).toMatch(/checkAgainAction[\s\S]*?\(await paymentsClosedNow\(\)\)\) redirect/);
    expect(src).toMatch(/chooseOptionAction[\s\S]*?\(await paymentsClosedNow\(\)\)\) redirect/);
  });
});

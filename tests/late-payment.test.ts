import { beforeEach, describe, expect, it, vi } from "vitest";

/* Late payment backup (Abraham, Nov 13, 2026: "build it as planned"). */

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
import { markPaid } from "@/lib/orders";
import { LATE_EMAIL, LATE_EMAIL_APPROVED, confirmAttentionOrder } from "@/lib/late-payment";

const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
let product: number;
let customer: number;
beforeEach(async () => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  h.emails = [];
  if (!product) {
    const [c] = await db.insert(schema.categories).values({ name: "Late cat", sortOrder: 1 }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 1 }).returning();
    const [cu] = await db.insert(schema.customers).values({ name: "Sara", phone: "+18455550444", email: "sara@example.com" }).returning();
    product = p.id;
    customer = cu.id;
  }
});
const order = async (status: string, day: string, holdMin: number | null) => {
  const [o] = await db
    .insert(schema.orders)
    .values({ status: status as "PENDING_PAYMENT", channel: "PHONE", eventDate: day, pickupDate: day.replace(/-(\d\d)$/, (_, d) => `-${String(Number(d) + 1).padStart(2, "0")}`), customerId: customer, holdExpiresAt: holdMin === null ? null : new Date(Date.now() + holdMin * 60_000), subtotalCents: 20000, totalCents: 21625 })
    .returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: product, qty: 1, unitPriceCents: 20000 });
  return o.id;
};

describe("late payment backup", () => {
  it("on time: confirmed, no late-payment email", async () => {
    const id = await order("PENDING_PAYMENT", "2027-01-05", 5);
    await markPaid(id, 21625, "sola", "R1");
    expect((await get(id)).status).toBe("CONFIRMED");
    expect(h.emails.filter((e) => /late payment/.test(e.subject))).toHaveLength(0);
  });
  it("after the hold ended, items still free: confirms by itself and emails the Owner", async () => {
    const id = await order("CANCELLED", "2027-01-12", null);
    await markPaid(id, 21625, "sola", "R2");
    expect((await get(id)).status).toBe("CONFIRMED");
    expect(h.emails.map((e) => [e.to, e.subject])).toContainEqual(["owner@example.com", `Hup Up Attractions: late payment on order #${1000 + id} (confirmed)`]);
    expect(h.emails.some((e) => e.to === "sara@example.com" && /please call us/.test(e.subject))).toBe(false);
  });
  it("after the hold ended, items taken: Needs staff attention, never confirmed; Owner and customer emailed; staff confirm only once free", async () => {
    const moshe = await order("CONFIRMED", "2027-01-19", null);
    const sara = await order("PENDING_PAYMENT", "2027-01-19", -3); // hold ended 3 minutes ago
    await markPaid(sara, 21625, "sola", "R3");
    const o = await get(sara);
    expect(o.status).toBe("NEEDS_ATTENTION");
    expect(o.paidCents).toBe(21625); // the money is recorded
    expect(h.emails.map((e) => e.subject)).toContain(`Hup Up Attractions: late payment on order #${1000 + sara} needs staff attention`);
    const toSara = h.emails.find((e) => e.to === "sara@example.com")!;
    expect(LATE_EMAIL_APPROVED).toBe(true);
    expect(toSara.text).toBe(LATE_EMAIL.body(String(1000 + sara)));
    expect(toSara.text).toContain("and we will take care of it. If it is not available anymore, we will give you another option to book.");
    expect(toSara.text).not.toMatch(/\w'(ll|re|ve|d|t)\b/); // every word spelled out
    // staff can't confirm while Moshe has the Castle
    expect(await confirmAttentionOrder(sara)).toBe(false);
    expect((await get(sara)).status).toBe("NEEDS_ATTENTION");
    // Moshe cancels: now staff can confirm Sara
    await db.update(schema.orders).set({ status: "CANCELLED" }).where(eq(schema.orders.id, moshe));
    expect(await confirmAttentionOrder(sara)).toBe(true);
    expect((await get(sara)).status).toBe("CONFIRMED");
  });
  it("a Needs staff attention order keeps its claim, so no one else can book that Castle meanwhile", async () => {
    const { checkBookable } = await import("@/lib/availability");
    await order("CONFIRMED", "2027-01-26", null);
    const sara = await order("CANCELLED", "2027-01-26", null);
    await markPaid(sara, 21625, "sola", "R4");
    expect((await get(sara)).status).toBe("NEEDS_ATTENTION");
    expect(await checkBookable(product, 1, "2027-01-26", db, "2027-01-27")).toBe(0);
  });
});

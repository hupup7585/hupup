import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ texts: [] as string[], emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async (_t: string, s: string) => (h.emails.push(s), { sent: true }), sendSms: async (_to: string, body: string) => (h.texts.push(body), { sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { POST } from "@/app/api/sola/webhook/route";

const sign = (f: Record<string, string>, pin: string) =>
  createHash("md5").update(Object.entries(f).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v).join("") + pin, "utf8").digest("hex");

describe("Hark's payment check, Nov 27, bug 3: a multi-day booking paid short", () => {
  it("day 2 gets nothing, stays waiting (its hold will run out), no Owner alert, and the customer is told both days are paid", async () => {
    process.env.SOLA_WEBHOOK_PIN = "pin";
    process.env.ADMIN_EMAIL = "owner@example.com";
    process.env.ADMIN_PHONE = "+18457777585";
    const [c] = await db.insert(schema.categories).values({ name: "Cat", sortOrder: 1 }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 10000, quantity: 3 }).returning();
    const [cu] = await db.insert(schema.customers).values({ name: "Test", phone: "+18455550123" }).returning();
    const mk = async (date: string, gid: number | null) => {
      const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: cu.id, eventDate: date, pickupDate: date, subtotalCents: 10000, totalCents: 10000, paymentGroupId: gid, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
      await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 10000 });
      if (!gid) await db.update(schema.orders).set({ paymentGroupId: o.id }).where(eq(schema.orders.id, o.id));
      return o.id;
    };
    const a = await mk("2027-04-06", null);
    const b = await mk("2027-04-07", a);
    // Sola approved $100.00 on invoice HU-<a> (the amount on the hosted page is a URL parameter; a stale or edited amount)
    const f = { xCommand: "cc:sale", xResponseResult: "Approved", xResult: "A", xStatus: "Approved", xInvoice: `HU-${1000 + a}`, xAmount: "100.00", xAuthAmount: "100.00", xRefNum: "SHORT1", xMaskedCardNumber: "4xxxxxxxxxxx1111" };
    const res = await POST(new Request("https://x/api/sola/webhook", { method: "POST", headers: { "ck-signature": sign(f, "pin") }, body: new URLSearchParams(f).toString() }));
    const A = (await db.select().from(schema.orders).where(eq(schema.orders.id, a)))[0];
    const B = (await db.select().from(schema.orders).where(eq(schema.orders.id, b)))[0];
    console.log({ http: res.status, dayA: [A.status, A.paidCents, A.paymentResult], dayB: [B.status, B.paidCents, B.paymentResult], texts: h.texts, emails: h.emails });
    // Correct: the shortfall is not silent: day B needs attention (or the Owner is alerted), and no "all paid" text
    expect([A.status, A.paidCents, A.paymentResult]).toEqual(["CONFIRMED", 10000, "approved"]);
    expect([B.status, B.paidCents]).toEqual(["NEEDS_ATTENTION", 0]);
    expect(B.paymentResult).not.toBe("approved");
    expect(h.emails.some((e) => /paid less than the total/.test(e))).toBe(true);
    expect(h.texts.some((t) => /all set/i.test(t))).toBe(false);
  });
});

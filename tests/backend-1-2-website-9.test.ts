import { describe, expect, it, vi } from "vitest";

/* Hark's lists (Nov 26, 2026): backend 1 (two payment callbacks at once never lose or double a payment), backend 2
   (money on an already-paid order: kept, noted, Owner emailed, booking unchanged), website 9 (a group payment goes to
   the days still waiting, never to a cancelled day). */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async (to: string, subject: string) => (h.emails.push({ to, subject }), { sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markGroupPaid, markPaid } from "@/lib/orders";

const mk = async (status: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED", total: number, paid = 0, gid?: number) => {
  const [o] = await db.insert(schema.orders).values({ status, channel: "PHONE", eventDate: "2027-02-10", pickupDate: "2027-02-11", subtotalCents: total, totalCents: total, paidCents: paid, paymentGroupId: gid ?? null, holdExpiresAt: status === "PENDING_PAYMENT" ? new Date(Date.now() + 600_000) : null }).returning();
  return o.id;
};
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("payments", () => {
  it("backend 1: two different payments at the same moment are both counted; the same reference twice counts once", async () => {
    process.env.ADMIN_EMAIL = "owner@example.com";
    const id = await mk("PENDING_PAYMENT", 20000);
    await Promise.all([markPaid(id, 10000, "sola", "R1"), markPaid(id, 10000, "sola", "R2")]);
    expect((await get(id)).paidCents).toBe(20000);
    await Promise.all([markPaid(id, 5000, "sola", "R3"), markPaid(id, 5000, "sola", "R3")]);
    expect((await get(id)).paidCents).toBe(25000);
  });
  it("backend 2: a second payment on a paid order is kept and noted, the Owner is emailed, the booking is unchanged", async () => {
    h.emails.length = 0;
    const id = await mk("CONFIRMED", 15000, 15000);
    const r = await markPaid(id, 15000, "sola", "R9");
    const o = await get(id);
    expect([o.status, o.paidCents]).toEqual(["CONFIRMED", 30000]);
    expect(o.notes).toMatch(/already paid in full: refund it/);
    expect((r as { overpaid?: boolean }).overpaid).toBe(true);
    expect(h.emails.some((e) => /already paid/.test(e.subject))).toBe(true);
  });
  it("website 9: a group payment skips a cancelled day", async () => {
    const a = await mk("PENDING_PAYMENT", 10000);
    await db.update(schema.orders).set({ paymentGroupId: a }).where(eq(schema.orders.id, a));
    const b = await mk("CANCELLED", 10000, 0, a);
    const c = await mk("PENDING_PAYMENT", 10000, 0, a);
    await markGroupPaid(a, 20000, "sola", "RG");
    expect([(await get(a)).paidCents, (await get(b)).paidCents, (await get(c)).paidCents]).toEqual([10000, 0, 10000]);
  });
});

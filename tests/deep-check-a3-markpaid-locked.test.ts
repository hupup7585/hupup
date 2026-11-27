import { describe, expect, it, vi } from "vitest";

/* Deep check A3 / item 7 (Nov 27, 2026): markPaid decides the status and writes the notes inside its lock, from the
   row after the lock, and only ever adds to the notes. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markPaid } from "@/lib/orders";

const mk = async (total: number, notes: string | null = null) => {
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-02-10", pickupDate: "2027-02-11", subtotalCents: total, totalCents: total, notes, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
  return o.id;
};
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("markPaid under two payments at once", () => {
  it("two halves at the same moment: the order ends CONFIRMED and fully paid, never stuck in Needs attention", async () => {
    const id = await mk(20000);
    await Promise.all([markPaid(id, 10000, "sola", "H1"), markPaid(id, 10000, "sola", "H2")]);
    const o = await get(id);
    expect(o.paidCents).toBe(20000);
    expect(o.status).toBe("CONFIRMED");
  });
  it("notes are only added to: a staff note written before the payment is never erased", async () => {
    const id = await mk(20000, "Gate code 1234. ");
    await markPaid(id, 5000, "sola", "N1");
    await db.update(schema.orders).set({ notes: `${(await get(id)).notes}Call before delivery. ` }).where(eq(schema.orders.id, id));
    await markPaid(id, 15000, "sola", "N2");
    const o = await get(id);
    expect(o.notes).toContain("Gate code 1234.");
    expect(o.notes).toContain("Call before delivery.");
    expect(o.notes).toContain("Paid $50.00 of $200.00.");
    expect(o.paidCents).toBe(20000);
  });
  it("a short payment alone: Needs attention with 'Paid $X of $Y'", async () => {
    const id = await mk(20000);
    await markPaid(id, 5000, "sola", "S1");
    const o = await get(id);
    expect(o.status).toBe("NEEDS_ATTENTION");
    expect(o.notes).toMatch(/Paid \$50\.00 of \$200\.00\. $/);
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";

/* Code audit Nov 24: M1 (a payment never brings back an order staff cancelled) and M6 (Record payment: paid-in-full
 * rule, fixed list of methods, audit row). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: 7, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const mails: string[] = [];
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async (_to: string, subject: string) => { mails.push(subject); return { sent: true }; } }));
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || "owner@example.com";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markPaid, reserveItem } from "@/lib/orders";
import { recordPaymentAction, updateStatusAction } from "@/app/admin/(app)/orders/actions";

let pid = 0;
beforeAll(async () => {
  const c = (await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning())[0].id;
  pid = (await db.insert(schema.products).values({ categoryId: c, name: "Castle Bouncer", priceCents: 12000, quantity: 3, active: true }).returning())[0].id;
});
let day = 10;
const order = async (status: "HOLD" | "PENDING_PAYMENT") => {
  const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: `2027-01-${String(day++).padStart(2, "0")}`, channel: "POS", status, holdExpiresAt: new Date(Date.now() + 600_000) });
  if (!r.ok) throw new Error("no hold");
  await db.update(schema.orders).set({ totalCents: 23247 }).where(eq(schema.orders.id, r.orderId));
  return r.orderId;
};
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("M1: payment on an order staff cancelled", () => {
  it("goes to Needs attention (not Confirmed) and the Owner is emailed", async () => {
    const id = await order("PENDING_PAYMENT");
    expect((await updateStatusAction(id, "CANCELLED", "Customer called to cancel")).ok).toBe(true);
    mails.length = 0;
    await markPaid(id, 23247, "sola", "REF-M1");
    expect((await get(id)).status).toBe("NEEDS_ATTENTION");
    expect(mails.some((m) => /payment received on cancelled order/.test(m))).toBe(true);
  });
  it("an ended hold still revives when its items are free", async () => {
    const id = await order("PENDING_PAYMENT");
    await db.update(schema.orders).set({ status: "CANCELLED" }).where(eq(schema.orders.id, id));
    await markPaid(id, 23247, "sola", "REF-M1b");
    expect((await get(id)).status).toBe("CONFIRMED");
  });
});

describe("M6: Record payment", () => {
  it("$10 on $232.47 is not Confirmed, $222.47 is still due, and an audit row has the staff id", async () => {
    const id = await order("PENDING_PAYMENT");
    expect((await recordPaymentAction(id, "10", "cash")).ok).toBe(true);
    const o = await get(id);
    expect(o.status).not.toBe("CONFIRMED");
    expect((o.totalCents ?? 0) - o.paidCents).toBe(22247);
    const [a] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "order.payment_recorded"), eq(schema.auditLog.entityId, String(id))));
    expect(a.userId).toBe(7);
    expect(a.after).toMatchObject({ cents: 1000, method: "cash" });
  });
  it("only the listed methods", async () => {
    const id = await order("PENDING_PAYMENT");
    expect((await recordPaymentAction(id, "10", "bitcoin")).ok).toBe(false);
  });
});

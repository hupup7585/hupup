import { describe, expect, it, vi } from "vitest";

/* Hark's Admin list 10 / backend 8 (Nov 26, 2026): a Sola void through the bridge is taken off its order like a
   refund (order refunded, Bookkeeping money out, audit); no order found: the Owner is emailed. */
const h = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/sola-phonepay", async (orig) => ({ ...(await orig<typeof import("@/lib/sola-phonepay")>()), solaVoid: async () => ({ ok: true, error: null }) }));
vi.mock("@/lib/notify", () => ({ sendEmail: async (_to: string, subject: string) => (h.emails.push(subject), { sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markPaid } from "@/lib/orders";
import { POST } from "@/app/api/admin/sola/void/route";

const KEY = "k".repeat(30);
const voidRef = (ref: string) => POST(new Request("https://x/api/admin/sola/void", { method: "POST", headers: { "x-admin-api-key": KEY, "content-type": "application/json" }, body: JSON.stringify({ ref }) }));

describe("Sola void through the bridge", () => {
  it("the order shows the money refunded and the books show the money out", async () => {
    process.env.SOLA_BRIDGE_API_KEY = KEY;
    process.env.ADMIN_EMAIL = "owner@example.com";
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-03-10", pickupDate: "2027-03-11", subtotalCents: 20000, totalCents: 20000 }).returning();
    await markPaid(o.id, 20000, "sola", "55501");
    const r = await voidRef("55501");
    expect((await r.json()).orders).toEqual([o.id]);
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.refundedCents).toBe(20000);
    const out = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, o.id));
    expect(out.some((e) => e.kind === "refund" && e.amountCents === 20000)).toBe(true);
    // the same void sent again changes nothing
    await voidRef("55501");
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, o.id)))[0].refundedCents).toBe(20000);
  });
  it("no order with that payment: the Owner is emailed", async () => {
    h.emails.length = 0;
    await voidRef("99999");
    expect(h.emails.some((s) => /99999 was voided, no order found/.test(s))).toBe(true);
  });
});

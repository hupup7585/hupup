import { beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check 0600 M70 (Nov 27, 2026): New booking cash when the order can't be priced: Needs attention first, so the
   payment never confirms the order against the items alone; the cash is still recorded. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: "owner" }), requireOwner: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendOrderText: async () => ({ texted: true, emailed: false, message: "" }) }));
vi.mock("@/lib/order-pricing", async (orig) => ({ ...(await orig<typeof import("@/lib/order-pricing")>()), ensurePriced: async () => false, pricingProblem: async () => "the map could not find the house", addressProblem: async () => null }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createBookingAction } from "@/app/admin/(app)/pos/actions";

let castle = 0;
beforeAll(async () => {
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  castle = (await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", priceCents: 18999, quantity: 5, active: true }).returning())[0].id;
});

describe("New booking cash on an order that can't be priced", () => {
  it("Needs attention, the cash recorded, never Confirmed", async () => {
    const r = await createBookingAction({ name: "Sara Klein", email: "", deliveryTime: "", notes: "", termsVia: "phone", date: "2026-12-15", items: { [castle]: 1 }, phone: "845-555-0177", address: "12 Forest Road, Monroe", payment: "cash", amountPaid: "189.99" });
    expect(r.ok).toBe(true);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId!));
    expect(o.status).toBe("NEEDS_ATTENTION");
    expect(o.paidCents).toBe(18999);
    expect(o.notes).toMatch(/could be priced/);
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, o.id));
    expect(history.some((h) => h.toStatus === "CONFIRMED")).toBe(false);
  });
});

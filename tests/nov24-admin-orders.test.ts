import { beforeAll, describe, expect, it, vi } from "vitest";

/* Admin Orders bugs 1, 2 and 7 (Nov 24, 2026). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { abandonedCartCount, listOrders } from "@/lib/admin-queries";

let mine = 0;
beforeAll(async () => {
  const [c] = await db.insert(schema.customers).values({ name: "Leah Schwarz", phone: "+18457990925" }).returning();
  mine = (await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", customerId: c.id, eventDate: "2026-12-07", pickupDate: "2026-12-08", subtotalCents: 30000 }).returning())[0].id;
  // two abandoned phone carts (cancelled, no customer)
  for (const d of ["2026-12-01", "2026-12-02"]) await db.insert(schema.orders).values({ status: "CANCELLED", channel: "PHONE", eventDate: d, pickupDate: d, subtotalCents: 0 });
});

describe("order search", () => {
  it("a plain 10-digit phone number no longer crashes the page, and finds the order", async () => {
    const r = await listOrders({ q: "8457990925", status: "ALL" });
    expect(r.map((x) => x.id)).toEqual([mine]);
  });
  it("the phone number with dashes, brackets or 7 digits finds it too", async () => {
    for (const q of ["845-799-0925", "(845) 799-0925", "7990925", "+1 845 799 0925"]) expect((await listOrders({ q, status: "ALL" })).map((x) => x.id), q).toEqual([mine]);
  });
  it("an order number still works", async () => {
    expect((await listOrders({ q: String(1000 + mine), status: "ALL" })).map((x) => x.id)).toContain(mine);
  });
  it("All leaves out abandoned phone carts and says how many", async () => {
    expect((await listOrders({ status: "ALL" })).map((x) => x.id)).toEqual([mine]);
    expect(await abandonedCartCount({})).toBe(2);
    expect((await listOrders({ status: "CANCELLED" })).length).toBe(2);
  });
});

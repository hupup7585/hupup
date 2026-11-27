import { describe, expect, it, vi } from "vitest";

/* Possible duplicate customers (Abraham, Nov 27, 2026, 2:14 AM): a list only; merge only when the Owner presses it. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { findDuplicateCustomers, mergeCustomers } from "@/lib/duplicate-customers";

describe("possible duplicate customers", () => {
  it("finds the same phone (any format) and the same name + address; shows orders, dates and STOP; suggests the record with most orders", async () => {
    const [a] = await db.insert(schema.customers).values({ name: "Sara Klein", phone: "+18455550201", address: "12 Forest Road, Monroe" }).returning();
    const [b] = await db.insert(schema.customers).values({ name: "S Klein", phone: "8455550201", email: "s@example.com", smsOptOut: true }).returning();
    const [c] = await db.insert(schema.customers).values({ name: "Klein Sara", phone: "+18455550299", address: "12 Forest Rd Monroe" }).returning();
    await db.insert(schema.customers).values({ name: "Someone Else", phone: "+18455550300" });
    for (const [cid, d] of [[a.id, "2026-10-01"], [a.id, "2026-11-05"], [c.id, "2026-09-01"]] as const)
      await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", customerId: cid, eventDate: d, pickupDate: d });
    const groups = await findDuplicateCustomers();
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.records.map((r) => r.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(g.why.sort()).toEqual(["same name and address", "same phone number"]);
    expect(g.keepId).toBe(a.id);
    expect(g.records.find((r) => r.id === a.id)).toMatchObject({ orders: 2, firstOrder: "2026-10-01", lastOrder: "2026-11-05" });
    expect(g.records.find((r) => r.id === b.id)?.smsOptOut).toBe(true);
    // a list only: nothing changed
    expect((await db.select().from(schema.customers).where(inArray(schema.customers.id, [a.id, b.id, c.id]))).every((x) => x.mergedIntoId === null)).toBe(true);
  });
  it("merge (only when pressed): orders move, nothing is deleted, a STOP on any record wins", async () => {
    const [g] = await findDuplicateCustomers();
    const ids = g.records.map((r) => r.id);
    const before = (await db.select().from(schema.orders)).length;
    await mergeCustomers(g.keepId, ids, null);
    const kept = (await db.select().from(schema.customers).where(eq(schema.customers.id, g.keepId)))[0];
    expect(kept.smsOptOut).toBe(true);
    expect(kept.email).toBe("s@example.com");
    expect((await db.select().from(schema.orders)).length).toBe(before);
    expect((await db.select().from(schema.orders).where(eq(schema.orders.customerId, g.keepId))).length).toBe(3);
    expect((await db.select().from(schema.customers).where(inArray(schema.customers.id, ids))).length).toBe(3); // none deleted
    expect(await findDuplicateCustomers()).toHaveLength(0);
  });
});

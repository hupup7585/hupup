import { describe, expect, it, vi } from "vitest";

/* Deep check A19 (Nov 27, 2026): an order delivered and picked up the same day shows on the Calendar day twice. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { runsForDay } from "@/lib/admin-queries";

describe("Calendar runs for a day", () => {
  it("same-day order: a delivery and a pickup; other orders once", async () => {
    const [same] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2027-01-12", pickupDate: "2027-01-12", subtotalCents: 1 }).returning();
    const [next] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2027-01-12", pickupDate: "2027-01-13", subtotalCents: 1 }).returning();
    const runs = await runsForDay("2027-01-12");
    expect(runs.filter((r) => r.id === same.id).map((r) => r.kind).sort()).toEqual(["delivery", "pickup"]);
    expect(runs.filter((r) => r.id === next.id).map((r) => r.kind)).toEqual(["delivery"]);
    expect((await runsForDay("2027-01-13")).map((r) => [r.id, r.kind])).toEqual([[next.id, "pickup"]]);
  });
});

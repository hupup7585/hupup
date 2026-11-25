import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Phone search fix (Abraham, Nov 25, 2026, 00:38): digits match the start of the 10-digit number, the start of the
 * 7-digit local part, or the last 4; never the middle. Best match first. Numbers on orders count too. In-memory database.
 */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", () => ({ requireStaff: async () => ({ role: "owner", userId: 1 }), requireAdmin: async () => ({ role: "owner", userId: 1 }) }));

import { db, schema } from "@/lib/db";
import { cellMatches, phoneMatchRank } from "@/lib/phone-search";
import { searchEverything } from "@/lib/search";

let onlyOnOrder = 0;
beforeAll(async () => {
  const add = async (name: string, phone: string) => (await db.insert(schema.customers).values({ name, phone }).returning())[0].id;
  await add("Exact Match", "+18457777585");
  await add("Middle Only", "+19147778451"); // 845 and 777 only in the middle
  await add("Last Four", "+12125557585");
  await add("Area Start", "+18451234567");
  onlyOnOrder = await add("Order Number Only", "+17185550000");
  await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", customerId: onlyOnOrder, eventDate: "2026-12-01", pickupDate: "2026-12-02", textPhone: "+18459990123" });
});

describe("the rule", () => {
  it("start of the number, start of the local part, last 4; never the middle", () => {
    expect(phoneMatchRank("+18457777585", "845")).toBe(1);
    expect(phoneMatchRank("+18457777585", "7777585")).toBe(1); // the local part
    expect(phoneMatchRank("+18457777585", "7585")).toBe(2); // the last 4
    expect(phoneMatchRank("+19147778451", "845")).toBeNull(); // only in the middle: no
    expect(phoneMatchRank("+19147778451", "4777")).toBeNull();
    expect(cellMatches("(914) 777-8451", "845")).toBe(false);
    expect(cellMatches("(914) 777-8451", "777")).toBe(true); // the local part starts with 777
  });
  it("a full 10-digit number in every format finds it, ranked first", () => {
    for (const q of ["8457777585", "845-777-7585", "(845) 777-7585", "+1 845 777 7585", "1-845-777-7585"]) {
      expect(phoneMatchRank("+18457777585", q.replace(/\D/g, "").slice(-10)), q).toBe(0);
      expect(cellMatches("+18457777585", q), q).toBe(true);
    }
  });
});

describe("Admin search (database)", () => {
  it("a middle-digit search no longer matches; best match first", async () => {
    const r = await searchEverything("845", { owner: true });
    const names = r.customers.map((c) => c.name);
    expect(names).not.toContain("Middle Only");
    expect(names).toEqual(expect.arrayContaining(["Exact Match", "Area Start"]));
  });
  it("4 digits: the last 4 match", async () => {
    const names = (await searchEverything("7585", { owner: true })).customers.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Exact Match", "Last Four"]));
    expect(names).not.toContain("Middle Only");
  });
  it("a full number in 5 formats always finds the customer, exact match first", async () => {
    for (const q of ["8457777585", "845-777-7585", "(845) 777-7585", "+1 845 777 7585", "1 845 777 7585"]) {
      const names = (await searchEverything(q, { owner: true })).customers.map((c) => c.name);
      expect(names[0], q).toBe("Exact Match");
    }
  });
  it("a number only on an order (the order's text number) finds the customer", async () => {
    const r = await searchEverything("845-999-0123", { owner: true });
    expect(r.customers.map((c) => c.id)).toContain(onlyOnOrder);
    expect(r.orders.some((o) => o.order.customerId === onlyOnOrder)).toBe(true);
  });
});

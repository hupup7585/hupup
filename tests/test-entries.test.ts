import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham (Nov 10, 2026): mark "Y'all See Gold" and "Maki. France" as test entries; never delete. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

describe("test entries", () => {
  it("the one-time update marks only those two customers, logs it, and deletes nothing", async () => {
    await db.insert(schema.customers).values([
      { name: "Y’all See Gold", phone: "+18455550801" },
      { name: "Y'all See Gold", phone: "+18455550804" },
      { name: "Maki. France, Host", phone: "+18455550802" },
      { name: "Mrs. Klein", phone: "+18455550803" },
    ]);
    const m = readFileSync("drizzle/0027_customer_test_entries.sql", "utf8");
    expect(m).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    for (const stmt of m.split("--> statement-breakpoint").slice(1)) await db.execute(sql.raw(stmt));
    const rows = (await db.select().from(schema.customers)).sort((a, b) => a.phone!.localeCompare(b.phone!));
    expect(rows.map((r) => [r.name, r.isTest])).toEqual([
      ["Y\u2019all See Gold", true],
      ["Maki. France, Host", true],
      ["Mrs. Klein", false],
      ["Y'all See Gold", true],
    ]);
    const log = await db.select().from(schema.auditLog);
    expect(log.filter((l) => l.action === "customer.marked_test")).toHaveLength(3);
  });
  it("Owner can mark or unmark any customer; test entries are labeled and left out of campaigns", () => {
    expect(readFileSync("src/app/admin/(app)/customers/actions.ts", "utf8")).toMatch(/export async function setTestEntryAction[\s\S]*await requireOwner\(\)/);
    expect(readFileSync("src/app/admin/(app)/customers/[id]/page.tsx", "utf8")).toContain("Mark as test entry");
    expect(readFileSync("src/app/admin/(app)/customers/page.tsx", "utf8")).toContain("Test entry");
    expect(readFileSync("src/lib/campaigns.ts", "utf8")).toContain("eq(schema.customers.isTest, false)");
  });
});

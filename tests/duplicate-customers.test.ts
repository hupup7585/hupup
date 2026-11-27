import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark for Abraham (Nov 27, 2026, 2:14 AM ET, item 2): Possible duplicate customers, a list only. Same phone, or same
   name + address, across phone, website and staff bookings. Merge only when pressed: moves orders (and their
   payments), texts and consent records to the kept record; never deletes an order, payment or record; a STOP wins. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addressKey, findDuplicateCustomers, mergeCustomers, mergeLinks, nameKey, phoneKey } from "@/lib/duplicate-customers";

let a = 0, b = 0, c = 0, d = 0, e = 0, lone = 0, oA = 0, oB = 0;
beforeAll(async () => {
  const ins = async (v: Partial<typeof schema.customers.$inferInsert>) => (await db.insert(schema.customers).values(v).returning())[0].id;
  a = await ins({ name: "Abraham Schwartz", phone: "+18455550101", email: "a@example.com" });
  b = await ins({ name: null, phone: "+18455550101", smsOptOut: true }); // same phone, replied STOP
  c = await ins({ name: "Schwartz, Abraham", phone: "+18455550199", address: "12 Forest Road, Monroe, NY 10950" });
  d = await ins({ name: "Moshe Klein", phone: "+18455550300", address: "5 Bakertown Rd" });
  e = await ins({ name: "Moshe Klein", phone: "+18455550301", address: "7 Other St" });
  lone = await ins({ name: "Only One", phone: "+18455550999" });
  const ord = async (customerId: number, channel: "PHONE" | "POS", addr: string, callSid: string | null) =>
    (await db.insert(schema.orders).values({ status: "CONFIRMED", channel, customerId, eventDate: "2027-02-10", pickupDate: "2027-02-11", deliveryAddress: addr, callSid, totalCents: 1000, paidCents: 1000 }).returning())[0].id;
  oA = await ord(a, "PHONE", "12 Forest Rd, Monroe NY", "CA1");
  oB = await ord(b, "POS", "12 Forest Rd", null);
  await db.insert(schema.smsConsents).values({ customerId: b, phone: "+18455550101", scope: "transactional", action: "opt_out", source: "keyword" });
});

describe("Possible duplicate customers", () => {
  it("keys: phone however typed, name in any order, street spellings", () => {
    expect(phoneKey("(845) 555-0101")).toBe(phoneKey("+18455550101"));
    expect(nameKey("Schwartz, Abraham")).toBe(nameKey("abraham  schwartz"));
    expect(addressKey("12 Forest Road, Monroe")).toBe(addressKey("12 forest rd"));
    expect(addressKey("Monroe")).toBeNull();
  });

  it("groups same phone and same name + address (via an order's address) into one group; the rest stay off", async () => {
    const groups = await findDuplicateCustomers();
    const g = groups.find((x) => x.records.some((r) => r.id === a))!;
    expect(g.records.map((r) => r.id).sort()).toEqual([a, b, c].sort());
    expect(g.reasons.join(" ")).toMatch(/Same phone number/);
    expect(g.reasons.join(" ")).toMatch(/Same name and address/);
    expect(g.anyStop).toBe(true);
    expect(g.suggestedKeepId).toBe(a);
    expect(g.records.find((r) => r.id === a)!.channels).toEqual(["Phone"]);
    expect(g.records.find((r) => r.id === b)!.channels).toEqual(["Staff"]);
    // Same name, different address and phone: not a duplicate
    expect(groups.some((x) => x.records.some((r) => r.id === d || r.id === e))).toBe(false);
    expect(groups.some((x) => x.records.some((r) => r.id === lone))).toBe(false);
  });

  it("listing never changes anything", async () => {
    const before = await db.select().from(schema.customers);
    await findDuplicateCustomers();
    expect(await db.select().from(schema.customers)).toEqual(before);
  });

  it("merge moves orders (and their payments), keeps consent records as written, deletes nothing, and the STOP wins", async () => {
    const customersBefore = (await db.select().from(schema.customers)).length;
    const ordersBefore = (await db.select().from(schema.orders)).length;
    const r = await mergeCustomers(a, [b, c], 1);
    expect(r.ok).toBe(true);
    expect((await db.select().from(schema.customers)).length).toBe(customersBefore);
    expect((await db.select().from(schema.orders)).length).toBe(ordersBefore);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, oB));
    expect(o.customerId).toBe(a);
    expect(o.paidCents).toBe(1000);
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, oA)))[0].customerId).toBe(a);
    // Consent records are legal records: never changed, still found by their phone; the kept page links to them
    const consents = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.customerId, b));
    expect(consents.length).toBe(1);
    expect(await mergeLinks(a)).toEqual({ mergedIn: [b, c], mergedInto: null });
    expect((await mergeLinks(b)).mergedInto).toBe(a);
    const [kept] = await db.select().from(schema.customers).where(eq(schema.customers.id, a));
    expect(kept.smsOptOut).toBe(true);
    expect(kept.marketingOptIn).toBe(false);
    expect(kept.address).toBe("12 Forest Road, Monroe, NY 10950"); // filled from the other record
    expect(kept.notes).toMatch(new RegExp(`customer number ${c}`));
    const [shell] = await db.select().from(schema.customers).where(eq(schema.customers.id, b));
    expect(shell.phone).toBeNull(); // a new call finds the kept record
    expect(shell.notes).toMatch(new RegExp(`Merged into customer number ${a}`));
    const audits = (await db.execute(sql`SELECT action, entity_id FROM audit_log WHERE action LIKE 'customer.merge%'`)).rows;
    expect(audits.length).toBe(3);
  });

  it("merged records leave the list, and the same records can't be merged twice", async () => {
    const groups = await findDuplicateCustomers();
    expect(groups.some((x) => x.records.some((r) => r.id === a || r.id === b || r.id === c))).toBe(false);
    expect((await mergeCustomers(a, [b], 1)).ok).toBe(false);
  });

  it("refuses a merge with nothing to merge", async () => {
    expect((await mergeCustomers(d, [d], 1)).ok).toBe(false);
  });
});

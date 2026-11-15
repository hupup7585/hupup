import { describe, expect, it, vi } from "vitest";

/* Search everything from the dashboard (Abraham, Nov 15, 2026). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { searchEverything, searchHits } from "@/lib/search";

describe("search everything", () => {
  it("finds orders by number, name, phone and address; customers; emails only for the Owner; calls and voicemails by phone", async () => {
    const [c] = await db.insert(schema.customers).values({ name: "Yossi Friedman", phone: "+18455550177", email: "yossi@example.com", address: "12 Forest Road" }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2099-06-01", pickupDate: "2099-06-01", customerId: c.id, deliveryAddress: "12 Forest Road" }).returning();
    await db.insert(schema.inboxEmails).values({ fromAddress: "yossi@example.com", fromName: "Yossi Friedman", subject: "Water slide" });
    await db.insert(schema.callSessions).values({ callSid: "CA-search-1", fromNumber: "+18455550177" });

    const byName = await searchEverything("Friedman", { owner: true });
    expect(byName.orders.map((x) => x.order.id)).toContain(o.id);
    expect(byName.customers).toHaveLength(1);
    expect(byName.emails).toHaveLength(1);
    expect((await searchEverything("Friedman", { owner: false })).emails).toHaveLength(0);
    expect((await searchEverything(String(1000 + o.id), { owner: true })).orders[0].order.id).toBe(o.id);
    const byPhone = await searchEverything("(845) 555-0177", { owner: true });
    expect(byPhone.calls).toHaveLength(1);
    expect(byPhone.customers).toHaveLength(1);
    expect(searchHits(await searchEverything("x", { owner: true }))).toBe(0); // too short
  });
  it("the dashboard has the Gmail-style search bar and range chips; the Inbox card has Compose", () => {
    const d = readFileSync("src/app/admin/(app)/page.tsx", "utf8");
    expect(d).toContain("<SearchBar />");
    expect(d).toContain("data-range-chip");
    expect(readFileSync("src/app/admin/(app)/InboxCard.tsx", "utf8")).toContain('href="/admin/inbox/new"');
  });
});

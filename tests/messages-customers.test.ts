import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { listThreads, markThreadRead, threadMessages, unreadTexts } from "@/lib/messages";

describe("Messages inbox", () => {
  it("groups texts by customer number, newest first, with unread counts and the customer's name", async () => {
    const [yossi] = await db.insert(schema.customers).values({ name: "Yossi F", phone: "+18455550111" }).returning();
    await db.insert(schema.messages).values([
      { direction: "out", contactPhone: "+18455550111", body: "Your booking is confirmed", kind: "transactional", status: "delivered", customerId: yossi.id, createdAt: new Date("2026-11-01T10:00:00Z") },
      { direction: "in", contactPhone: "+18455550111", body: "Thanks! Can you come at 2?", kind: "inbound", status: "received", createdAt: new Date("2026-11-01T10:05:00Z") },
      { direction: "in", contactPhone: "+18455550222", body: "Do you have a slide?", kind: "inbound", status: "received", createdAt: new Date("2026-11-01T11:00:00Z") },
      // Sign-in codes and other system texts to staff never show up as conversations
      { direction: "out", contactPhone: "+18457777585", body: "(not logged)", kind: "system", status: "sent", createdAt: new Date("2026-11-01T12:00:00Z") },
    ]);
    const threads = await listThreads();
    expect(threads.map((t) => t.contact_phone)).toEqual(["+18455550222", "+18455550111"]);
    expect(threads[1]).toMatchObject({ customer_name: "Yossi F", unread: 1, last_direction: "in", last_body: "Thanks! Can you come at 2?" });
    expect(await unreadTexts()).toBe(2);
    expect((await listThreads("slide")).map((t) => t.contact_phone)).toEqual(["+18455550222"]);
    expect((await listThreads("0111")).map((t) => t.contact_phone)).toEqual(["+18455550111"]);
    expect((await threadMessages("+18455550111")).map((m) => m.direction)).toEqual(["out", "in"]);
    await markThreadRead("+18455550111");
    expect(await unreadTexts()).toBe(1);
  });
});

describe("roles and live-database safety", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("free-form replies are Owner-only and go through the consent-aware sender", () => {
    const a = read("src/app/admin/(app)/messages/actions.ts");
    expect(a).toContain("await requireOwner()");
    expect(a).toContain("sendMessage({");
    expect(a).toContain('event: "staff_reply"');
    expect(read("src/app/admin/(app)/messages/page.tsx")).toMatch(/staff\.role === "owner" \? \(\s*<ReplyForm/);
  });
  it("Messages, Customers and Voicemail are for Owner and Secretary (never Delivery)", () => {
    for (const f of ["src/app/admin/(app)/messages/page.tsx", "src/app/admin/(app)/customers/page.tsx", "src/app/admin/(app)/customers/[id]/page.tsx", "src/app/admin/(app)/voicemail/page.tsx", "src/app/admin/(app)/customers/actions.ts"]) {
      expect(read(f)).toContain('requireStaff(["owner", "secretary"])');
    }
    const nav = read("src/components/Sidebar.tsx");
    for (const p of ["/admin/messages", "/admin/customers", "/admin/voicemail"]) expect(nav).toMatch(new RegExp(`\\["${p}", \\w+, "[^"]+", OS\\]`));
  });
  it("customer pages only read columns the live database has (no time zone columns until the migration)", () => {
    const detail = read("src/app/admin/(app)/customers/[id]/page.tsx");
    expect(detail).toContain("db.select(CUSTOMER_COLS)");
    expect(read("src/lib/messages.ts")).not.toMatch(/timeZone|time_zone/);
    expect(read("src/app/admin/(app)/customers/page.tsx")).not.toMatch(/time_zone|SELECT \*/);
  });
});

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Customer record: text consent in plain words (Abraham, Nov 9, 2026). In-memory database with the real migrations. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { customerConsent, senderNames } from "@/lib/customer-consent";

describe("customer text consent", () => {
  it("order and promo kept separate, with when, how, last unsubscribe and blocked status", async () => {
    const [c] = await db.insert(schema.customers).values({ name: "Mrs. Klein", phone: "+18455550401" }).returning();
    const at = (iso: string) => new Date(iso);
    await db.insert(schema.smsConsents).values([
      { customerId: c.id, phone: c.phone!, scope: "transactional", action: "opt_in", source: "phone", method: "keypad", wording: "order texts", createdAt: at("2026-11-01T15:00:00Z") },
      { customerId: c.id, phone: c.phone!, scope: "marketing", action: "opt_in", source: "web", method: "checkbox", wording: "promos", createdAt: at("2026-11-02T15:00:00Z") },
      { customerId: c.id, phone: c.phone!, scope: "marketing", action: "opt_out", source: "keyword", method: "keyword", keyword: "NOPROMO", wording: "NOPROMO", createdAt: at("2026-11-05T15:00:00Z") },
    ]);
    const s = await customerConsent({ id: c.id, phone: c.phone, smsOptOut: false });
    expect(s.order).toMatchObject({ status: "Yes", source: "Phone line", lastOptOut: null });
    expect(s.promo).toMatchObject({ status: "No", source: "Text keyword" });
    expect(s.promo.lastOptOut?.how).toBe("texted NOPROMO");
    expect(s.history).toHaveLength(3);
    expect(s.blocked).toBe(false);
    const stopped = await customerConsent({ id: c.id, phone: c.phone, smsOptOut: true });
    expect(stopped.order.status).toBe("Stopped (replied STOP)");
    expect(stopped.promo.status).toBe("Stopped (replied STOP)");
  });

  it("waiting for confirmation while a JOIN/YES request is pending; never asked when nothing is on file", async () => {
    const [c] = await db.insert(schema.customers).values({ phone: "+18455550402" }).returning();
    expect((await customerConsent({ id: c.id, phone: c.phone, smsOptOut: false })).promo.status).toBe("Never asked");
    await db.insert(schema.smsReenrollRequests).values({ phone: c.phone!, customerId: c.id, scope: "marketing", status: "pending", promptText: "confirm", expiresAt: new Date(Date.now() + 86_400_000) });
    expect((await customerConsent({ id: c.id, phone: c.phone, smsOptOut: false })).promo.status).toBe("Waiting for the customer's confirmation");
  });

  it("text history shows who sent each text; the screen shows both programs and the history", async () => {
    const [u] = await db.insert(schema.adminUsers).values({ name: "Sara", phone: "+18455550101", role: "secretary", active: true }).returning();
    expect((await senderNames([u.id, null])).get(u.id)).toBe("Sara");
    const page = readFileSync("src/app/admin/(app)/customers/[id]/page.tsx", "utf8");
    expect(page).toContain("data-text-consent");
    expect(page).toContain('[["Order texts", consent.order], ["Promo texts", consent.promo]]');
    expect(page).toContain('sent by ${m.userId ? senders.get(m.userId) ?? "staff" : "System"}');
    expect(page).toContain("Not active yet: waiting for Twilio A2P approval.");
  });
});

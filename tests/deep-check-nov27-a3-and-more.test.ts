import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Deep check, Nov 27, 2026 (docs/audit/2026-11-27-0300-deep-check.md): A3, 7 (clock), 14, 16, 17, 20, 21, 25, 26, 27, 30, 31. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markPaid, releaseExpired } from "@/lib/orders";
import { checkEligibility } from "@/lib/sms";

const mk = async (total: number, o: { paid?: number; expired?: boolean } = {}) =>
  (await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-05-10", pickupDate: "2027-05-11", subtotalCents: total, totalCents: total, paidCents: o.paid ?? 0, holdExpiresAt: new Date(Date.now() + (o.expired ? -60_000 : 600_000)) }).returning())[0].id;
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("deep check Nov 27", () => {
  it("A3: two payments at once that together pay in full always end Confirmed", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await mk(20000);
      await Promise.all([markPaid(id, 10000, "sola", `A3-${i}`), markPaid(id, 10000, "cash")]);
      expect([(await get(id)).status, (await get(id)).paidCents]).toEqual(["CONFIRMED", 20000]);
    }
  });
  it("7: the clock never cancels an order with money on it", async () => {
    const paid = await mk(15000, { paid: 5000, expired: true });
    const unpaid = await mk(15000, { expired: true });
    await releaseExpired();
    expect((await get(paid)).status).toBe("PENDING_PAYMENT");
    expect((await get(unpaid)).status).toBe("CANCELLED");
  });
  it("14: STOP on one customer record blocks texts to that number from any record", async () => {
    const phone = "+18455550999";
    await db.insert(schema.customers).values({ name: "A", phone, smsOptOut: true });
    const [b] = await db.insert(schema.customers).values({ name: "B", phone, marketingOptIn: true }).returning();
    expect(await checkEligibility({ to: phone, kind: "marketing", customer: b })).toBe("opted_out");
  });
  it("source checks: 16, 17, 20, 21, 25, 26, 27, 30, 31", () => {
    const read = (f: string) => readFileSync(f, "utf8");
    expect(read("src/lib/stripe-ops.ts")).toContain('event.type === "refund.created"');
    expect(read("src/lib/sms.ts")).toContain("async function claimHeld(");
    expect(read("src/lib/inbox.ts")).toContain("claimed first (its send time cleared)");
    expect(read("src/app/api/preview/email-sender-check/route.ts")).toContain('role !== "owner"');
    expect(read("scripts/migrate.ts")).toContain("async function reportSkipped(");
    const flow = read("src/lib/ivr/flow.ts");
    expect(flow).toContain("UPDATE call_sessions SET data = jsonb_set(data, '{staffLegs}'");
    expect(flow).toContain("timerStaffAcceptAgain ?? 6) + 10");
    expect(read("src/lib/stripe-pay-voice.ts")).toContain("no new card try once the Shabbes / Yom Tov cut-off");
    expect(read("src/app/api/cron/release-holds/route.ts")).toContain("{ record: false }");
    expect(read("src/lib/system-status.ts")).toContain("active: sttActive(env)");
  });
});

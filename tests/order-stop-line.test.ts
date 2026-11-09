import { describe, expect, it, vi } from "vitest";

/* Order texts: "Reply STOP to opt out." on the first one and after 30 days without one (Abraham, Nov 9, 2026). */
const h = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { body: string }) => (h.sent.push(p.body), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { db, schema } from "@/lib/db";
import { sendMessage, withOrderStopLine } from "@/lib/sms";

const PHONE = "+18455550501";
const day = (d: number) => new Date(Date.UTC(2026, 10, 1 + d, 17));

describe("STOP line on order texts", () => {
  it("first order text has it; the next ones don't; it comes back after 30 days without an order text", async () => {
    process.env.TWILIO_PHONE_NUMBER = "+18454157585";
    const [c] = await db.insert(schema.customers).values({ phone: PHONE, name: "Test" }).returning();
    await db.insert(schema.smsConsents).values({ customerId: c.id, phone: PHONE, scope: "transactional", action: "opt_in", source: "phone", method: "keypad", wording: "x" });
    await sendMessage({ to: PHONE, body: "Your order #1001 is confirmed.", kind: "transactional", now: day(0) });
    await sendMessage({ to: PHONE, body: "Your driver is on the way.", kind: "transactional", now: day(1) });
    await sendMessage({ to: PHONE, body: "Pickup reminder for tomorrow.", kind: "transactional", now: day(40) });
    expect(h.sent).toEqual(["Your order #1001 is confirmed. Reply STOP to opt out.", "Your driver is on the way.", "Pickup reminder for tomorrow. Reply STOP to opt out."]);
  });
  it("never adds a second STOP line", () => {
    expect(withOrderStopLine("Order confirmed. Reply HELP for help, STOP to opt out.", true)).toBe("Order confirmed. Reply HELP for help, STOP to opt out.");
    expect(withOrderStopLine("Order confirmed.", false)).toBe("Order confirmed.");
  });
});

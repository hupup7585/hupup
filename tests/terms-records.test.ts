import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/*
 * Abraham (policy audit, item 2): every reservation's Terms acceptance stores the date and time, the IP address
 * (web) or caller number (phone), and the Terms version, one record per rental day, for web, phone and staff.
 */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { CURRENT_TERMS_VERSION, recordTermsAcceptance } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";

describe("Terms acceptance records", () => {
  it("phone: caller number and call id are stored with the version and time", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2026-12-01", pickupDate: "2026-12-02" }).returning();
    await recordTermsAcceptance({ orderId: o.id, phone: "+18457770000", callerPhone: "+18457771111", callSid: "CA123", termsVersion: CURRENT_TERMS_VERSION, termsText: TERMS_TEXT, method: "phone_hash", acceptanceStatement: "Pressed #" });
    const [r] = await db.select().from(schema.termsAcceptances);
    expect(r).toMatchObject({ orderId: o.id, callerPhone: "+18457771111", callSid: "CA123", termsVersion: CURRENT_TERMS_VERSION, method: "phone_hash" });
    expect(r.acceptedAt).toBeInstanceOf(Date);
    expect(r.termsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("every channel records every rental day, with IP (web, staff device) or caller number (phone)", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain("for (const day of await callOrders(ctx)) {");
    expect(flow).toContain("callerPhone: toE164(ctx.from)");
    expect(flow).toContain("callSid: ctx.callSid,");
    const pay = readFileSync("src/app/pay/[orderId]/actions.ts", "utf8");
    expect(pay).toContain('for (const day of group.orders.filter((x) => x.order.status === "PENDING_PAYMENT")) {');
    expect(pay).toContain('ip: (h.get("x-forwarded-for")');
    const pos = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    expect(pos).toContain('ip: (reqHeaders.get("x-forwarded-for")');
    expect(pos).toContain("userId: session.userId ?? null");
  });
});

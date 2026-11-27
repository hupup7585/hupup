import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { reserveItem } from "@/lib/orders";
import { PROMPTS } from "@/lib/ivr/prompts";

const SID = "CAlatetaken";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550192" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const eastern = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" });
let pid = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_API_KEY = "test";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  pid = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 1, active: true }).returning())[0].id;
});

describe("Hark's payment check, Nov 27, bug 4: hold ran out during a long Sola call and the unit was booked meanwhile", () => {
  it("order goes to Needs attention, but the caller hears 'approved, your booking is confirmed'", async () => {
    const now = Date.now();
    const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: "2027-03-16", channel: "PHONE", status: "PENDING_PAYMENT", holdExpiresAt: new Date(now + 600_000), callSid: SID });
    if (!r.ok) throw new Error("no hold");
    const id = r.orderId;
    await db.update(schema.orders).set({ totalCents: 17841 }).where(eq(schema.orders.id, id));
    // the caller's hold ran out (not yet released by the job) and another booking took the only unit
    await db.update(schema.orders).set({ holdExpiresAt: new Date(now - 60_000) }).where(eq(schema.orders.id, id));
    const other = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: "2027-03-16", channel: "PHONE", status: "CONFIRMED", callSid: "CAother" });
    expect(other.ok).toBe(true);
    const [att] = await db.insert(schema.phonepayAttempts).values({ orderId: id, callSid: SID, amountCents: 17841, startedAt: new Date(now - 11 * 60_000), tryNumber: 1 }).returning();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ xResult: "S", xReportData: [{ xRefNum: "LATE1", xAmount: "178.41", xEnteredDate: eastern(new Date(now - 60_000)), xInvoice: "8455550192" }] }))) as unknown as typeof fetch;
    try {
      const next = redirect(await call("phonepay-done", { DialCallStatus: "completed" }, `o=${id}&a=${att.id}`));
      const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
      const xml = await call("pay-approved", {}, `o=${id}`);
      const heard = xml.includes(PROMPTS.phonepay_approved.text.slice(0, 25));
      console.log({ next, status: o.status, paidCents: o.paidCents, hearsApprovedConfirmed: heard, line: PROMPTS.phonepay_approved.text });
      expect(o.status).toBe("NEEDS_ATTENTION");
      expect(heard).toBe(false);
      expect(redirect(xml)).toBe("goodbye");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

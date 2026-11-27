import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
const h = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async (_t: string, s: string) => (h.emails.push(s), { sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { releaseExpired, reserveItem } from "@/lib/orders";

const SID = "CAreleased";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550192" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const eastern = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" });
let pid = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_API_KEY = "test";
  process.env.ADMIN_EMAIL = "owner@example.com";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  pid = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 1, active: true }).returning())[0].id;
});

describe("Hark's payment check, Nov 27, bug 2: hold released while the caller is on Sola's line", () => {
  it("the approved Sola charge is never looked at: unpaid goodbye, nothing recorded, no Owner email", async () => {
    const now = Date.now();
    // try started 12 minutes ago with a 10-minute payment hold (renewed at phonepay-go); Sola's call may last 15 minutes
    const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: "2027-03-02", channel: "PHONE", status: "PENDING_PAYMENT", holdExpiresAt: new Date(now - 2 * 60_000), callSid: SID });
    if (!r.ok) throw new Error("no hold");
    const id = r.orderId;
    await db.update(schema.orders).set({ totalCents: 17841 }).where(eq(schema.orders.id, id));
    const [att] = await db.insert(schema.phonepayAttempts).values({ orderId: id, callSid: SID, amountCents: 17841, startedAt: new Date(now - 12 * 60_000), tryNumber: 1, solaSeen: "approved" }).returning();
    // the release job runs (Cloudflare scheduler / cron)
    expect(await releaseExpired()).toBeGreaterThan(0);
    // Sola shows the caller's approved charge for exactly this amount
    let solaLooks = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      if (String(u).includes("cardknox")) solaLooks++;
      return new Response(JSON.stringify({ xResult: "S", xReportData: [{ xRefNum: "PAID1", xAmount: "178.41", xEnteredDate: eastern(new Date(now - 60_000)), xInvoice: "8455550192" }] }));
    }) as unknown as typeof fetch;
    try {
      const next = redirect(await call("phonepay-done", { DialCallStatus: "completed" }, `o=${id}&a=${att.id}`));
      const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
      console.log({ next, status: o.status, paidCents: o.paidCents, solaLooks, emails: h.emails });
      // Correct: the charge is checked and recorded (late payment: confirmed if still free, else Needs attention)
      expect(solaLooks).toBeGreaterThan(0);
      expect(o.paidCents).toBe(17841);
      expect(o.status).toBe("CONFIRMED"); // the item was still free: the late payment confirms it
      expect(next).toBe(`pay-approved?o=${id}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

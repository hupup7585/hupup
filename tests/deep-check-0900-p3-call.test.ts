import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P3, simulated call: the caller's hold ran out (the order was released) while they were
   typing their card on the Sola line. Back on our line (phonepay-done) the charge used to be never looked for: the
   caller heard the unpaid goodbye and the money was never recorded. Now the try's charge is still looked for: still free
   = confirmed and the approved lines; taken = Needs attention (the Owner is told), never "your booking is confirmed"; no charge = the
   unpaid goodbye as before. Each test has its own amount (a recent try of the same amount counts as another caller). */
const h = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async (_to: string, subject: string) => (h.emails.push(subject), { sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { reserveItem } from "@/lib/orders";
import { PROMPTS } from "@/lib/ivr/prompts";

const eastern = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
let pid = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_API_KEY = "test";
  process.env.ADMIN_EMAIL = "owner@example.com";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  pid = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 1, active: true }).returning())[0].id;
});
afterEach(() => vi.unstubAllGlobals());

const solaShows = (charges: { ref: string; cents: number; at: Date }[]) =>
  vi.stubGlobal("fetch", (async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { xCommand?: string };
    if (body.xCommand === "cc:void") return new Response(JSON.stringify({ xResult: "A" }));
    return new Response(JSON.stringify({ xResult: "S", xReportData: charges.map((c) => ({ xRefNum: c.ref, xAmount: (c.cents / 100).toFixed(2), xEnteredDate: eastern(c.at) })) }));
  }) as unknown as typeof fetch);

/** A caller paying, whose hold ran out and was released while on the Sola line (try 1 started 3 minutes ago). */
async function releasedWhilePaying(sid: string, date: string, cents: number) {
  const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: date, channel: "PHONE", status: "PENDING_PAYMENT", holdExpiresAt: new Date(Date.now() - 60_000), callSid: sid });
  if (!r.ok) throw new Error("no hold");
  await db.update(schema.orders).set({ totalCents: cents, status: "CANCELLED" }).where(eq(schema.orders.id, r.orderId));
  const [a] = await db.insert(schema.phonepayAttempts).values({ orderId: r.orderId, callSid: sid, tryNumber: 1, amountCents: cents, startedAt: new Date(Date.now() - 3 * 60_000) }).returning();
  return { o: r.orderId, a: a.id };
}
const done = (sid: string, o: number, a: number) => handleVoice({ action: "phonepay-done", query: new URLSearchParams(`o=${o}&a=${a}`), body: { CallSid: sid, DialCallStatus: "completed" }, callSid: sid, from: "+18455550194" });

describe("deep check 09:00 P3: a card payment that ends after the hold ran out", () => {
  it("charged, item still free: confirmed, the approved lines", async () => {
    const { o, a } = await releasedWhilePaying("CAp3a", "2027-05-04", 17841);
    solaShows([{ ref: "P3A", cents: 17841, at: new Date(Date.now() - 60_000) }]);
    expect(redirect(await done("CAp3a", o, a))).toBe(`pay-approved?o=${o}`);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, o));
    expect([row.status, row.paidCents, row.solaRefNum]).toEqual(["CONFIRMED", 17841, "P3A"]);
  });

  it("charged, but another caller booked the item meanwhile: Needs attention, the Owner told, never 'booking is confirmed'", async () => {
    const { o, a } = await releasedWhilePaying("CAp3b", "2027-05-11", 17941);
    const other = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: "2027-05-11", channel: "PHONE", status: "PENDING_PAYMENT", holdExpiresAt: new Date(Date.now() + 600_000), callSid: "CAp3other" });
    expect(other.ok).toBe(true);
    h.emails.length = 0;
    solaShows([{ ref: "P3B", cents: 17941, at: new Date(Date.now() - 60_000) }]);
    expect(redirect(await done("CAp3b", o, a))).toBe(`pay-approved?o=${o}`);
    // paid but not booked: never "your booking is confirmed", the call goes to the goodbye
    const approved = await handleVoice({ action: "pay-approved", query: new URLSearchParams(`o=${o}`), body: { CallSid: "CAp3b" }, callSid: "CAp3b", from: "+18455550194" });
    expect(redirect(approved)).toBe("goodbye");
    expect(approved).not.toContain(PROMPTS.phonepay_approved.text.slice(0, 30));
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, o));
    expect([row.status, row.paidCents]).toEqual(["NEEDS_ATTENTION", 17941]);
    expect(h.emails.some((s) => /needs staff attention/i.test(s))).toBe(true);
  });

  it("no charge in Sola: the unpaid goodbye, nothing recorded", async () => {
    const { o, a } = await releasedWhilePaying("CAp3c", "2027-05-18", 18041);
    solaShows([]);
    expect(redirect(await done("CAp3c", o, a))).toBe("goodbye");
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, o));
    expect([row.status, row.paidCents]).toEqual(["CANCELLED", 0]);
  }, 30_000);
});

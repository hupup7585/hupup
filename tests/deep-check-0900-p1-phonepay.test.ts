import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P1 (M10 completed): after a card try that Sola could not check (check_failed) but that
   was charged, every later try saw two charges of the total ("unclear"), so the caller was charged on every try and
   nothing was ever marked paid. Now this try's own charge is the payment and the earlier try's charge is voided; a
   charge already set aside as unclear is never counted again; with another caller paying the same amount (and no phone
   on the charges) nothing is guessed. Each test uses its own amount: a recent try of another test with the same amount
   would count as another caller paying the same amount. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkPhonePayTry } from "@/lib/sola-phonepay";

const eastern = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" });

/** A fake Sola: the report lists `charges`; a void is recorded (and approved). */
function fakeSola(charges: { ref: string; cents: number; at: Date; invoice?: string }[]) {
  const voided: string[] = [];
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { xCommand?: string; xRefNum?: string };
    if (body.xCommand === "cc:void") {
      voided.push(String(body.xRefNum));
      return new Response(JSON.stringify({ xResult: "A" }));
    }
    const rows = charges.filter((c) => !voided.includes(c.ref)).map((c) => ({ xRefNum: c.ref, xAmount: (c.cents / 100).toFixed(2), xEnteredDate: eastern(c.at), ...(c.invoice ? { xInvoice: c.invoice } : {}) }));
    return new Response(JSON.stringify({ xResult: "S", xReportData: rows }));
  }) as unknown as typeof fetch;
  return { fetcher, voided };
}

async function order(callSid: string, cents = 40000) {
  const now = Date.now();
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-03-10", pickupDate: "2027-03-11", subtotalCents: cents, totalCents: cents, holdExpiresAt: new Date(now + 600_000) }).returning();
  return { o, now, callSid };
}

describe("deep check 09:00 P1 (M10 completed)", () => {
  it("try 1 could not be checked and was charged, try 2 charged again: paid once with try 2, try 1's charge voided", async () => {
    process.env.SOLA_API_KEY = "test";
    const { o, now } = await order("CAp1a");
    await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAp1a", tryNumber: 1, amountCents: 40000, startedAt: new Date(now - 5 * 60_000), result: "check_failed" });
    const [t2] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAp1a", tryNumber: 2, amountCents: 40000, startedAt: new Date(now - 60_000) }).returning();
    const sola = fakeSola([
      { ref: "P1A-1", cents: 40000, at: new Date(now - 4 * 60_000) },
      { ref: "P1A-2", cents: 40000, at: new Date(now - 30_000) },
    ]);
    const r = await checkPhonePayTry(o.id, t2.id, 40000, { fetcher: sola.fetcher, waitMs: 0 });
    expect(r.result).toBe("paid");
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.paidCents).toBe(40000);
    expect(after.status).toBe("CONFIRMED");
    expect(after.solaRefNum).toBe("P1A-2");
    expect(sola.voided).toEqual(["P1A-1"]);
  });

  it("charges set aside as unclear on try 2 are not counted again: try 3 is paid and they are voided", async () => {
    process.env.SOLA_API_KEY = "test";
    const { o, now } = await order("CAp1b", 41000);
    await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAp1b", tryNumber: 1, amountCents: 41000, startedAt: new Date(now - 8 * 60_000), result: "check_failed" });
    await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAp1b", tryNumber: 2, amountCents: 41000, startedAt: new Date(now - 4 * 60_000), result: "unclear", unclearRefs: "P1B-1,P1B-2" });
    const [t3] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAp1b", tryNumber: 3, amountCents: 41000, startedAt: new Date(now - 60_000) }).returning();
    const sola = fakeSola([
      { ref: "P1B-1", cents: 41000, at: new Date(now - 7 * 60_000) },
      { ref: "P1B-2", cents: 41000, at: new Date(now - 3 * 60_000) },
      { ref: "P1B-3", cents: 41000, at: new Date(now - 30_000) },
    ]);
    const r = await checkPhonePayTry(o.id, t3.id, 41000, { fetcher: sola.fetcher, waitMs: 0 });
    expect(r.result).toBe("paid");
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.paidCents).toBe(41000);
    expect(after.solaRefNum).toBe("P1B-3");
    expect([...sola.voided].sort()).toEqual(["P1B-1", "P1B-2"]);
  });

  it("another caller paying the same amount at the same time (no phone on the charges): still unclear, nothing voided", async () => {
    process.env.SOLA_API_KEY = "test";
    const { o, now } = await order("CAp1c", 42000);
    await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAp1c", tryNumber: 1, amountCents: 42000, startedAt: new Date(now - 5 * 60_000), result: "check_failed" });
    const [t2] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAp1c", tryNumber: 2, amountCents: 42000, startedAt: new Date(now - 60_000) }).returning();
    // another caller (another call) paying $400.00 right now
    const { o: other } = await order("CAother", 42000);
    await db.insert(schema.phonepayAttempts).values({ orderId: other.id, callSid: "CAother", tryNumber: 1, amountCents: 42000, startedAt: new Date(now - 2 * 60_000) });
    const sola = fakeSola([
      { ref: "P1C-1", cents: 42000, at: new Date(now - 4 * 60_000) },
      { ref: "P1C-2", cents: 42000, at: new Date(now - 30_000) },
    ]);
    const r = await checkPhonePayTry(o.id, t2.id, 42000, { fetcher: sola.fetcher, waitMs: 0 });
    expect(r.result).toBe("unclear");
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.paidCents).toBe(0);
    expect(sola.voided).toEqual([]);
  });
});

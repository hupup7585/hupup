import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's 2nd phone check (Nov 26, 2026, ~10 PM): money and booking safety A1 to A5. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice, renewPaymentHold } from "@/lib/ivr/flow";
import { reserveItem } from "@/lib/orders";
import { PROMPTS } from "@/lib/ivr/prompts";

const SID = "CAcheck2";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550192" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
let pid = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  pid = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 1, active: true }).returning())[0].id;
});
const order = async (date: string, status: "PENDING_PAYMENT" | "HOLD", expires: Date) => {
  const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: date, channel: "PHONE", status, holdExpiresAt: expires, callSid: `${SID}${date}${status}` });
  if (!r.ok) throw new Error("no hold");
  await db.update(schema.orders).set({ totalCents: 17841 }).where(eq(schema.orders.id, r.orderId));
  return r.orderId;
};

describe("A2: paid means paid", () => {
  it("a released order (cancelled, nothing paid) never hears 'approved' and gets the unpaid goodbye", async () => {
    const id = await order("2027-02-02", "PENDING_PAYMENT", new Date(Date.now() + 600_000));
    await db.update(schema.orders).set({ status: "CANCELLED" }).where(eq(schema.orders.id, id));
    expect(redirect(await call("phonepay-done", {}, `o=${id}`))).toBe("goodbye");
    expect(redirect(await call("pay-approved", {}, `o=${id}`))).toBe("goodbye");
    expect(redirect(await call("phonepay-go", {}, `o=${id}`))).toBe("goodbye");
    expect(await call("pay-approved", {}, `o=${id}`)).not.toContain(PROMPTS.phonepay_approved.text.slice(0, 20));
  });
  it("a fully paid order goes on to the after-payment lines", async () => {
    const id = await order("2027-02-09", "PENDING_PAYMENT", new Date(Date.now() + 600_000));
    await db.update(schema.orders).set({ status: "CONFIRMED", paidCents: 17841 }).where(eq(schema.orders.id, id));
    expect(redirect(await call("phonepay-done", {}, `o=${id}`))).toBe(`pay-approved?o=${id}`);
  });
});

describe("A3: a hold that ran out is renewed only while its item is still free", () => {
  it("someone else booked the last unit meanwhile: not renewed", async () => {
    const a = await order("2027-02-16", "PENDING_PAYMENT", new Date(Date.now() - 60_000)); // ran out
    const b = await order("2027-02-16", "PENDING_PAYMENT", new Date(Date.now() + 600_000)); // took the unit
    const taken = await renewPaymentHold([a], 10);
    expect(taken).toEqual([a]);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, a));
    expect(row.holdExpiresAt!.getTime()).toBeLessThan(Date.now());
    expect(b).toBeGreaterThan(0);
  });
  it("still free: renewed", async () => {
    const a = await order("2027-02-23", "PENDING_PAYMENT", new Date(Date.now() - 60_000));
    expect(await renewPaymentHold([a], 10)).toEqual([]);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, a));
    expect(row.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });
});

describe("A1 and A5 (code)", () => {
  it("A1: Sola could not be checked = box 147 path, never the declined line, never recorded as declined", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('if (r.result === "unclear" || r.result === "check_failed") return back(vr, "phonepay-retry", { o, n, u: 1 });');
    expect(readFileSync("src/lib/sola-phonepay.ts", "utf8")).toContain('if (result !== "check_failed") await recordPaymentResult(ids, "declined", null, null);');
  });
  it("A5: a Stripe payment goes to the same after-payment lines as Sola", () => {
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain('if (group.paid) return back(vr, "pay-approved", { o });\n    return back(vr, "goodbye");');
  });
});

describe("B11 and A6", () => {
  it("B11: a failure while a step is set up gets our tech_error line and a hang-up", async () => {
    const settings = await import("@/lib/settings");
    const spy = vi.spyOn(settings, "getSettings").mockRejectedValueOnce(new Error("Neon is waking up"));
    const xml = await call("menu");
    spy.mockRestore();
    expect(xml).toContain(PROMPTS.tech_error.text.slice(0, 20));
    expect(xml).toContain("<Hangup/>");
  });
  it("A6: a payment link that could not be sent emails the Owner to call back", () => {
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain("payment link could not be sent, order #${num}: please call the customer back");
  });
});

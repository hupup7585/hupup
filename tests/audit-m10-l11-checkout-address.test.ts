import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Code audit Nov 24: M10 (an address the map could not find is not "outside the area") and L11 (the checkout fee is
 * checked for the first delivery day, not today). */
const h = vi.hoisted(() => ({
  session: { callSid: "CAm10", fromNumber: "+18455550402", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "carted", startedAt: new Date() },
  quote: { ok: false, reason: "not_found" } as Record<string, unknown>,
  dates: [] as unknown[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/delivery-areas", async (orig) => ({
  ...(await orig<typeof import("@/lib/delivery-areas")>()),
  deliveryQuote: async (_a: string, _s: unknown, _f: unknown, now?: unknown) => { h.dates.push(now); return h.quote; },
}));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { reserveItem } from "@/lib/orders";

const call = (action: string) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CAm10" }, callSid: "CAm10", from: "+18455550402" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
let pid = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const c = (await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning())[0].id;
  pid = (await db.insert(schema.products).values({ categoryId: c, name: "Castle Bouncer", priceCents: 12000, quantity: 5, active: true }).returning())[0].id;
});
let day = 10;
beforeEach(async () => {
  h.dates.length = 0;
  h.session.data = { name: "Sara Klein", address: "12 Forest Road, Monroe, NY 10950", house: "12", street: "Forest Road", zip: "10950", town: "Monroe", phone: "+18455550402", smsConsent: "no", termsAccepted: true };
  const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: `2026-12-${String(day++).padStart(2, "0")}`, channel: "PHONE", status: "HOLD", callSid: "CAm10" });
  if (!r.ok) throw new Error("no hold");
  h.session.orderId = r.orderId;
});

describe("checkout address check", () => {
  it("M10: not found plays the approved 'could not find' line and asks the street again, not the outside line", async () => {
    h.quote = { ok: false, reason: "not_found" };
    const xml = await call("finalize");
    expect(xml).toContain(PROMPTS.addr_not_found.text.slice(0, 20));
    expect(redirect(xml)).toBe("addr-street");
    expect(h.session.data.street).toBeUndefined();
    expect(h.session.data.house).toBe("12"); // house number and zip kept
  });
  it("outside the area still goes to the approved outside line", async () => {
    h.quote = { ok: false, reason: "outside" };
    expect(redirect(await call("finalize"))).toBe("addr-outside");
  });
  it("L11: the fee is checked for the first delivery day", async () => {
    h.quote = { ok: false, reason: "outside" };
    await call("finalize");
    expect(String(h.dates[0])).toMatch(/^2026-12-\d\d/);
  });
});

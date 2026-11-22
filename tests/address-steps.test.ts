import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Delivery address in steps (Abraham, Nov 17, 2026). In-memory database; the map lookup is a stand-in. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAaddr", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
  quote: { ok: true, zone: "Local", feeCents: 1000, kind: "local" } as Record<string, unknown>,
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
vi.mock("@/lib/delivery-areas", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery-areas")>()), deliveryQuote: async () => h.quote }));

import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { townForZip } from "@/lib/orange-zips";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAaddr", ...body }, callSid: "CAaddr", from: "+18455550199" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  // A held cart on this call (the steps start only with something in the cart)
  const { db, schema } = await import("@/lib/db");
  const { reserveItem } = await import("@/lib/orders");
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 6500, quantity: 3, active: true }).returning();
  const r = await reserveItem({ orderId: null, productId: p.id, qty: 1, eventDate: "2026-12-07", channel: "PHONE", status: "HOLD" });
  if (r.ok) h.session.orderId = r.orderId;
});
beforeEach(() => {
  h.session.data = { name: "Sara Klein" };
  h.quote = { ok: true, zone: "Local", feeCents: 1000, kind: "local" };
  delete process.env.VERCEL_ENV;
});

describe("the approved lines", () => {
  it("step 1 and the retry line, word for word", () => {
    expect(PROMPTS.addr_street.text).toBe("Thanks! Please say the street name of the delivery address after the tone. Or press star to type it on your keypad.");
    expect(PROMPTS.retry_spoken.text).toBe("Sorry, we did not catch that. Please try again.");
  });
});

describe("address in steps (preview)", () => {
  it("step 1: the street line, then the tone; not understood: only the retry line, then the tone", async () => {
    expect(redirect(await call("addr"))).toBe("ask?f=street");
    const ask = await call("ask", {}, "f=street");
    expect(said(ask)).toEqual([PROMPTS.addr_street.text]);
    expect(ask).toContain("/audio/tone.wav</Play></Gather>");
    expect(redirect(await call("heard", { SpeechResult: "" }, "f=street"))).toBe("ask?f=street&n=1");
    const again = await call("ask", {}, "f=street&n=1");
    expect(said(again)).toEqual(["Sorry, I did not catch that. Let's try again."]); // the one shared did-not-catch line (Nov 22, 2026)
    expect(again).toContain("/audio/tone.wav");
    expect(redirect(await call("heard", { Digits: "*" }, "f=street"))).toBe("type?f=street");
  });
  it("the whole address, read back, then the price, then the directions", async () => {
    expect(redirect(await call("heard", { SpeechResult: "forest road" }, "f=street"))).toBe("addr-house");
    expect(h.session.data.street).toBe("Forest Road");
    expect(said(await call("addr-house"))).toEqual([PROMPTS.addr_house.text]);
    expect(redirect(await call("addr-house-heard", { Digits: "12" }))).toBe("ask?f=unit");
    expect(redirect(await call("heard", { Digits: "#" }, "f=unit"))).toBe("addr-zip"); // no unit
    expect(said(await call("addr-zip"))).toEqual(["Thanks! To continue with Monroe, New York, one zero nine five zero, press 1. To enter a different zip code, press 2."]);
    expect(redirect(await call("addr-zip-choice", { Digits: "1" }))).toBe("addr-check");
    expect(redirect(await call("addr-check"))).toBe("addr-readback");
    // A Kiryas Joel street (the $10 zone): read back and saved as Kiryas Joel (Abraham, Nov 17, 2026)
    expect(h.session.data.address).toBe("12 Forest Road, Kiryas Joel, NY 10950");
    const rb = said(await call("addr-readback"));
    expect(rb).toEqual(["Thanks! I have 1 2 Forest Road, Kiryas Joel, New York, 1 0 9 5 0. If that is correct, press 1. To enter the address again, press 2."]);
    expect(redirect(await call("addr-readback-choice", { Digits: "1" }))).toBe("addr-price");
    const price = await call("addr-price");
    expect(said(price)).toEqual(["Thanks! Delivery to Kiryas Joel, New York, is 10 dollars."]);
    expect(redirect(price)).toBe("directions");
  });
  it("a 10950 street outside Kiryas Joel stays Monroe", async () => {
    Object.assign(h.session.data, { street: "Lakes Road", house: "40", unit: undefined, zip: "10950" });
    h.quote = { ok: true, zone: "Blooming grove", feeCents: 1500, kind: "area" };
    await call("addr-check");
    expect(h.session.data.town).toBe("Monroe");
    expect(h.session.data.address).toBe("40 Lakes Road, Monroe, NY 10950");
  });
  it("a unit is read back; another zip fills its town; not 5 digits asks again", async () => {
    Object.assign(h.session.data, { street: "Main Street", house: "5", unit: "B" });
    expect(redirect(await call("addr-zip-heard", { Digits: "123" }))).toBe("addr-zip-enter?bad=1");
    expect(said(await call("addr-zip-enter", {}, "bad=1"))).toEqual([PROMPTS.addr_zip_bad.text]);
    expect(redirect(await call("addr-zip-heard", { Digits: "10924" }))).toBe("addr-check");
    await call("addr-check");
    expect(h.session.data.town).toBe("Goshen");
    expect(said(await call("addr-readback"))[0]).toBe("Thanks! I have 5 Main Street, B, Goshen, New York, 1 0 9 2 4. If that is correct, press 1. To enter the address again, press 2.");
  });
  it("step 5: a zip outside Orange County, and an address not on the map", async () => {
    Object.assign(h.session.data, { street: "Main Street", house: "5", unit: undefined, zip: "10001" });
    expect(townForZip("10001")).toBeNull();
    expect(redirect(await call("addr-check"))).toBe("addr-outside");
    expect(said(await call("addr-outside"))).toEqual([PROMPTS.addr_outside.text]);
    expect(redirect(await call("addr-outside-choice", { Digits: "1" }))).toBe("addr-zip-enter");
    Object.assign(h.session.data, { street: "Nowhere Lane", house: "9", zip: "10950" });
    h.quote = { ok: false, reason: "not_found" };
    const nf = await call("addr-check");
    expect(said(nf)).toEqual(["We are sorry, we could not find that address. Let us try again."]);
    expect(redirect(nf)).toBe("ask?f=street");
  });
  it("the live line keeps the one address question until the drafts are approved", async () => {
    process.env.VERCEL_ENV = "production";
    expect(redirect(await call("addr"))).toBe("ask?f=address");
  });
});

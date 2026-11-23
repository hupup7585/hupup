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
  it("step 2 and the retry line, word for word", () => {
    expect(PROMPTS.addr_street.text).toBe("Please say the street name of the delivery address after the tone."); // Nov 22, 2026
    expect(PROMPTS.retry_spoken.text).toBe("Sorry, we did not catch that. Please try again.");
  });
});

describe("address in steps (preview), the Nov 22, 2026 order", () => {
  it("house number, street, unit, town and zip, read-back, delivery price, saved, then the directions", async () => {
    expect(redirect(await call("addr"))).toBe("addr-house");
    expect(said(await call("addr-house"))).toEqual(["Now, with your keypad, please enter the house number.", "When you are done, press pound.", "To go back, press star."]);
    expect(redirect(await call("addr-house-heard", { Digits: "*" }))).toBe("ask?f=name");
    expect(redirect(await call("addr-house-heard", { Digits: "12" }))).toBe("ask?f=street");
    const ask = await call("ask", {}, "f=street");
    expect(said(ask)).toEqual(["Please say the street name of the delivery address after the tone."]);
    expect(ask).toContain("/audio/tone.wav</Play></Gather>");
    expect(redirect(await call("heard", { Digits: "*" }, "f=street"))).toBe("type?f=street"); // the keypad path
    expect(redirect(await call("heard", { SpeechResult: "" }, "f=street"))).toBe("ask?f=street&n=1");
    expect(said(await call("ask", {}, "f=street&n=1"))).toEqual(["Sorry, I did not catch that. Let's try again."]);
    expect(redirect(await call("heard", { SpeechResult: "forest road" }, "f=street"))).toBe("addr-unit");
    expect(h.session.data.street).toBe("Forest Road");
    expect(said(await call("addr-unit"))).toEqual(["Thanks, with your keypad, please enter the unit number.", "When you are done, press pound.", "If there is no unit number, press pound to skip.", "To go back, press star."]);
    expect(redirect(await call("addr-unit-heard", { Digits: "*" }))).toBe("ask?f=street");
    expect(redirect(await call("addr-unit-heard", { Digits: "" }))).toBe("addr-zip"); // pound with nothing typed: no unit
    expect(h.session.data.unit).toBeUndefined();
    expect(said(await call("addr-zip"))).toEqual(["To continue with Monroe, New York, one zero nine five zero, press 1. To enter a different zip code, press 2.", "To go back, press star."]);
    expect(redirect(await call("addr-zip-choice", { Digits: "*" }))).toBe("addr-unit");
    expect(redirect(await call("addr-zip-choice", { Digits: "1" }))).toBe("addr-check");
    expect(redirect(await call("addr-check"))).toBe("addr-readback");
    expect(h.session.data.address).toBe("12 Forest Road, Monroe, NY 10950"); // the postal town (the Kiryas Joel idea was withdrawn)
    expect(said(await call("addr-readback"))).toEqual(["Here is the address you entered.", "twelve", "Forest Road", "Monroe New York", "one zero nine five zero", "If that is correct, press 1.", "To enter the address again, press 2.", "To go back, press star."]);
    expect(redirect(await call("addr-readback-choice", { Digits: "*" }))).toBe("addr-zip");
    expect(redirect(await call("addr-readback-choice", { Digits: "1" }))).toBe("addr-price");
    const price = await call("addr-price");
    expect(said(price)).toEqual(["Delivery to Monroe New York is 10 dollars.", "Thank you. Your delivery address has been saved."]);
    expect(redirect(price)).toBe("directions");
    expect(redirect(await call("addr-readback-choice", { Digits: "2" }))).toBe("addr-house");
    expect(h.session.data.house).toBeUndefined();
  });
  it("a unit is read digit by digit; another zip fills its town; not 5 digits asks again", async () => {
    Object.assign(h.session.data, { street: "Main Street", house: "53", unit: "302A" });
    expect(redirect(await call("addr-zip-heard", { Digits: "123" }))).toBe("addr-zip-enter?bad=1");
    expect(said(await call("addr-zip-enter", {}, "bad=1"))).toEqual([PROMPTS.addr_zip_bad.text]);
    expect(redirect(await call("addr-zip-heard", { Digits: "10924" }))).toBe("addr-check");
    await call("addr-check");
    expect(h.session.data.town).toBe("Goshen");
    // part by part (Nov 23, 2026): recordings where live, Puck for the rest
    expect(said(await call("addr-readback")).slice(1, 7)).toEqual(["fifty three", "Main Street", "unit", "three zero two A", "Goshen New York", "one zero nine two four"]);
  });
  it("step 5: a zip outside Orange County, and an address not on the map", async () => {
    Object.assign(h.session.data, { street: "Main Street", house: "5", unit: undefined, zip: "10001" });
    expect(townForZip("10001")).toBeNull();
    expect(redirect(await call("addr-check"))).toBe("addr-outside");
    expect(said(await call("addr-outside"))).toEqual([PROMPTS.addr_outside.text, "To go back, press star."]); // approved Nov 22, 2026
    expect(redirect(await call("addr-outside-choice", { Digits: "*" }))).toBe("addr-zip");
    expect(redirect(await call("addr-outside-choice", { Digits: "1" }))).toBe("addr-zip-enter");
    Object.assign(h.session.data, { street: "Nowhere Lane", house: "9", zip: "10950" });
    h.quote = { ok: false, reason: "not_found" };
    const nf = await call("addr-check");
    expect(said(nf)).toEqual(["We are sorry, we could not find that address. Let us try again."]);
    expect(redirect(nf)).toBe("addr-house");
  });
  it("the live line keeps the one address question until the drafts are approved", async () => {
    process.env.VERCEL_ENV = "production";
    expect(redirect(await call("addr"))).toBe("ask?f=address");
  });
  it("town slots: one per phrase; step 7 plays the town recording", async () => {
    const { allSlots } = await import("@/lib/recording-slots");
    const towns = allSlots().filter((x) => x.group === "Town").map((x) => x.text);
    expect(towns).toEqual(["Monroe New York", "Highland Mills New York", "Chester New York", "Washingtonville New York", "Central Valley New York", "Harriman New York", "Blooming Grove"]);
    const { wordSlotsFor } = await import("@/lib/spoken-words");
    expect(wordSlotsFor("Monroe New York")).toEqual(["town:monroe_new_york"]);
    const keys = allSlots().map((x) => x.key);
    for (const k of ["addr_rb_intro", "addr_rb_again", "addr_rb_correct", "addr_price#1", "addr_price#2", "addr_saved"]) expect(keys, k).toContain(k);
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The street step (Abraham, Nov 24, 2026, final): after the house number, unit and zip, "To search for the street name by
 * voice, press 1. To search it with your keypad, press 2." The search uses the street list of the zip entered.
 * In-memory database; the map lookup is a stand-in.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAstreet", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
import { closestStreet, spokenStreet, streetsByPrefix, streetsForZip } from "@/lib/street-search";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAstreet", ...body }, callSid: "CAstreet", from: "+18455550199" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const { db, schema } = await import("@/lib/db");
  const { reserveItem } = await import("@/lib/orders");
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 6500, quantity: 3, active: true }).returning();
  const r = await reserveItem({ orderId: null, productId: p.id, qty: 1, eventDate: "2026-12-07", channel: "PHONE", status: "HOLD" });
  if (r.ok) h.session.orderId = r.orderId;
  // Highland Mills (10930): the street list of that zip comes from the directory
  const row = (street: string) => ({ lastName: "Test", house: "1", street, town: "Highland Mills", zip: "10930" });
  await db.insert(schema.directoryEntries).values([row("SMITH CLOVE RD"), row("SMITH ST"), row("SMITHFIELD CT"), row("OAKWOOD TER"), row("PINE HILL RD"), row("PINE HILL RD")]);
});
beforeEach(() => {
  h.session.data = { name: "Sara Klein", house: "12", unit: "3", zip: "10930" };
  h.quote = { ok: true, zone: "Local", feeCents: 1000, kind: "local" };
  delete process.env.VERCEL_ENV;
});

describe("the street list of the zip", () => {
  it("the directory's streets for that zip, said aloud, once each; another zip with no directory rows = our whole list", async () => {
    expect(await streetsForZip("10930")).toEqual(["Oakwood Terrace", "Pine Hill Road", "Smith Clove Road", "Smith Street", "Smithfield Court"]);
    expect((await streetsForZip("10950")).length).toBeGreaterThan(300);
    expect(spokenStreet("ACRES RD")).toBe("Acres Road");
  });
});

describe("the street menu", () => {
  it("the approved line word for word, then the star line; no keypad-typing line; 1 voice, 2 keypad, star back to the zip", async () => {
    expect(PROMPTS.addr_street_menu.text).toBe("To search for the street name by voice, press 1. To search it with your keypad, press 2.");
    const menu = await call("addr-street");
    expect(said(menu)).toEqual([PROMPTS.addr_street_menu.text, "To go back, press star."]);
    expect(said(menu).join(" ")).not.toContain("press 9");
    expect(redirect(await call("addr-street-choice", { Digits: "1" }))).toBe("ask?f=street");
    expect(redirect(await call("addr-street-choice", { Digits: "2" }))).toBe("addr-street-keys");
    expect(redirect(await call("addr-street-choice", { Digits: "*" }))).toBe("addr-zip");
    const bad = await call("addr-street-choice", { Digits: "5" });
    expect(said(bad)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(bad)).toBe("addr-street");
  });
  it("the zip menu and a typed zip lead to the street menu", async () => {
    expect(redirect(await call("addr-zip-choice", { Digits: "2" }))).toBe("addr-street");
    expect(redirect(await call("addr-zip-heard", { Digits: "10930" }))).toBe("addr-street");
  });
});

describe("key 1: voice search", () => {
  it("plays the Address step 2 recording (no new line) then the tone", async () => {
    const ask = await call("ask", {}, "f=street");
    expect(said(ask)).toEqual([PROMPTS.addr_street.text]);
    expect(ask).toContain("/audio/tone.wav</Play></Gather>");
    expect(ask).toContain("Smith Clove Road"); // the zip's streets help the speech recognition
  });
  it("the closest street in the zip's list, read back: I heard: {street}. 1 confirms, 2 says it again", async () => {
    expect(redirect(await call("heard", { SpeechResult: "smith clove" }, "f=street"))).toBe("addr-street-rb?m=v");
    expect(h.session.data.heard).toBe("Smith Clove Road");
    expect(said(await call("addr-street-rb", {}, "m=v"))).toEqual(["I heard:", "Smith Clove Road", "If that is correct, press 1. To try again, press 2."]);
    expect(redirect(await call("addr-street-rb-choice", { Digits: "2" }, "m=v"))).toBe("ask?f=street");
    expect(redirect(await call("heard", { SpeechResult: "oak wood terrace" }, "f=street"))).toBe("addr-street-rb?m=v");
    expect(redirect(await call("addr-street-rb-choice", { Digits: "1" }, "m=v"))).toBe("addr-unit-ask"); // Nov 25, 2026: the unit after the street
    expect(h.session.data.street).toBe("Oakwood Terrace");
    expect(redirect(await call("addr-check"))).toBe("addr-readback");
    expect(h.session.data.address).toBe("12 Oakwood Terrace, 3, Highland Mills, NY 10930");
  });
  it("closest match: misheard words still find the street", () => {
    const list = ["Forest Avenue", "Forest Road", "Garfield Road", "Bakertown Road"];
    expect(closestStreet("forest road", list)).toBe("Forest Road");
    expect(closestStreet("garfeld rode", list)).toBe("Garfield Road");
    expect(closestStreet("baker town", list)).toBe("Bakertown Road");
  });
});

describe("key 2: keypad search, the first four letters", () => {
  it("the four-letter line (draft, preview) and the typing directions, then the tone", async () => {
    const xml = await call("addr-street-keys");
    expect(said(xml)).toEqual([PROMPTS.street_keys_intro.text, PROMPTS.type_instructions.text]);
    expect(xml).toContain('finishOnKey="#"');
  });
  it("one match: read back, 1 confirms, 2 tries again", async () => {
    expect(streetsByPrefix("oakw", await streetsForZip("10930"))).toEqual(["Oakwood Terrace"]);
    expect(redirect(await call("addr-street-typed", { Digits: "666255*9" }))).toBe("addr-street-rb?m=k"); // o a k w
    expect(said(await call("addr-street-rb", {}, "m=k"))).toEqual(["You typed:", "Oakwood Terrace", "If that is correct, press 1. To try again, press 2."]);
    expect(redirect(await call("addr-street-rb-choice", { Digits: "2" }, "m=k"))).toBe("addr-street-keys");
    expect(redirect(await call("addr-street-rb-choice", { Digits: "1" }, "m=k"))).toBe("addr-unit-ask");
    expect(h.session.data.street).toBe("Oakwood Terrace");
  });
  it("several matches: each street with its own key to press", async () => {
    expect(redirect(await call("addr-street-typed", { Digits: "77776444" + "8" }))).toBe("addr-street-pick"); // s m i t
    expect(said(await call("addr-street-pick"))).toEqual(["For Smith Clove Road, press 1.", "For Smith Street, press 2.", "For Smithfield Court, press 3.", "To go back, press star."]);
    expect(redirect(await call("addr-street-pick-choice", { Digits: "7" }))).toBe("addr-street-pick");
    expect(redirect(await call("addr-street-pick-choice", { Digits: "3" }))).toBe("addr-street-rb?m=k");
    expect(h.session.data.heard).toBe("Smithfield Court");
    expect(redirect(await call("addr-street-pick-choice", { Digits: "*" }))).toBe("addr-street-keys");
  });
  it("no match: try again (1) or switch to voice (2)", async () => {
    expect(redirect(await call("addr-street-typed", { Digits: "22*22*22" }))).toBe("addr-street-none"); // b b b
    expect(said(await call("addr-street-none"))).toEqual([PROMPTS.street_none.text, "To go back, press star."]);
    expect(redirect(await call("addr-street-none-choice", { Digits: "1" }))).toBe("addr-street-keys");
    expect(redirect(await call("addr-street-none-choice", { Digits: "2" }))).toBe("ask?f=street");
    expect(redirect(await call("addr-street-none-choice", { Digits: "*" }))).toBe("addr-street");
  });
  it("the live line while the new keypad lines wait for approval: no draft plays; the typed name is used as before", async () => {
    process.env.VERCEL_ENV = "production";
    expect(said(await call("addr-street-keys"))).toEqual([PROMPTS.type_instructions.text]);
    expect(redirect(await call("addr-street-typed", { Digits: "77776444" + "8" }))).toBe("addr-street-rb?m=k");
    expect(redirect(await call("addr-street-typed", { Digits: "22*22*22" }))).toBe("addr-street-rb?m=k");
  });
});

describe("star goes back", () => {
  it("from every part of the street step", async () => {
    expect(redirect(await call("addr-street-choice", { Digits: "*" }))).toBe("addr-zip");
    expect(redirect(await call("heard", { Digits: "*" }, "f=street"))).toBe("addr-street");
    expect(redirect(await call("addr-street-typed", { Digits: "*" }))).toBe("addr-street");
    expect(redirect(await call("addr-street-rb-choice", { Digits: "*" }, "m=v"))).toBe("addr-street");
    expect(redirect(await call("addr-unit-heard", { Digits: "*" }))).toBe("addr-street"); // Nov 25, 2026: the unit comes after the street
  });
});

describe("street not found on the map", () => {
  it("the house number, unit and zip are kept; only the street is asked again", async () => {
    Object.assign(h.session.data, { street: "Nowhere Lane" });
    h.quote = { ok: false, reason: "not_found" };
    const nf = await call("addr-check");
    expect(said(nf)).toEqual(["We are sorry, we could not find that address. Please try again."]);
    expect(redirect(nf)).toBe("addr-street");
    expect(h.session.data).toMatchObject({ house: "12", unit: "3", zip: "10930", street: undefined });
  });
});

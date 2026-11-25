import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Abraham, Nov 25, 2026: name rules (section 2), directory address match (section 3), and the unit step with the unit
 * question (section 4). In-memory database with a small test directory; the map lookup is a stand-in.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAdir", fromNumber: "+18455550301", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
  from: "+18455550301",
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
vi.mock("@/lib/delivery-areas", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery-areas")>()), deliveryQuote: async () => ({ ok: true, zone: "Local", feeCents: 1000, kind: "local" }) }));

import { db, schema } from "@/lib/db";
import { handleVoice, NO_KEY_END_MS } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { entriesWithoutUnit, matchDirectoryAddress } from "@/lib/directory";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAdir", ...body }, callSid: "CAdir", from: h.from });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.VERCEL_ENV = "preview"; // the directory lookup runs on preview
  const { reserveItem } = await import("@/lib/orders");
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 6500, quantity: 3, active: true }).returning();
  const r = await reserveItem({ orderId: null, productId: p.id, qty: 1, eventDate: "2026-12-07", channel: "PHONE", status: "HOLD" });
  if (r.ok) h.session.orderId = r.orderId;
  const row = (lastName: string, firstName: string, house: string, street: string, unit: string | null, zip: string, phone: string | null) => ({ lastName, firstName, house, street, unit, town: "Monroe", zip, phone });
  await db.insert(schema.directoryEntries).values([
    row("Schwartz", "Avram", "12", "FOREST RD", null, "10950", "+18455550301"),
    row("Klein", "", "7", "ACRES RD", null, "10950", "+18455550302"),
    row("Weiss", "Moshe", "5", "SATMAR DR", "2", "10950", "+18455550303"),
    row("Gross", "Yoel", "5", "SATMAR DR", "3", "10950", null),
  ]);
});
beforeEach(() => {
  h.from = "+18455550301";
  h.session.data = {};
});

describe("section 2: lookup callers are never asked their name; the household name as the directory has it", () => {
  it("lookup by the calling number, found: no name question; the order name is Schwartz, Avram", async () => {
    expect(redirect(await call("addr-lookup-choice", { Digits: "1" }))).toBe("addr-found");
    await call("addr-found");
    const x = await call("addr-found-choice", { Digits: "1" }, "m=one&n=1");
    expect(redirect(x)).toBe("addr-check?dir=1");
    expect(h.session.data).toMatchObject({ name: "Schwartz, Avram", nameFromDirectory: true });
    expect(x).not.toContain("say your first and last name");
  });
  it("press 2, a different listed number, last-name-only entry: the order name is just Klein", async () => {
    expect(redirect(await call("addr-phone-heard", { Digits: "8455550302" }))).toBe("addr-found");
    expect(redirect(await call("addr-found-choice", { Digits: "1" }, "m=one&n=1"))).toBe("addr-check?dir=1");
    expect(h.session.data.name).toBe("Klein");
  });
  it("press 3, address entered by hand: the name is asked once", async () => {
    expect(redirect(await call("addr-lookup-choice", { Digits: "3" }))).toBe("ask?f=name");
  });
});

describe("section 3: directory address match for an address entered by hand", () => {
  it("short forms, capitals and spaces: 12 forest road = 12 FOREST RD; the household name is used, the caller's kept", async () => {
    h.session.data = { name: "Sara Klein", house: "12", street: "Forest  road", zip: "10950" };
    expect(redirect(await call("addr-check"))).toBe("addr-readback");
    expect(h.session.data).toMatchObject({ name: "Schwartz, Avram", nameFromDirectory: true, callerName: "Sara Klein" });
    // no new spoken line for a match: the same read-back
    expect(said(await call("addr-readback"))[0]).toBe("Here is the address you entered.");
  });
  it("each unit is its own household: unit 2 = Weiss, unit 3 = Gross, unit 4 = no match", async () => {
    expect((await matchDirectoryAddress({ house: "5", street: "Satmar Drive", unit: "2", zip: "10950" }))?.lastName).toBe("Weiss");
    expect((await matchDirectoryAddress({ house: "5", street: "satmar dr.", unit: "Apt 3", zip: "10950" }))?.lastName).toBe("Gross");
    expect(await matchDirectoryAddress({ house: "5", street: "Satmar Drive", unit: "4", zip: "10950" })).toBeNull();
    expect(await matchDirectoryAddress({ house: "5", street: "Satmar Drive", unit: null, zip: "10950" })).toBeNull();
  });
  it("wrong zip: no match, the caller's own name stays", async () => {
    h.session.data = { name: "Sara Klein", house: "12", street: "Forest Road", zip: "10930" };
    await call("addr-check");
    expect(h.session.data).toMatchObject({ name: "Sara Klein" });
    expect(h.session.data.nameFromDirectory).toBeUndefined();
  });
  it("the street by voice with the other parts matching: a match (Weiss, unit 2)", async () => {
    h.session.data = { name: "Sara Klein", house: "5", zip: "10950" };
    expect(redirect(await call("heard", { SpeechResult: "satmar drive" }, "f=street"))).toBe("addr-street-rb?m=v");
    expect(redirect(await call("addr-street-rb-choice", { Digits: "1" }, "m=v"))).toBe("addr-unit-ask");
    expect(redirect(await call("addr-unit-ask"))).toBe("addr-unit"); // a household at that house: the unit step, required
    expect(redirect(await call("addr-unit-heard", { Digits: "2", FinishedOnKey: "#" }))).toBe("addr-check");
    await call("addr-check");
    expect(h.session.data.name).toBe("Weiss, Moshe");
  });
  it("not in the directory: no match, the caller's name", async () => {
    h.session.data = { name: "Sara Klein", house: "99", street: "Nowhere Lane", zip: "10950" };
    await call("addr-check");
    expect(h.session.data.name).toBe("Sara Klein");
  });
  it("the address changed after a match: back to the caller's own name", async () => {
    h.session.data = { name: "Sara Klein", house: "12", street: "Forest Road", zip: "10950" };
    await call("addr-check");
    expect(h.session.data.name).toBe("Schwartz, Avram");
    Object.assign(h.session.data, { house: "14" });
    await call("addr-check");
    expect(h.session.data.name).toBe("Sara Klein");
  });
  it("entries with no unit are counted (shown to Abraham)", async () => {
    expect(await entriesWithoutUnit()).toBe(2);
  });
});

describe("section 4: the unit step (no skip) and the unit question", () => {
  it("address in the directory: the unit question does not play; the unit step has no skip line; pound alone is not valid", async () => {
    h.session.data = { house: "5", street: "Satmar Drive", zip: "10950" };
    expect(redirect(await call("addr-unit-ask"))).toBe("addr-unit");
    const unit = said(await call("addr-unit"));
    expect(unit).toEqual(["Thanks, with your keypad, please enter the unit number.", "When you are done, press pound.", "To go back, press star."]);
    expect(unit.join(" ")).not.toContain("skip");
    const pound = await call("addr-unit-heard", { Digits: "", FinishedOnKey: "#" });
    expect(said(pound)).toEqual([PROMPTS.not_valid.text]);
    expect(redirect(pound)).toBe("addr-unit");
  });
  it("not in the directory: the approved question; key 1 = the unit step (no skip); key 2 = no unit, flagged", async () => {
    h.session.data = { house: "99", street: "Nowhere Lane", zip: "10950" };
    const q = await call("addr-unit-ask");
    expect(said(q)).toEqual(["If this address has a unit number, press 1. If not, press 2.", "To go back, press star."]);
    expect(redirect(await call("addr-unit-ask-choice", { Digits: "1" }))).toBe("addr-unit?a=1");
    expect(redirect(await call("addr-unit-heard", { Digits: "*" }, "a=1"))).toBe("addr-unit-ask");
    expect(redirect(await call("addr-unit-ask-choice", { Digits: "2" }))).toBe("addr-check");
    expect(h.session.data).toMatchObject({ unitUnverified: true, unit: undefined });
  });
  it("on the question: key 5 not valid, no key = the no-choice line, 1 minute = goodbye, star = back to the street", async () => {
    const bad = await call("addr-unit-ask-choice", { Digits: "5" });
    expect(said(bad)).toEqual([PROMPTS.not_valid.text]);
    expect(redirect(bad)).toBe("addr-unit-ask");
    h.session.data = { house: "99", street: "Nowhere Lane", zip: "10950" };
    const q = await call("addr-unit-ask");
    expect(redirect(q)).toMatch(/^idle\?to=addr-unit-ask/);
    const noKey = await call("idle", {}, `to=addr-unit-ask&nk=${Date.now()}`);
    expect(said(noKey)).toEqual(["We did not get your choice. Please try again."]);
    const end = await call("idle", {}, `to=addr-unit-ask&nk=${Date.now() - NO_KEY_END_MS - 1000}`);
    expect(end).toContain("<Hangup/>");
    expect(redirect(await call("addr-unit-ask-choice", { Digits: "*" }))).toBe("addr-street");
  });
  it("the flag reaches the order: Unit not verified on the order page and in the orders list", async () => {
    const { eq } = await import("drizzle-orm");
    await db.update(schema.orders).set({ unitNotVerified: true, deliveryAddress: "99 Nowhere Lane, Monroe, NY 10950" }).where(eq(schema.orders.id, h.session.orderId!));
    const { listOrders } = await import("@/lib/admin-queries");
    const rows = await listOrders({ status: "ALL" as never });
    expect(rows.find((r) => r.id === h.session.orderId)?.unit_not_verified).toBe(true);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/admin/(app)/orders/page.tsx", "utf8")).toContain("Unit not verified");
    expect(readFileSync("src/app/admin/(app)/orders/[id]/OrderActions.tsx", "utf8")).toContain("Unit not verified");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain("unitNotVerified: Boolean(data.unitUnverified)");
  });
  it("the old skip line is retired (Not used in Admin), its file kept", async () => {
    const { RETIRED_PROMPTS } = await import("@/lib/ivr/prompts");
    expect(RETIRED_PROMPTS.has("addr_unit_skip")).toBe(true);
    expect(PROMPTS.addr_unit_skip).toBeDefined();
  });
});

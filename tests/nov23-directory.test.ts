import { beforeAll, describe, expect, it, vi } from "vitest";

/* The phone-number address lookup (Abraham, Nov 23, 2026, approved screens; preview only). Made-up entries. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAdir", fromNumber: "+18455550401", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  from: "+18455550401",
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

const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAdir", ...body }, callSid: "CAdir", from: h.from });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const STAR = "To go back, press star.";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.DIRECTORY_LOOKUP = "on";
  const { parseDirectoryCsv } = await import("@/lib/directory-list");
  const { loadDirectory } = await import("@/lib/directory");
  const csv = [
    "last name,first name,house number,street,unit,town/state/zip,phone,area as printed",
    'Sample,Chaim,10,D A WIEDER BLVD,301,"Monroe, NY 10950",555-0401,Kiryas Joel',
    'Example,Moshe,29,DALLAS DR,001,"Monroe, NY 10950",555-0402,Monroe',
    'Testing,Yoel,380,LAKE SHORE DR,,"Monroe, NY 10950",555-0402,Blooming Grove',
    'Nophone,Leib,5,ACRES RD,,"Monroe, NY 10950",,Monroe',
  ].join("\n");
  const r = parseDirectoryCsv(csv);
  expect(r.rows).toHaveLength(4); // the row with no phone is kept
  expect(await loadDirectory(r.rows)).toBe(4);
});

describe("phone-number address lookup (approved screens, preview)", () => {
  it("screen 1: three choices and the star line", async () => {
    h.session.data = { name: "Sample Caller" };
    expect(redirect(await call("addr"))).toBe("addr-lookup");
    expect(said(await call("addr-lookup"))).toEqual(["Next, we need the delivery address.", "To look it up with the number you are calling from, press 1. To look it up with a different phone number, press 2. To enter the address manually, press 3.", STAR]);
    expect(redirect(await call("addr-lookup-choice", { Digits: "3" }))).toBe("addr-house");
    expect(redirect(await call("addr-lookup-choice", { Digits: "*" }))).toBe("ask?f=name");
  });
  it("1. the number calling, one family: hold line, name and address, confirm, saved, then the delivery price", async () => {
    h.from = "+18455550401";
    const hold = await call("addr-lookup-choice", { Digits: "1" });
    expect(said(hold)).toEqual(["Please hold a moment while we look up the address."]);
    expect(redirect(hold)).toBe("addr-found");
    expect(said(await call("addr-found"))).toEqual([
      "Here is the name and address we found for this phone number.",
      "Sample, Chaim.",
      "ten", "D A Wieder Boulevard", "unit", "three zero one", "Monroe New York", "one zero nine five zero",
      "If that is correct, press 1.", "To try a different phone number, press 2.", "To enter the address manually, press 3.", STAR,
    ]);
    expect(redirect(await call("addr-found-choice", { Digits: "1" }, "m=one&n=1"))).toBe("addr-check?dir=1");
    expect(h.session.data).toMatchObject({ house: "10", street: "D A WIEDER BLVD", unit: "301", zip: "10950", dirPick: "10 D A Wieder Boulevard, unit 301" });
    // Menu 2 (Nov 24, 2026, 20:56): one line right after the confirm
    const saved = await call("addr-check", {}, "dir=1");
    expect(said(saved)).toEqual([]);
    expect(redirect(saved)).toBe("addr-price");
    expect(said(await call("addr-price"))).toEqual(["Your delivery address has been saved, delivery to Monroe New York is 10 dollars."]);
    expect(redirect(await call("addr-found-choice", { Digits: "2" }, "m=one&n=1"))).toBe("addr-phone");
    expect(h.session.data.name).toBe("Sample, Chaim"); // the order name from the directory (Nov 23, 2026)
    expect(redirect(await call("addr-found-choice", { Digits: "3" }, "m=one&n=1"))).toBe("ask?f=name"); // manually: the name first
  });
  it("2. a different number, a shared number: each family, the caller picks; 3 = another number, 4 = manually", async () => {
    expect(said(await call("addr-phone"))).toEqual(["Please enter a 10-digit phone number, starting with the area code.", "When you are done, press pound.", STAR]);
    const bad = await call("addr-phone-heard", { Digits: "555040" });
    expect(said(bad)).toEqual(["The phone number you entered is not valid. Please try again."]);
    expect(redirect(bad)).toBe("addr-phone");
    expect(said(await call("addr-phone-heard", { Digits: "8455550402" }))).toEqual(["Please hold a moment while we look up the address."]);
    const lines = said(await call("addr-found"));
    expect(lines[0]).toBe("Here is what we found for this phone number.");
    expect(lines.slice(1, 9)).toEqual(["For Example, Moshe,", "twenty nine", "Dallas Drive", "unit", "zero zero one", "Monroe New York", "one zero nine five zero", "press 1."]);
    expect(lines).toContain("Blooming Grove");
    expect(lines.slice(-2)).toEqual(["To try a different phone number, press 3. To enter the address manually, press 4.", STAR]); // slot B, one take
    expect(redirect(await call("addr-found-choice", { Digits: "2" }, "m=many&n=2"))).toBe("addr-check?dir=1");
    expect(h.session.data).toMatchObject({ house: "380", dirArea: "Blooming Grove", dirPick: "380 Lake Shore Drive" });
    expect(redirect(await call("addr-found-choice", { Digits: "3" }, "m=many&n=2"))).toBe("addr-phone");
    expect(redirect(await call("addr-found-choice", { Digits: "4" }, "m=many&n=2"))).toBe("ask?f=name");
  });
  it("3. not found: the line, 1 = another number, 2 = manually", async () => {
    await call("addr-phone-heard", { Digits: "8455550499" });
    expect(said(await call("addr-found"))).toEqual(["We could not find an address for this phone number.", "To try a different phone number, press 1.", "To enter the address manually, press 2.", STAR]);
    expect(redirect(await call("addr-found-choice", { Digits: "1" }, "m=none&n=0"))).toBe("addr-phone");
    expect(redirect(await call("addr-found-choice", { Digits: "2" }, "m=none&n=0"))).toBe("ask?f=name");
  });
  it("no key: the shared no-key rule (we did not get your choice, then the same screen)", async () => {
    expect(redirect(await call("addr-found"))).toMatch(/^idle\?to=addr-found/);
  });
  it("Nov 23, 2026: the lookup comes before the name; a found family gives the name, no name question", async () => {
    // found: checkout goes straight to the lookup; the caller confirms; no name question; the name is on the order data
    h.from = "+18455550401";
    h.session.data = {};
    const start = await call("cart-choice", { Digits: "1" });
    expect(redirect(start)).toBe("addr-lookup");
    expect(redirect(await call("addr-lookup-choice", { Digits: "*" }))).toBe("cart"); // star: back to the cart
    await call("addr-lookup-choice", { Digits: "1" });
    expect(redirect(await call("addr-found-choice", { Digits: "1" }, "m=one&n=1"))).toBe("addr-check?dir=1");
    expect(h.session.data).toMatchObject({ name: "Sample, Chaim", nameFromDirectory: true, lookupDone: true });
    // not found: manually, the name first (box 31), then the house number, not the lookup again
    h.session.data = {};
    await call("cart-choice", { Digits: "1" });
    await call("addr-phone-heard", { Digits: "8455550499" });
    expect(redirect(await call("addr-found-choice", { Digits: "2" }, "m=none&n=0"))).toBe("ask?f=name");
    h.session.data = { ...h.session.data, name: "Moshe Klein" }; // the name step's answer (box 31, tested elsewhere)
    expect(redirect(await call("addr"))).toBe("addr-house"); // the lookup is not asked again
  });
  it("off on the live line until Abraham approves the test call", async () => {
    const { directoryLookupOn } = await import("@/lib/ivr/flow");
    expect(directoryLookupOn({ VERCEL_ENV: "production" })).toBe(false);
    expect(directoryLookupOn({ VERCEL_ENV: "preview" })).toBe(true);
  });
  it("the shared-number alert names the address the caller chose", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/shared-phones.ts", "utf8")).toContain("`Caller chose ${input.chosen}`");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain("chosen: data.dirPick ?? null");
  });
  it("Weider and Wieder find the same street slot (072)", async () => {
    const { findStreet, streetSlotKey } = await import("@/lib/streets");
    expect(streetSlotKey(findStreet("D A Weider Boulevard")!.spoken)).toBe("street:d_a_wieder_boulevard");
    expect(streetSlotKey(findStreet("D A WIEDER BLVD")!.spoken)).toBe("street:d_a_wieder_boulevard");
  });
  it("the directory page and its actions are Owner only", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["page.tsx", "actions.ts"]) expect(readFileSync(`src/app/admin/(app)/customers/directory/${f}`, "utf8")).toContain("await requireOwner()");
  });
});

describe("slots A, B and C (Nov 23, 2026)", () => {
  it("are in Admin with the exact text, ready for Hark's uploads", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.lookup_many.text).toBe("Here is what we found for this phone number.");
    expect(PROMPTS.lookup_many.label).toMatch(/^Slot A/);
    expect(PROMPTS.lookup_many_options.text).toBe("To try a different phone number, press 3. To enter the address manually, press 4.");
    expect(PROMPTS.lookup_many_options.label).toMatch(/^Slot B/);
    expect(PROMPTS.addr_zip.label).toBe("Slot C - Zip menu, all towns, press 1 to 7 (one take)");
    const { allSlots } = await import("@/lib/recording-slots");
    const keys = allSlots([]).map((x) => x.key);
    for (const k of ["lookup_many", "lookup_many_options", "addr_zip", "lookup_for#1"]) expect(keys, k).toContain(k);
  });
});

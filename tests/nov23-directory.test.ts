import { beforeAll, describe, expect, it, vi } from "vitest";

/* The directory lookup by caller ID (Abraham, Nov 23, 2026; preview only, draft lines in Puck). Made-up entries. */
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

describe("directory lookup by caller ID (preview)", () => {
  it("1. a matching number: the address on file, read with the step 6 pieces; 1 = that address, then the delivery price", async () => {
    h.from = "+18455550401";
    h.session.data = { name: "Sample Caller" };
    expect(redirect(await call("addr"))).toBe("addr-dir");
    const lines = said(await call("addr-dir"));
    expect(lines).toEqual(["We have an address on file for the number you are calling from.", "ten", "D A Wieder Boulevard", "unit", "three zero one", "Monroe New York", "one zero nine five zero", "If that is the delivery address, press 1. To enter a different address, press 2.", "To go back, press star."]);
    expect(redirect(await call("addr-dir-choice", { Digits: "1" }, "m=0"))).toBe("addr-check?dir=1");
    expect(h.session.data).toMatchObject({ house: "10", street: "D A WIEDER BLVD", unit: "301", zip: "10950" });
    expect(redirect(await call("addr-check", {}, "dir=1"))).toBe("addr-price"); // no second read-back
    expect(redirect(await call("addr-dir-choice", { Digits: "2" }, "m=0"))).toBe("addr-house");
  });
  it("2. a shared number: each address, then the caller picks; Blooming Grove said before Monroe New York", async () => {
    h.from = "+18455550402";
    const lines = said(await call("addr-dir"));
    expect(lines[0]).toBe("We have more than one address on file for the number you are calling from.");
    expect(lines.slice(1, 9)).toEqual(["twenty nine", "Dallas Drive", "unit", "zero zero one", "Monroe New York", "one zero nine five zero", "For this address, press 1.", "three hundred eighty"]);
    expect(lines).toContain("Blooming Grove");
    expect(lines.slice(-3)).toEqual(["For this address, press 2.", "To enter a different address, press 0.", "To go back, press star."]);
    expect(redirect(await call("addr-dir-choice", { Digits: "2" }, "m=1"))).toBe("addr-check?dir=1");
    expect(h.session.data).toMatchObject({ house: "380", street: "LAKE SHORE DR", dirArea: "Blooming Grove" });
    expect(redirect(await call("addr-dir-choice", { Digits: "0" }, "m=1"))).toBe("addr-house");
    const { isSharedNumber } = await import("@/lib/shared-phones");
    expect(await isSharedNumber("+18455550402")).toBe(true);
    expect(await isSharedNumber("+18455550401")).toBe(false);
  });
  it("3. a number not in the list: straight to the usual address steps; nothing is read", async () => {
    h.from = "+18455550499";
    expect(redirect(await call("addr"))).toBe("addr-house");
    expect(redirect(await call("addr-dir"))).toBe("addr-house");
  });
  it("off on the live line until Abraham approves the lines", async () => {
    const { directoryLookupOn } = await import("@/lib/ivr/flow");
    expect(directoryLookupOn({ VERCEL_ENV: "production" })).toBe(false);
    expect(directoryLookupOn({ VERCEL_ENV: "preview" })).toBe(true);
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

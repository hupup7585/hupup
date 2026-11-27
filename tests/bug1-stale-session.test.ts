import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark's bug check (Nov 26, 2026), bug 1: a second session write in the same step (ocean balls after the first
 * balloon) put back the OLD cart data, so box 25 named the item added before, and a rental day could drop out of the
 * cart. Uses the real session store (no stand-in), the way a live call does. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), bookingLock: () => ({ locked: false }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { getSession } from "@/lib/ivr/session";
import { PROMPTS } from "@/lib/ivr/prompts";

const SID = "CAbug1stale";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, From: "+18455550190", ...body }, callSid: SID, from: "+18455550190" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
async function follow(action: string, q = "") {
  let xml = await call(action, {}, q);
  for (let i = 0; i < 8 && !xml.includes("<Gather"); i++) {
    const to = redirect(xml);
    if (!to) break;
    const [a, qs = ""] = to.split("?");
    xml = await call(a, {}, qs);
  }
  return xml;
}
const ids = { guns6: 0, balloon: 0, balloon2: 0 };
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  const [balloons] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  ids.guns6 = (await db.insert(schema.products).values({ categoryId: laser.id, name: "Only 6 laser guns", priceCents: 11000, quantity: 3, active: true }).returning())[0].id;
  ids.balloon = (await db.insert(schema.products).values({ categoryId: balloons.id, name: "Bounce Blast", priceCents: 19500, quantity: 3, active: true }).returning())[0].id;
  ids.balloon2 = (await db.insert(schema.products).values({ categoryId: balloons.id, name: "Soft Hop", priceCents: 16500, quantity: 3, active: true }).returning())[0].id;
  await call("incoming");
});

describe("bug 1: the added line and the cart after the first balloon", () => {
  it("laser set first, then the first balloon: box 25 names the balloon, then the ocean balls offer", async () => {
    await follow("add", `p=${ids.guns6}&d=2027-01-12&q=1`);
    const xml = await follow("add", `p=${ids.balloon}&d=2027-01-12&q=1`);
    const s = said(xml).join(" ");
    expect(s).toContain("Successfully added to your cart: 1 Bounce Blast");
    expect(s).not.toContain("Only 6 laser guns");
    expect(s).toContain(PROMPTS.ocean_offer.text);
    const sess = await getSession(SID);
    expect(sess?.data.lastAdded?.name).toBe("Bounce Blast");
    expect(sess?.data.oceanOffered).toBe(true);
  });
  it("a balloon that opens a new rental day keeps that day in the cart after another day is added", async () => {
    const before = (await getSession(SID))!.data.dayOrderIds ?? [];
    await follow("add", `p=${ids.balloon2}&d=2027-01-19&q=1`);
    const after = (await getSession(SID))!.data.dayOrderIds ?? [];
    expect(after.length).toBe(before.length + 1);
    await follow("add", `p=${ids.guns6}&d=2027-01-26&q=1`);
    const all = (await getSession(SID))!.data.dayOrderIds ?? [];
    expect(all).toEqual(expect.arrayContaining(after));
    expect(all.length).toBe(after.length + 1);
  });
});

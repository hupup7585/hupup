import { describe, expect, it, vi } from "vitest";

/* Address tries (Abraham, Nov 27, 2026, 12:47 AM): after 5 failed tries the caller goes back to the address-method
   menu (never customer service); choosing a method again starts the count over; a good try saves normally. */
const h = vi.hoisted(() => ({ found: false, session: { callSid: "CAaddr", fromNumber: "+18455550313", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
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
vi.mock("@/lib/delivery-areas", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery-areas")>()), deliveryQuote: async () => (h.found ? { ok: true, zone: "Kiryas Joel", feeCents: 1000, kind: "local" } : { ok: false, reason: "not_found" }) }));

import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string, body: Record<string, string> = {}) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CAaddr", ...body }, callSid: "CAaddr", from: "+18455550313" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const tryAddress = () => {
  h.session.data = { ...h.session.data, house: "12", street: "Forest Road", zip: "10950" };
  return call("addr-check");
};

describe("address tries", () => {
  it("5 failed tries: back to the address-method menu, the count starts over", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    delete process.env.VERCEL_ENV; // preview: the lookup menu is on
    h.found = false;
    for (let i = 1; i <= 4; i++) expect(redirect(await tryAddress())).toBe("addr-street");
    expect(h.session.data.addrFails).toBe(4);
    const fifth = redirect(await tryAddress());
    expect(["addr-lookup", "addr-house"]).toContain(fifth);
    expect(h.session.data.addrFails).toBe(0);
    expect(h.session.data.address).toBeUndefined(); // never saved as "not found"
  });
  it("a good try on the 3rd saves normally", async () => {
    h.session.data = {};
    h.found = false;
    await tryAddress();
    await tryAddress();
    h.found = true;
    const ok = await tryAddress();
    expect(redirect(ok)).not.toBe("addr-street");
    expect(h.session.data.address).toBe("12 Forest Road, Monroe, NY 10950");
  });
  it("choosing a method again starts the count over", async () => {
    h.session.data = { addrFails: 3 };
    await call("addr-lookup-choice", { Digits: "3" });
    expect(h.session.data.addrFails).toBe(0);
  });
});

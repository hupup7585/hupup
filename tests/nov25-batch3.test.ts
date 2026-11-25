import { beforeEach, describe, expect, it, vi } from "vitest";

/* Batch 3 (Abraham, Nov 25, 2026, 00:52): code-only fixes from a caller walk-through. No spoken wording changes. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAb3", fromNumber: "+18455550199", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: { data?: Record<string, unknown> } & Record<string, unknown>) => {
    const { data, ...rest } = patch;
    Object.assign(h.session, rest);
    if (data) h.session.data = { ...h.session.data, ...data };
  },
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAb3", ...body }, callSid: "CAb3", from: "+18455550199" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^https?:\/\/[^/]+\/api\/voice\//, "").replace(/&amp;/g, "&");

beforeEach(() => {
  h.session.data = {};
});

describe("Batch 3", () => {
  it("item 9: cart key 2 (keep shopping) goes to the categories menu, or back to the list the caller came from", async () => {
    expect(redirect(await call("cart-choice", { Digits: "2" }))).toBe("cats");
    expect(redirect(await call("cart-choice", { Digits: "2" }, "c=3"))).toBe("category?c=3");
  });
  it("item 10: box 25 with no key plays box 25 again (keeping n), not the cart", async () => {
    const menu = await call("added-menu", {}, "n=1");
    const r = redirect(menu)!;
    expect(r).toMatch(/^idle\?/);
    expect(r).toContain("to=added-menu");
    expect(r).toContain("q=n%3D1"); // the n flag rides along to the screen played again
    expect(menu).toContain("after-add?n=1");
    const after = redirect(await call("after-add", {}, "n=1"))!;
    expect(after).toContain("to=added-menu");
    expect(after).not.toContain("to=cart");
  });
  it("item 26a: box 18 with no second-day offer (t=0): 2 acts like 3, a different date", async () => {
    expect(redirect(await call("box18-choice", { Digits: "2" }, "p=5&d=2027-01-08&t=0"))).toBe("date?p=5");
  });
  it("item 26b: a switched-off extension box takes the message in the Main box", async () => {
    const { boxForKey, mainBox } = await import("@/lib/voicemail");
    const ext = await boxForKey("4", "Deliveries");
    await db.update(schema.voicemailBoxes).set({ enabled: false }).where(eq(schema.voicemailBoxes.id, ext.id));
    const main = await mainBox();
    const xml = await call("voicemail", {}, "x=4");
    expect(xml).not.toContain("operator_unavailable");
    expect(xml).not.toMatch(/<Redirect[^>]*>[^<]*\/menu</);
    expect(h.session.data.vmEntry).toBeUndefined(); // the Main box, not extension 4
    expect(main.enabled).toBe(true);
    // Main switched off too: the unavailable line and the menu
    await db.update(schema.voicemailBoxes).set({ enabled: false }).where(eq(schema.voicemailBoxes.id, main.id));
    expect(redirect(await call("voicemail", {}, "x=4"))).toBe("menu");
  });
});

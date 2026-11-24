import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham's hotline and payment fixes (Nov 17, 2026). In-memory database; nothing is dialed or sent. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAn17", fromNumber: "+18457777585", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, patch, patch.data ? { data: { ...h.session.data, ...patch.data } } : {}),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";

/** A cart on this call, so the checkout questions run. */
async function withCart() {
  const [o] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2026-12-01", pickupDate: "2026-12-02", callSid: "CAn17" }).returning();
  const [cat] = await db.insert(schema.categories).values({ name: "Jumping Balloons", sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 10000, quantity: 1, active: true, sortOrder: 1 }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 10000 });
  h.session.data = { dayOrderIds: [o.id] };
  h.session.orderId = o.id as unknown as null;
}
import { spellOut, spokenEmail, spokenLetters } from "@/lib/ivr/catalog-keys";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAn17", ...body }, callSid: "CAn17", from: "+18457777585" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

describe("catalog email: dot only where the address has one", () => {
  it("speech comes back punctuated (Y. O. S. S. I.): those periods are not dots", () => {
    expect(spokenLetters("Y. O. S. S. I.")).toBe("yossi");
    expect(spokenLetters("j o h n dot s m i t h.")).toBe("john.smith");
    expect(spokenLetters("M, E, N, D, Y.")).toBe("mendy");
    expect(spellOut(spokenLetters("Y. O. S. S. I."))).toBe("y o s s i");
    expect(spokenEmail("john.smith@gmail.com")).toBe("j o h n dot s m i t h at gmail dot com");
  });
  it("the first half is read back right away, before the ending", async () => {
    h.session.data = { catLocal: "yossi" };
    const x = await call("catalog-got", {}, "part=local");
    expect(said(x)[0]).toBe("We got y o s s i. To continue, press pound. To start over, press 1. To add more, press 2.");
    expect(redirect(await call("catalog-got-choice", { Digits: "#" }, "part=local"))).toBe("catalog-ending");
  });
});

describe("pound to continue", () => {
  it("the pound line (approved Nov 17) plays on the live line and in keypad typing", async () => {
    await withCart();
    // Abraham, Nov 24, 2026: the spoken question, then type_hint (9 to type); the pound line is in the typing directions
    const preview = await call("ask", {}, "f=name");
    expect(said(preview)).toEqual(["Let us complete your booking. Please say your first and last name after the tone.", "To type it with your keypad, press 9."]);
    process.env.VERCEL_ENV = "production";
    const live = await call("ask", {}, "f=name");
    delete process.env.VERCEL_ENV;
    expect(said(live)).toContain("To type it with your keypad, press 9.");
    expect(said(await call("type", {}, "f=name")).some((s) => s.endsWith("When you are finished, press the pound key."))).toBe(true); // type_instructions, Nov 24, 2026
  });
  it("pound in the middle of a spoken answer ends it and keeps what was said", async () => {
    await withCart();
    const ask = await call("ask", {}, "f=name");
    expect(ask).toContain("partialResultCallback=");
    await call("speech-partial", { StableSpeechResult: "Yossi", UnstableSpeechResult: "Friedman" });
    expect(h.session.data.speechPartial).toBe("Yossi Friedman");
    const x = await call("heard", { Digits: "#" }, "f=name");
    expect(h.session.data.heard).toBe("Yossi Friedman");
    expect(x).toContain("/api/voice/confirm?f=name");
  });
});

describe("payment Thank you page", () => {
  it("new website logo on white and the brand colors; no old /logo.svg anywhere", () => {
    const page = readFileSync("src/app/paid/page.tsx", "utf8");
    expect(page).not.toContain("/logo.svg");
    expect(page).toContain("HEADER_LOGO");
    for (const c of ["#FFD84D", "#8CCBFF", "#123D73"]) expect(page).toContain(c);
    expect(page).toContain("Payment did not go through");
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Key 8: our catalog by email or text (Abraham, Nov 11, 2026). Proposed step wording: Owner's test calls only. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAcat", fromNumber: "+18457777585", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  emails: [] as { to: string; subject: string; text: string }[],
  sms: [] as string[],
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
vi.mock("@/lib/notify", () => ({
  sendSms: async (_to: string, body: string) => (h.sms.push(body), { sent: true }),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
}));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { catalogEmail } from "@/lib/catalog-send";

const OWNER = "+18457777585";
const call = (action: string, body: Record<string, string> = {}, query = "", from = OWNER) =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAcat", ...body }, callSid: "CAcat", from });
const plain = (x: string) => x.replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.ADMIN_PHONE = OWNER;
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "bounce houses and jumping balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", description: "A big castle with a slide.", priceCents: 20000, quantity: 2, active: true, sortOrder: 1 });
});
beforeEach(() => {
  h.emails.length = 0;
  h.sms.length = 0;
  h.session.data = {};
});

describe("key 8: catalog (Abraham, Phone Menu v3)", () => {
  it("live for every caller: 1 text, 2 email, star back", async () => {
    const xml = plain(await call("catalog", {}, "", "+18455550100"));
    expect(xml).toContain("To receive our catalog by text, press 1. To get it by email, press 2. To go back, press star.");
    expect(redirect(await call("catalog-choice", { Digits: "*" }))).toBe("menu");
    expect(redirect(await call("catalog-choice", { Digits: "2" }))).toBe("catalog-email");
  });
  it("email by keypad: the first part, the ending, the final check; 1 sends the catalog from Admin, logged on the contact", async () => {
    expect(redirect(await call("catalog-email"))).toBe("catalog-part?part=local");
    const part = plain(await call("catalog-part", {}, "part=local"));
    expect(part).toContain("Please enter the first part of your email address, up to the at symbol.");
    expect(part).toContain("/audio/tone.wav"); // no key: the tone, then spoken letters
    expect(part.indexOf("tone.wav")).toBeGreaterThan(part.indexOf("first part"));
    // 9 9 9 = y, 6 6 6 = o, 7 7 7 7 = s, star, 7 7 7 7 = s, 4 4 4 = i (the first 9 came in the first step)
    const typing = plain(await call("catalog-key", { Digits: "9" }, "part=local"));
    expect(typing).toContain("To type, press each key once, twice, or three times for its letter.");
    expect(redirect(await call("catalog-typed", { Digits: "996667777*7777444" }, "part=local"))).toBe("catalog-got?part=local");
    expect(plain(await call("catalog-got", {}, "part=local"))).toContain("We got y o s s i. To continue, press pound. To start over, press 1. To add more, press 2.");
    expect(redirect(await call("catalog-got-choice", { Digits: "#" }, "part=local"))).toBe("catalog-ending");
    expect(plain(await call("catalog-ending"))).toContain("For at gmail dot com, press 1.");
    expect(redirect(await call("catalog-ending-choice", { Digits: "1" }))).toBe("catalog-final");
    expect(plain(await call("catalog-final"))).toContain("Your email address is y o s s i, at gmail dot com. If that's correct, press 1. To start over, press 2.");
    const done = plain(await call("catalog-final-choice", { Digits: "1" }));
    expect(done).toContain("We just emailed you our catalog!");
    expect(done).toContain("<Hangup/>");
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("yossi@gmail.com");
    expect(h.emails[0].subject).toBe("Hup Up Attractions catalog");
    expect(h.emails[0].text).toContain("Royal Castle: A big castle with a slide.");
    const log = await db.select().from(schema.auditLog);
    expect(log.some((r) => r.action === "catalog.sent")).toBe(true);
  });
  it("email by voice: spoken letters; 2 adds more; star goes back one step", async () => {
    await call("catalog-email");
    expect(redirect(await call("catalog-said", { SpeechResult: "M O S H E" }, "part=local"))).toBe("catalog-got?part=local");
    expect(redirect(await call("catalog-got-choice", { Digits: "2" }, "part=local"))).toBe("catalog-part?part=local&add=1");
    await call("catalog-said", { SpeechResult: "dot k" }, "part=local&add=1");
    expect(plain(await call("catalog-got", {}, "part=local"))).toContain("We got m o s h e dot k.");
    expect(redirect(await call("catalog-ending-choice", { Digits: "*" }))).toBe("catalog-got?part=local");
    expect(redirect(await call("catalog-ending-choice", { Digits: "5" }))).toBe("catalog-part?part=domain");
  });
  it("text: until Twilio approves texting, the phone offers email instead; no promo sign-up ever", async () => {
    const prev = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production"; // live site, texting not approved
    const xml = plain(await call("catalog-choice", { Digits: "1" }));
    expect(xml).toContain("Sorry, we can't send it by text just yet. Let's send it by email instead.");
    expect(redirect(xml)).toBe("catalog-email");
    expect(h.sms).toHaveLength(0);
    process.env.VERCEL_ENV = prev;
    expect((await db.select().from(schema.smsConsents)).filter((r) => r.scope === "marketing")).toHaveLength(0);
    expect((await db.select().from(schema.smsReenrollRequests))).toHaveLength(0);
  });
  it("the catalog lists Admin's categories and items in order", async () => {
    const { text } = await catalogEmail();
    expect(text).toContain("Jumping Balloons");
    expect(text).toContain("To book, call (845) 777-7585.");
  });
});

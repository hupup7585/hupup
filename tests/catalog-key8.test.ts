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
import { CATALOG_PHONE_MODE, catalogEmail } from "@/lib/catalog-send";

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

describe("key 8: catalog", () => {
  it("not live yet: only the Owner's phone hears the proposed steps; other callers go to customer service", async () => {
    expect(CATALOG_PHONE_MODE).toBe("owner_test");
    expect(redirect(await call("catalog", {}, "", "+18455550100"))).toBe("ring?k=4");
    const xml = plain(await call("catalog"));
    expect(xml).toContain("We'd love to send you our catalog. To get it by email, press 1. To get it by text, press 2. To go back, press star.");
    expect(xml).toContain("/api/voice/catalog"); // repeats until a key or hang-up
  });
  it("email: say the address, hear it back, 1 sends the catalog from Admin; star goes back", async () => {
    expect(redirect(await call("catalog-choice", { Digits: "*" }))).toBe("menu");
    expect(redirect(await call("catalog-choice", { Digits: "1" }))).toBe("catalog-email");
    expect(plain(await call("catalog-email"))).toContain("Please say your email address");
    const heard = plain(await call("catalog-email-heard", { SpeechResult: "yossi at gmail dot com" }));
    expect(heard).toContain("I heard y o s s i, at gmail dot com. If that's correct, press 1. To try again, press 2.");
    expect(redirect(await call("catalog-email-confirm", { Digits: "2" }))).toBe("catalog-email");
    const done = plain(await call("catalog-email-confirm", { Digits: "1" }));
    expect(done).toContain("Done! We just emailed you our catalog.");
    expect(done).toContain("<Hangup/>");
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("yossi@gmail.com");
    expect(h.emails[0].subject).toBe("Hup Up Attractions catalog");
    expect(h.emails[0].text).toContain("Royal Castle: A big castle with a slide.");
    expect(h.emails[0].text).toContain("https://hupup.example/#rentals");
  });
  it("text: until Twilio approves texting, the phone offers email instead; no promo sign-up ever", async () => {
    const prev = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production"; // live site, texting not approved
    const xml = plain(await call("catalog-choice", { Digits: "2" }));
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

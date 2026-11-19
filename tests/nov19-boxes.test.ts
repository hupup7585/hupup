import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 19, 2026: box 153 (jumping balloons menu), box 154, box 155 (preview), box 156 (discount), info@ texts. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAn19", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) =>
    Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550199" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));


let cat = 0;
const ids: Record<string, number> = {};

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [b] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  cat = b.id;
  const { BALLOON_MENU } = await import("@/lib/ivr/balloon-menu");
  for (const [i, x] of BALLOON_MENU.entries()) {
    const [p] = await db.insert(schema.products).values({ categoryId: b.id, name: x.name, priceCents: 15000 + i * 1000, quantity: 1, active: true, sortOrder: i + 1, description: "a bright castle with a slide.", dimensions: "15 by 20 by 12 feet" }).returning();
    ids[x.name] = p.id;
  }
});

describe("box 153: the jumping balloons menu (approved Nov 19, 2026)", () => {
  it("plays the approved text, word for word, from the jumping balloons category", async () => {
    expect(redirect(await call("category", {}, `c=${cat}`))).toBe(`balloons?c=${cat}`);
    expect(said(await call("balloons", {}, `c=${cat}`))).toEqual([
      "For Soft Hop, item seven two zero one, press 1. For Sunlight Spot, item seven two zero two, press 2. For Blue Bounce, item seven two zero three, press 3. For Ball Buster, item seven two zero four, press 4. For Rising Joy, item seven two zero five, press 5. For Family Fun, item seven two zero six, press 6. For Adventure Zone, item seven two zero seven, press 7. For Wide Slide, item seven two zero eight, press 8. For Amusing Obstacle, item seven two zero nine, press 9. For Mega Mountain, item seven two one zero, press 1 0. For Bounce Blast, item seven two one one, press 1 1. For Wheel Thrill, item seven two one two, press 1 2. To go back, press star.",
    ]);
  });
  it("keys 2 to 9 pick at once; after 1 the line waits 2 seconds for 0, 1 or 2; nothing or pound = Soft Hop", async () => {
    expect(redirect(await call("balloon-key", { Digits: "4" }, `c=${cat}`))).toBe(`balloon-pick?c=${cat}&k=4`);
    expect(redirect(await call("balloon-pick", {}, `c=${cat}&k=4`))).toBe(`balloon?p=${ids["Ball Buster"]}`);
    const one = await call("balloon-key", { Digits: "1" }, `c=${cat}`);
    expect(one).toMatch(/<Gather [^>]*numDigits="1"[^>]*timeout="2"[^>]*finishOnKey="#"/);
    expect(one).not.toContain("<Say"); // pound is never announced
    expect(redirect(await call("balloon-key2", { Digits: "0" }, `c=${cat}`))).toBe(`balloon-pick?c=${cat}&k=10`);
    expect(redirect(await call("balloon-pick", {}, `c=${cat}&k=10`))).toBe(`balloon?p=${ids["Mega Mountain"]}`);
    expect(redirect(await call("balloon-pick", {}, `c=${cat}&k=12`))).toBe(`balloon?p=${ids["Wheel Thrill"]}`);
    expect(redirect(await call("balloon-key2", {}, `c=${cat}`))).toBe(`balloon-pick?c=${cat}&k=1`);
    expect(redirect(await call("balloon-pick", {}, `c=${cat}&k=1`))).toBe(`balloon?p=${ids["Soft Hop"]}`);
    expect(redirect(await call("balloon-pick", {}, `c=${cat}&k=13`))).toBe(`balloons?c=${cat}`);
    expect(redirect(await call("balloon-key", { Digits: "*" }, `c=${cat}`))).toBe("book");
  });
});

describe("box 154 and box 155", () => {
  it("box 154: name, item number digit by digit, real price; 1 adds, star goes back to box 153", async () => {
    const p = ids["Blue Bounce"];
    expect(said(await call("balloon", {}, `p=${p}`))).toEqual(["Blue Bounce, item seven two zero three, 170 dollars. To add it to your shopping cart, press 1. For description and dimensions, press 2. To go back, press star."]);
    h.session.data = {};
    expect(redirect(await call("balloon-choice", { Digits: "1" }, `p=${p}`))).toBe(`date?p=${p}`);
    expect(redirect(await call("balloon-choice", { Digits: "*" }, `p=${p}`))).toBe(`balloons?c=${cat}`);
  });
  it("box 155 (not approved): on preview the draft with the Admin sizes; on the live line the description as before", async () => {
    const p = ids["Blue Bounce"];
    expect(said(await call("balloon-choice", { Digits: "2" }, `p=${p}`))).toEqual([
      "The Blue Bounce is a bright castle with a slide. The dimensions are as follows: 15 feet long, 20 feet wide, and 12 feet tall. To add it to your shopping cart, press 1. To go back, press star.",
    ]);
    process.env.VERCEL_ENV = "production";
    try {
      const live = await call("balloon-choice", { Digits: "2" }, `p=${p}`);
      expect(said(live)).toEqual(["a bright castle with a slide."]);
      expect(redirect(live)).toBe(`balloon?p=${p}`);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
  it("sizes come from the Dimensions field; balloons never offer a second one", async () => {
    const { balloonSizes, digitWords } = await import("@/lib/ivr/balloon-menu");
    expect(balloonSizes("15' x 20' x 12'")).toEqual({ length: "15", width: "20", height: "12" });
    expect(balloonSizes("15 by 15 feet")).toBeNull();
    expect(digitWords("7210")).toBe("seven two one zero");
    h.session.orderId = null;
    expect(redirect(await call("add", {}, `p=${ids["Soft Hop"]}&d=2026-12-22&q=1`))).toBe("ocean?d=2026-12-22");
  });
});

describe("box 156: the Owner's discount is always told before payment (approved Nov 19, 2026)", () => {
  it("the exact line, with the total before and after the discount", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.box156.text).toBe("The total of your order is {amount}. We are happy to let you know that a discount of {discount} has been applied to your order. Your new total is {newtotal}.");
    const { customerDiscountLine } = await import("@/lib/ivr/flow");
    const s = { salesTaxPercent: "8.125" } as never;
    expect(customerDiscountLine([{ note: "Customer discount: 10% off", discountCents: 2000, zone: "kj", feeCents: 1000, subtotalCents: 18000 }], s)).toEqual({ spoken: "10 percent", beforeCents: 20000 + 1000 + Math.round((21000 * 8.125) / 100) });
    expect(customerDiscountLine([{ note: "Customer discount: $25.00 off", discountCents: 2500, zone: "kj", feeCents: 0, subtotalCents: 17500 }], s)?.spoken).toBe("25 dollars");
    expect(customerDiscountLine([{ note: "4th Sunday free", discountCents: 2000, zone: "kj", feeCents: 0, subtotalCents: 18000 }], s)).toBeNull();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain('if (disc) sp(vr, ctx, "box156"');
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).toContain("data-pay-discount");
  });
});

describe("info@ texts (Abraham, Nov 19, 2026)", () => {
  it("an HTML-only email is texted as its words, not '(no text)'", async () => {
    const { infoEmailText } = await import("@/lib/inbox");
    const t = infoEmailText({ id: 5, fromName: "Leah", fromAddress: "leah@example.com", subject: "catalog", textBody: null, htmlBody: "<p>Please send the <b>catalog</b>.</p>" });
    expect(t).toContain("Please send the catalog.");
    expect(t).not.toContain("(no text)");
  });
});

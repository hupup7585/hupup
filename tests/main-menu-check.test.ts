import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Main menu check (Abraham W): every key, every sub-menu, star, replay and invalid-key paths. Simulated calls only
 * (in-memory database; nothing is dialed or texted).
 */
const h = vi.hoisted(() => ({ open: true }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => h.open, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";

const SID = "CAmenucheck";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550142" });
const press = (d: string) => call("menu-choice", { Digits: d });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const gatherTo = (xml: string) => xml.match(/<Gather [^>]*action="([^"]+)"/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const text = (xml: string) => xml.replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const ok = (xml: string) => expect(xml).not.toMatch(/something went wrong|went_wrong|Sorry, we're having trouble/i);
const P = (k: keyof typeof PROMPTS) => PROMPTS[k].text;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.ADMIN_PHONE = "+18457777585";
  const [b] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [l] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", spokenName: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  await db.insert(schema.categories).values({ name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true });
  await db.insert(schema.products).values([
    { categoryId: b.id, name: "Royal Castle Combo", priceCents: 23000, quantity: 2, active: true, sortOrder: 1 },
    { categoryId: b.id, name: "Toddler Bounce", priceCents: 12000, quantity: 3, active: true, sortOrder: 2 },
    { categoryId: l.id, name: "Laser Tag Arena", priceCents: 30000, quantity: 1, active: true, sortOrder: 1 },
  ]);
  await call("incoming");
});

describe("main menu: every key goes through", () => {
  it("the menu plays every line and listens for one key (# is not a menu key)", async () => {
    const xml = text(await call("menu", {}, { first: "1" }));
    for (const k of ["greeting", "main_book", "main_equipment", "main_learn", "main_service", "main_rental_help", "main_6", "main_hours", "main_organizations", "main_9", "main_0", "main_star_again"] as const) expect(xml).toContain(P(k));
    expect(gatherTo(xml)).toBe("menu-choice");
    expect(xml).toContain('finishOnKey=""');
  });

  const routes: [string, string][] = [
    ["1", "book"],
    ["2", "instructions"],
    ["3", "learn"],
    ["4", "ring?k=4"],
    ["5", "ring?k=5"],
    ["6", "ring?k=6"],
    ["7", "ring?k=0"],
    ["8", "ring?k=8"],
    ["9", "voicemail"],
    ["0", "ring?k=0"],
    ["*", "menu?first=1"],
  ];
  for (const [key, to] of routes) {
    it(`key ${key} -> ${to}, and that step answers without an error`, async () => {
      const xml = await press(key);
      expect(redirect(xml)).toBe(to);
      const [action, qs] = to.split("?");
      const next = await call(action, {}, Object.fromEntries(new URLSearchParams(qs ?? "")));
      ok(next);
      expect(next).toMatch(/<Gather|<Dial|<Record|<Redirect|<Say/);
    });
  }

  it("# and other non-menu keys say it's not a valid choice and replay the menu", async () => {
    for (const k of ["#"]) {
      const xml = text(await press(k));
      expect(xml).toContain(P("not_valid"));
      expect(redirect(xml)).toBe("menu");
    }
  });

  it("no key: the menu replays, three plays in all, then a polite goodbye", async () => {
    expect(redirect(await call("menu-choice", {}, { n: "0" }))).toBe("menu?first=1&n=1");
    expect(redirect(await call("menu-choice", {}, { n: "1" }))).toBe("menu?first=1&n=2");
    expect(await call("menu-choice", {}, { n: "2" })).toContain("<Hangup/>");
  });
});

describe("key 2: instructions", () => {
  it("asks which attraction, with star for the main menu", async () => {
    const xml = text(await call("instructions"));
    expect(xml).toContain(P("instr_intro"));
    expect(xml).toContain("For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3.");
    expect(xml).toContain(P("attraction_menu_back"));
    expect(gatherTo(xml)).toBe("attraction-choice?m=i");
  });
  for (const [t, key] of [["1", "instr_balloons"], ["2", "instr_laser"], ["3", "instr_paddle"]] as const) {
    it(`${t} plays the ${key.replace("instr_", "")} instructions, then star again / 1 another / 2 main menu`, async () => {
      expect(redirect(await call("attraction-choice", { Digits: t }, { m: "i" }))).toBe(`attraction?m=i&t=${t}`);
      const xml = text(await call("attraction", {}, { m: "i", t }));
      expect(xml).toContain(P(key));
      expect(xml).toContain("To hear this again, press the star key. To choose another attraction, press 1. To go back to the main menu, press 2.");
      expect(gatherTo(xml)).toBe(`attraction-after?m=i&t=${t}`);
      expect(redirect(await call("attraction-after", { Digits: "*" }, { m: "i", t }))).toBe(`attraction?m=i&t=${t}`);
      expect(redirect(await call("attraction-after", { Digits: "1" }, { m: "i", t }))).toBe("instructions?again=1");
      expect(redirect(await call("attraction-after", { Digits: "2" }, { m: "i", t }))).toBe("menu");
    });
  }
  it("each set of instructions covers setup, safe use, supervision and age, weather, and getting ready for pickup", () => {
    for (const k of ["instr_balloons", "instr_laser", "instr_paddle"] as const) {
      for (const part of ["Setup:", "Safe use:", "Supervision:", "Weather:", "Getting ready for pickup:"]) expect(P(k)).toContain(part);
      expect(P(k)).toMatch(/age/);
    }
  });
  it("star in the attraction menu returns to the main menu; # or 4 is invalid; no key asks again", async () => {
    expect(redirect(await call("attraction-choice", { Digits: "*" }, { m: "i" }))).toBe("menu");
    for (const k of ["#", "4"]) {
      const xml = text(await call("attraction-choice", { Digits: k }, { m: "i" }));
      expect(xml).toContain(P("not_valid"));
      expect(redirect(xml)).toBe("instructions?again=1");
    }
    expect(text(await call("attraction-choice", {}, { m: "i" }))).toContain(P("no_input"));
    const after = text(await call("attraction-after", { Digits: "#" }, { m: "i", t: "1" }));
    expect(after).toContain(P("not_valid"));
    expect(redirect(after)).toBe("attraction-options?m=i&t=1");
    expect(gatherTo(await call("attraction-options", {}, { m: "i", t: "1" }))).toBe("attraction-after?m=i&t=1");
  });
});

describe("key 3: learn about our rentals", () => {
  it("same choice of attractions; each description lists the items from Admin and says we deliver", async () => {
    const menu = text(await call("learn"));
    expect(menu).toContain(P("learn_intro"));
    expect(gatherTo(menu)).toBe("attraction-choice?m=l");
    const balloons = text(await call("attraction", {}, { m: "l", t: "1" }));
    expect(balloons).toContain(P("learn_balloons"));
    expect(balloons).toContain("Our Jumping Balloons include: Royal Castle Combo and Toddler Bounce.");
    expect(balloons).toContain(P("learn_deliver"));
    const laser = text(await call("attraction", {}, { m: "l", t: "2" }));
    expect(laser).toContain("Our Laser Tag and Inflatable Mazes include: Laser Tag Arena.");
    const paddle = text(await call("attraction", {}, { m: "l", t: "3" }));
    expect(paddle).toContain(P("learn_paddle"));
    expect(paddle).toContain(P("learn_none")); // no paddle boats set up in this test catalog
    expect(redirect(await call("attraction-after", { Digits: "1" }, { m: "l", t: "2" }))).toBe("learn?again=1");
  });
  it("each description says what it is, who it's for, indoor or outdoor, and the space needed", () => {
    for (const k of ["learn_balloons", "learn_laser", "learn_paddle"] as const) {
      expect(P(k)).toMatch(/outdoor/i);
      expect(P(k)).toMatch(/kids|children|teens|adults/i);
      expect(P(k)).toMatch(/space|area|room|hall|pool/i);
    }
    expect(P("learn_deliver")).toMatch(/We deliver/);
  });
  it("all key 2 and key 3 lines are editable on the Hotline prompts page", () => {
    for (const k of ["attraction_choice", "attraction_menu_back", "attraction_after", "instr_intro", "instr_balloons", "instr_laser", "instr_paddle", "learn_intro", "learn_balloons", "learn_laser", "learn_paddle", "learn_items", "learn_deliver", "learn_none"] as const) {
      expect(PROMPTS[k].group).toMatch(/^Key [23]:/);
      expect((PROMPTS[k] as { textOnly?: boolean }).textOnly).not.toBe(true);
    }
  });
  it("2 and 3 work when the office is closed too (recorded information, no one needs to answer)", async () => {
    h.open = false;
    expect(redirect(await press("2"))).toBe("instructions");
    expect(redirect(await press("3"))).toBe("learn");
    h.open = true;
  });
});

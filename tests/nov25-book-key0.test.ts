import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/* Item 4 (Abraham, Nov 25, 2026; hours per 4:50 PM): bookings key 0 rings customer service only in its hours; outside
 * them the after-hours set plays (line 2, the hours line, waits for new wording), then the tone into the customer
 * service box. Keys: 1 the categories menu, star the bookings menu, anything else not valid then the set again. */
const h = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { saveSetting } from "@/lib/settings";

const L1 = "Our customer service is currently closed.";
const L3 = "For the best availability and fastest booking, please use our easy automated system to ensure your booking today. To get started, press 1.";
const L4 = "Otherwise, leave a message after the tone, and a customer service representative will return your call on the next open day, and will help you find the best available options for your needs.";
const SID = "CAbook0";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550145" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const key0At = async (iso: string) => {
  vi.setSystemTime(new Date(iso));
  const r = redirect(await call("book-choice", { Digits: "0" }));
  return r === "ring?k=4" ? (await call("ring", {}, { k: "4" })) : await call(r!.split("?")[0], {}, Object.fromEntries(new URLSearchParams(r!.split("?")[1] ?? "")));
};
const rings = (xml: string) => xml.includes("<Dial");
const afterHours = (xml: string) => said(xml).join(" ").includes(L1);

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await saveSetting("ringTargets4", "Sara | +18455550123 | 25");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T17:00:00Z"));
  await call("incoming");
});
afterEach(() => vi.setSystemTime(new Date("2026-12-01T17:00:00Z")));

describe("the three approved lines (slots, word for word)", () => {
  it("after_hours_closed, after_hours_auto, after_hours_message", () => {
    expect(PROMPTS.after_hours_closed.text).toBe(L1);
    expect(PROMPTS.after_hours_auto.text).toBe(L3);
    expect(PROMPTS.after_hours_message.text).toBe(L4);
  });
});

describe("when bookings key 0 rings", () => {
  it("Tuesday 12:00 PM and 8 PM ring; Friday 11:30 AM rings; a Chanukah weekday 8 PM rings", async () => {
    for (const t of ["2026-12-01T17:00:00Z", "2026-12-02T01:00:00Z", "2026-11-27T16:30:00Z", "2026-12-08T01:00:00Z"]) expect(rings(await key0At(t))).toBe(true);
  });
  it("Tuesday 3 PM, Sunday 10:59 AM, Friday 1 PM, Motzei Shabbes, Shabbes, Chanukah 4:30 PM: the after-hours set", async () => {
    for (const t of ["2026-12-01T20:00:00Z", "2026-11-29T15:59:00Z", "2026-11-27T18:00:00Z", "2026-11-29T01:30:00Z", "2026-11-28T17:00:00Z", "2026-12-07T21:30:00Z"]) {
      const xml = await key0At(t);
      expect(rings(xml)).toBe(false);
      expect(afterHours(xml)).toBe(true);
    }
  });
  it("an Admin closed day: the after-hours set", async () => {
    await saveSetting("calendarOverrides", "2026-12-01 closed Day off");
    expect(afterHours(await key0At("2026-12-01T17:00:00Z"))).toBe(true);
    await saveSetting("calendarOverrides", "");
  });
  it("changing customer service hours on the Hours page changes the result (no deploy)", async () => {
    const { defaultHours } = await import("@/lib/hours-schedule");
    const { hoursDefaults } = await import("@/lib/business-hours");
    const d = defaultHours(hoursDefaults());
    d.lines.cs.schedule.days["2"] = { closed: false, windows: [{ from: "15:00", to: "16:00" }] };
    await saveSetting("hoursSchedules", JSON.stringify(d));
    expect(rings(await key0At("2026-12-01T20:30:00Z"))).toBe(true); // Tue 3:30 PM
    expect(afterHours(await key0At("2026-12-01T17:00:00Z"))).toBe(true); // Tue noon
    await saveSetting("hoursSchedules", "");
  });
});

describe("the after-hours set", () => {
  it("lines 1, 3, 4 in order (line 2 waits for new wording), keys while they play, then the tone into the customer service box", async () => {
    vi.setSystemTime(new Date("2026-12-01T20:00:00Z"));
    const xml = await call("cs-closed");
    expect(said(xml)).toEqual([L1, L3, L4]);
    expect(xml).not.toContain("11 AM to 4 PM");
    expect(xml).toMatch(/<Gather [^>]*action="[^"]*cs-closed-key/);
    expect(xml).toMatch(/<Record [^>]*finishOnKey="#"/);
    expect(xml.indexOf("<Record")).toBeGreaterThan(xml.indexOf(L4));
    expect(xml).toMatch(/vm-recorded\?b=\d+&amp;x=4/);
    expect(xml).not.toContain(PROMPTS.vm_greeting.text);
  });
  it("1: the categories menu; star: the bookings menu; 5, pound, 0: not valid, then the set again", async () => {
    expect(redirect(await call("cs-closed-key", { Digits: "1" }))).toBe("cats");
    expect(redirect(await call("cs-closed-key", { Digits: "*" }))).toBe("book");
    for (const d of ["5", "#", "0"]) {
      const xml = await call("cs-closed-key", { Digits: d });
      expect(said(xml)).toEqual(["Sorry, that is not a valid selection."]);
      expect(redirect(xml)).toBe("cs-closed");
    }
  });
  it("the categories menu (box 12a) key 0 is still the cart", async () => {
    expect(redirect(await call("cats-choice", { Digits: "0" }))).toBe("cart");
  });
});

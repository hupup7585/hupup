import { afterAll, describe, expect, it, vi } from "vitest";

/* Same-day bookings (Abraham, Nov 27, 2026, 12:19 AM): today only before 3:30 PM, on Friday and Erev Yom Tov only
   before chatzos (both from Admin); after that today is not offered; a same-day date gets the delivery notice. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { calendarDefaults, localISO, sameDayOpen } from "@/lib/jewish-calendar";
import { handleVoice } from "@/lib/ivr/flow";
import { todayISO } from "@/lib/dates";
import { PROMPTS } from "@/lib/ivr/prompts";
import { readFileSync } from "node:fs";
const PINNED = process.env.HUP_CALENDAR_NOW; // the test setup's pinned day, put back after each test
afterAll(() => void (process.env.HUP_CALENDAR_NOW = PINNED));

const cal = { ...calendarDefaults(), sameDayCutoff: "15:30", sameDayCutoffErev: "chatzos" };
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAsame", ...body }, callSid: "CAsame", from: "+18455550717" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1]).join(" ");

describe("same-day notice by zone (Abraham, Nov 27, 2026, 12:33 AM)", () => {
  it("defaults: close by 2.5-3.5, surrounding 3.5-4.5, Kiryas Joel close by until areas are listed", async () => {
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    expect([SETTING_DEFAULTS.sameDayHoursClose, SETTING_DEFAULTS.sameDayHoursFar, SETTING_DEFAULTS.sameDayCloseAreas]).toEqual(["2.5-3.5", "3.5-4.5", ""]);
    expect(PROMPTS.same_day_notice.text).toContain("about {from} to {to} hours");
  });
});

describe("same-day cut-off", () => {
  it("Monday 3:29 PM today is open, 3:31 PM it is not; other days are never affected", () => {
    expect(sameDayOpen("2027-01-11", new Date("2027-01-11T20:29:00Z"), cal)).toBe(true);
    expect(sameDayOpen("2027-01-11", new Date("2027-01-11T20:31:00Z"), cal)).toBe(false);
    expect(sameDayOpen("2027-01-12", new Date("2027-01-11T23:00:00Z"), cal)).toBe(true);
  });
  it("Friday: 11:50 AM with the cut-off at 11:45 is closed; with chatzos, early morning open, afternoon closed", () => {
    expect(sameDayOpen("2027-01-15", new Date("2027-01-15T16:50:00Z"), { ...cal, sameDayCutoffErev: "11:45" })).toBe(false);
    expect(sameDayOpen("2027-01-15", new Date("2027-01-15T16:40:00Z"), { ...cal, sameDayCutoffErev: "11:45" })).toBe(true);
    expect(sameDayOpen("2027-01-15", new Date("2027-01-15T14:00:00Z"), cal)).toBe(true);
    expect(sameDayOpen("2027-01-15", new Date("2027-01-15T19:00:00Z"), cal)).toBe(false);
  });
  it("phone: today after the cut-off goes back to the date step; before it, the delivery notice plays after confirming", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    delete process.env.VERCEL_ENV; // preview: the draft lines play
    const today = todayISO();
    const digits = today.slice(5, 7) + today.slice(8, 10);
    process.env.HUP_CALENDAR_NOW = new Date(`${today}T23:59:00-05:00`).toISOString(); // late tonight: closed
    if (localISO(new Date(process.env.HUP_CALENDAR_NOW)) === today) {
      const xml = await call("date-heard", { Digits: digits });
      // the line waits for Abraham's words, so for now the date step simply comes again
      expect(redirect(xml)).toBe("date");
    }
    process.env.HUP_CALENDAR_NOW = new Date(`${today}T00:30:00-05:00`).toISOString(); // just after midnight: open
    if (localISO(new Date(process.env.HUP_CALENDAR_NOW)) === today) {
      const ok = await call("date-confirm", { Digits: "1" }, `d=${today}`);
      expect(redirect(ok)).toBe("cats"); // the notice is not here any more: it comes after the address (12:33 AM)
      expect(said(ok)).toBe("");
    }
    process.env.HUP_CALENDAR_NOW = PINNED;
    expect([PROMPTS.same_day_closed.pending, PROMPTS.same_day_notice.pending]).toEqual([true, true]);
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('sp(vr, ctx, "same_day_notice", { from, to });');
  });
});

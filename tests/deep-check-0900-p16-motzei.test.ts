import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P16 (simulated calls): a line's own Saturday-night (Motzei Shabbes) hours on the Hours page
   never rang: the ringing check closed the whole Saturday date. Now Shabbes counts by the clock (until it is out):
   Saturday-night hours ring once Shabbes is out, never during Shabbes; with no Saturday hours nothing changes. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { saveSetting } from "@/lib/settings";

const SID = "CAp16";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550146" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const rings = (xml: string) => xml.includes("<Dial");
const key0At = async (iso: string) => {
  vi.setSystemTime(new Date(iso));
  const r = redirect(await call("book-choice", { Digits: "0" }));
  return r === "ring?k=4" ? await call("ring", {}, { k: "4" }) : await call(r!.split("?")[0], {}, Object.fromEntries(new URLSearchParams(r!.split("?")[1] ?? "")));
};
const ringAt = async (k: string, iso: string) => {
  vi.setSystemTime(new Date(iso));
  return call("ring", {}, { k });
};

// Shabbes Nov 28, 2026 is out at 5:43 PM ET (22:43 UTC)
const SAT_NIGHT = "2026-11-29T02:30:00Z"; // Sat 9:30 PM ET
const SAT_DAY = "2026-11-28T20:00:00Z"; // Sat 3:00 PM ET (Shabbes)
const SAT_EARLY = "2026-11-28T22:30:00Z"; // Sat 5:30 PM ET (Shabbes not out yet)

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await saveSetting("ringTargets4", "Sara | +18455550123 | 25");
  await saveSetting("ringTargets5", "Moshe | +18455550124 | 25");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T17:00:00Z"));
  await call("incoming");
});
afterEach(() => vi.setSystemTime(new Date("2026-12-01T17:00:00Z")));

describe("deep check 09:00 P16: Saturday-night hours", () => {
  it("no Saturday hours (the default): Saturday night does not ring, as before", async () => {
    await saveSetting("hoursSchedules", "");
    expect(rings(await key0At(SAT_NIGHT))).toBe(false);
  });

  it("customer service with Saturday 5:00 PM-11:00 PM: rings Saturday 9:30 PM; never during Shabbes", async () => {
    const { defaultHours } = await import("@/lib/hours-schedule");
    const { hoursDefaults } = await import("@/lib/business-hours");
    const d = defaultHours(hoursDefaults());
    d.lines.cs.schedule.days["6"] = { closed: false, windows: [{ from: "17:00", to: "23:00" }] };
    d.lines.problems.schedule.days["6"] = { closed: false, windows: [{ from: "17:00", to: "23:00" }] };
    await saveSetting("hoursSchedules", JSON.stringify(d));
    expect(rings(await key0At(SAT_NIGHT))).toBe(true); // bookings key 0 (customer service hours only)
    expect(rings(await ringAt("4", SAT_NIGHT))).toBe(true); // main menu customer service
    expect(rings(await ringAt("5", SAT_NIGHT))).toBe(true); // another line with its own Saturday hours
    expect(rings(await key0At(SAT_EARLY))).toBe(false); // inside the window, but Shabbes is not out yet
    expect(rings(await ringAt("4", SAT_EARLY))).toBe(false);
    expect(rings(await ringAt("4", SAT_DAY))).toBe(false);
    await saveSetting("hoursSchedules", "");
  });

  it("a line with no Saturday hours and its after-hours switch on still never rings on Saturday night", async () => {
    await saveSetting("ringAfterHours6", "true");
    await saveSetting("ringTargets6", "Yoel | +18455550125 | 25");
    expect(rings(await ringAt("6", SAT_NIGHT))).toBe(false);
    await saveSetting("ringAfterHours6", "");
  });
});

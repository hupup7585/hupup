import { beforeAll, describe, expect, it, vi } from "vitest";

/* Laser tag instructions approved (Abraham, Nov 25, 2026, 1:28 PM): key 2 then 2 plays parts 1, 2 and 3 in order,
 * then attraction_after; balloons and paddle boats stay pending (ring customer service). */
const h = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS, RETIRED_PROMPTS, promptWaiting } from "@/lib/ivr/prompts";

const SID = "CAlaserinstr";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550143" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

const PART1 = "Here is how to use your laser tag set from Hup Up Attractions. First, charge everything. Place each gun upside down in the charging station, and plug a cable into the side of each vest. A full charge takes one to two hours. Before every game, pair each gun with its vest. Turn on the vest first, then the gun. When the gun says, Ready to Pair, aim it at your vest and shoot.";
const PART2 = "Then, within ten seconds, press the Team button on the back of the front piece of the vest to choose your team color. Press plus or minus on the back of the vest to set your lives. Wait until you hear, Setup complete. Good luck. To play, aim at the other player's vest and pull the trigger. When your gun runs out of shots, press the Reload button. Also press Reload after you change weapons. When your lives run out, you are out of the game.";
const PART3 = "For safety, please keep the set dry, do not push or wrestle, and an adult must watch young children. To turn off a gun or vest, hold the power button for three seconds. A full written guide comes with your rental. If you need help, please call us. Thank you for choosing Hup Up Attractions!";
const AFTER = "To hear this again, press the star key. To choose another attraction, press 1. To go back to the main menu, press 2.";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.ADMIN_PHONE = "+18457777585";
  await call("incoming");
});

describe("the three slots", () => {
  it("exactly Abraham's texts, recordable, not pending; the old single line is retired", () => {
    expect(PROMPTS.instr_laser_1.text).toBe(PART1);
    expect(PROMPTS.instr_laser_2.text).toBe(PART2);
    expect(PROMPTS.instr_laser_3.text).toBe(PART3);
    for (const k of ["instr_laser_1", "instr_laser_2", "instr_laser_3"] as const) {
      expect(promptWaiting({}, k)).toBe(false);
      expect(PROMPTS[k].group).toBe("Key 2: Instructions");
    }
    expect(RETIRED_PROMPTS.has("instr_laser")).toBe(true);
    expect(promptWaiting({}, "instr_balloons")).toBe(true);
    expect(promptWaiting({}, "instr_paddle")).toBe(true);
  });
});

describe("key 2 then 2: laser tag instructions", () => {
  it("plays part 1, part 2, part 3 in order, then attraction_after; no ringing", async () => {
    h.overrides = {};
    expect(redirect(await call("attraction-choice", { Digits: "2" }, { m: "i" }))).toBe("attraction?m=i&t=2");
    const xml = await call("attraction", {}, { m: "i", t: "2" });
    expect(said(xml)).toEqual([PART1, PART2, PART3, AFTER]);
    expect(xml).not.toContain("ring");
    // no pause between the three parts; the usual one before the options line
    const between = xml.slice(xml.indexOf(PART1.slice(-20)), xml.lastIndexOf(PART3.slice(-20)));
    expect(between).not.toContain("<Pause");
  });
  it("an uploaded recording on a part plays instead of the voice for that part", async () => {
    h.overrides = { instr_laser_2: { recordingId: 77 } };
    const xml = await call("attraction", {}, { m: "i", t: "2" });
    expect(said(xml)).toEqual([PART1, PART3, AFTER]);
    expect(xml).toMatch(/<Play>[^<]*77[^<]*<\/Play>/);
    h.overrides = {};
  });
  it("star repeats all three parts", async () => {
    expect(redirect(await call("attraction-after", { Digits: "*" }, { m: "i", t: "2" }))).toBe("attraction?m=i&t=2");
    expect(said(await call("attraction", {}, { m: "i", t: "2" })).slice(0, 3)).toEqual([PART1, PART2, PART3]);
  });
  it("2 then 1 (balloons) and 2 then 3 (paddle boats) still ring customer service", async () => {
    for (const t of ["1", "3"]) expect(redirect(await call("attraction", {}, { m: "i", t }))).toBe("ring?k=4");
  });
});

describe("recordings already uploaded on the old single laser line", () => {
  it("can be chosen for any of the three parts (nothing moved or deleted); other lines still refuse them", async () => {
    const { db, schema } = await import("@/lib/db");
    const { chooseRecording } = await import("@/lib/prompt-recordings");
    const [r] = await db.insert(schema.promptRecordings).values({ promptKey: "instr_laser", source: "upload", fileName: "laser part 2.mp3", contentType: "audio/mpeg", sizeBytes: 10, complete: true }).returning();
    await chooseRecording("instr_laser_2", r.id, null);
    const { eq } = await import("drizzle-orm");
    const [vp] = await db.select().from(schema.voicePrompts).where(eq(schema.voicePrompts.key, "instr_laser_2"));
    expect(vp.recordingId).toBe(r.id);
    const [still] = await db.select().from(schema.promptRecordings).where(eq(schema.promptRecordings.id, r.id));
    expect(still.promptKey).toBe("instr_laser");
    await expect(chooseRecording("instr_paddle", r.id, null)).rejects.toThrow();
  });
});

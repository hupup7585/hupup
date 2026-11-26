import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 26, 2026: (1) main menu key 7 plays the customer service hours with Friday (key7_cs_hours); (2) Shushan
 * Purim, every year by the Hebrew calendar, closes the Customer service block only; (3) the Hours page red note compares
 * the hours line's own approved text and recording. */
const h = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false, bookingLock: () => ({ locked: false }) }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { readFileSync } from "node:fs";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { calendarDefaults } from "@/lib/jewish-calendar";
import { holidaysOn } from "@/lib/hup-calendar/holidays";
import { fixedFromISO } from "@/lib/hup-calendar/hebrew-date";
import { LINE_IDS, defaultHours, effectiveLine, lineOpen, loadHours, parseDateOverrides, recordedHoursWarnings, type HoursData } from "@/lib/hours-schedule";

const SID = "CAkey7";
const call = (action: string, body: Record<string, string> = {}) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550146" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const KEY7 = "Our customer service is open Sunday through Thursday, from 11 AM to 2 PM, and at night from 7:30 PM to 10:30 PM. Friday, from 10:30 AM till chatzos.";
const R3C = "Our customer service is open Sunday through Thursday, from 11 AM to 2 PM, and at night from 7:30 PM to 10:30 PM.";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await call("incoming");
});

describe("1. main menu key 7: customer service hours with Friday", () => {
  it("its own Admin slot with the exact text (editable like every slot)", () => {
    expect(PROMPTS.key7_cs_hours.text).toBe(KEY7);
    expect(PROMPTS.key7_cs_hours.label).toBe("Main menu key 7: customer service hours with Friday");
    expect(R3C).toBe(PROMPTS.book_r3c.text); // the bookings line stays Sunday through Thursday only
  });
  it("no recording yet: the Google voice reads its text, then the main menu as before (no office hours, no office closed line)", async () => {
    h.overrides = {};
    const xml = await call("hours");
    expect(said(xml)).toEqual([KEY7]);
    expect(xml).not.toContain(PROMPTS.office_closed.text);
    expect(xml).toMatch(/<Redirect method="POST">[^<]*\/api\/voice\/menu<\/Redirect>/);
  });
  it("with a recording: that recording, not the Google voice", async () => {
    h.overrides = { key7_cs_hours: { text: null, audioUrl: null, recordingId: 4401 } };
    const xml = await call("hours");
    expect(xml).toMatch(/<Play>[^<]*4401[^<]*<\/Play>/);
    expect(said(xml)).toEqual([]);
  });
  it("main menu key 7 goes there; the bookings menu still plays book_r3c after 3a", async () => {
    h.overrides = { book_r3c: { text: null, audioUrl: null, recordingId: 4402 } };
    const press = await call("menu-choice", { Digits: "7" });
    expect(press).toMatch(/\/api\/voice\/hours<\/Redirect>/);
    const book = await call("book");
    expect(book).toMatch(/<Play>[^<]*4402[^<]*<\/Play>/);
    expect(book).not.toContain("Friday, from 10:30 AM till chatzos.");
  });
});

describe("2. Shushan Purim, every year, customer service only", () => {
  const cal = calendarDefaults();
  const data = (): HoursData => loadHours({ ...cal } as never);
  const at = (utc: string) => new Date(utc);
  const shushan = (iso: string) => holidaysOn(fixedFromISO(iso)).some((e) => e.key === "Shushan Purim");
  it("by the Hebrew calendar: 15 Adar II in a leap year (2027), 15 Adar in a plain year (2026, 2028); not Shushan Purim Katan", () => {
    expect(shushan("2027-03-24")).toBe(true); // 5787, a leap year
    expect(shushan("2026-03-04")).toBe(true); // 5786
    expect(shushan("2028-03-13")).toBe(true); // 5788
    expect(shushan("2027-02-22")).toBe(false); // Shushan Purim Katan (15 Adar I)
  });
  it("the checkbox: Customer service ticked, every other block not", () => {
    const d = data();
    for (const id of LINE_IDS) expect(effectiveLine(d, id).schedule.closedShushanPurim).toBe(id === "cs");
    const page = readFileSync("src/app/admin/(app)/hours/page.tsx", "utf8");
    expect(page).toContain("Closed on Shushan Purim");
    expect(readFileSync("src/app/admin/(app)/hours/actions.ts", "utf8")).toContain('closedShushanPurim: fd.get("closedShushanPurim") === "on"');
  });
  it("2027-03-24 (Wednesday, leap year): customer service closed; delivery, operator, problems and schools open at noon; bookings open", async () => {
    const d = data();
    const noon = at("2027-03-24T16:00:00Z"); // 12 PM EDT
    expect(lineOpen(d, "cs", noon, cal)).toBe(false);
    for (const id of ["delivery", "operator", "problems", "schools"] as const) expect(lineOpen(d, id, noon, cal)).toBe(true);
    expect(lineOpen(d, "cs", at("2027-03-31T16:00:00Z"), cal)).toBe(true); // the next Wednesday: open
    const { bookingLock } = await vi.importActual<typeof import("@/lib/jewish-calendar")>("@/lib/jewish-calendar");
    expect(bookingLock(noon, cal).locked).toBe(false); // the automated system takes bookings
  });
  it("2026-03-04 (Wednesday, plain year): customer service closed, delivery open", () => {
    const d = data();
    expect(lineOpen(d, "cs", at("2026-03-04T17:00:00Z"), cal)).toBe(false); // 12 PM EST
    expect(lineOpen(d, "delivery", at("2026-03-04T17:00:00Z"), cal)).toBe(true);
  });
  it("Purim itself still closes everything (2027-03-23 and 2026-03-03)", () => {
    const d = data();
    for (const utc of ["2027-03-23T16:00:00Z", "2026-03-03T17:00:00Z"]) for (const id of LINE_IDS) expect(lineOpen(d, id, at(utc), cal)).toBe(false);
  });
  it("unticked: customer service open on Shushan Purim; ticked on another block: that block closes", () => {
    const d = data();
    d.lines.cs.schedule.closedShushanPurim = false;
    d.lines.delivery.schedule.closedShushanPurim = true;
    const s = loadHours({ ...cal, hoursSchedules: JSON.stringify(d) } as never);
    expect(lineOpen(s, "cs", at("2027-03-24T16:00:00Z"), cal)).toBe(true);
    expect(lineOpen(s, "delivery", at("2027-03-24T16:00:00Z"), cal)).toBe(false);
  });
  it("the one-time line '2027-03-24 closed Shushan Purim' in Customer service still works (even unticked)", () => {
    const d = data();
    d.lines.cs.schedule.closedShushanPurim = false;
    d.lines.cs.schedule.overrides = parseDateOverrides("2027-03-24 closed Shushan Purim").list;
    const s = loadHours({ ...cal, hoursSchedules: JSON.stringify(d) } as never);
    expect(effectiveLine(s, "cs").schedule.overrides).toEqual([{ from: "2027-03-24", to: "2027-03-24", closed: true, windows: [], note: "Shushan Purim" }]);
    expect(lineOpen(s, "cs", at("2027-03-24T16:00:00Z"), cal)).toBe(false);
    expect(lineOpen(s, "delivery", at("2027-03-24T16:00:00Z"), cal)).toBe(true);
  });
});

describe("3. the red note compares the hours line's own approved text and recording", () => {
  const withCs = (windows: { from: string; to: string }[]) => {
    const d = defaultHours({} as never);
    for (const k of ["0", "1", "2", "3", "4"] as const) d.lines.cs.schedule.days[k] = { closed: false, windows };
    return d;
  };
  const live = [{ from: "11:00", to: "14:00" }, { from: "19:30", to: "22:30" }];
  it("the live text (11 AM to 2 PM and 7:30 PM to 10:30 PM) and the saved hours agree: no note", () => {
    expect(recordedHoursWarnings(withCs(live), { text: R3C, recordingWording: R3C })).toEqual([]);
    expect(recordedHoursWarnings(withCs(live), { text: R3C, recordingWording: null })).toEqual([]); // an upload with no words saved
  });
  it("the hours really differ: the note says both", () => {
    const w = recordedHoursWarnings(withCs([{ from: "11:00", to: "14:00" }, { from: "19:30", to: "22:00" }]), { text: R3C });
    expect(w).toEqual(["The recorded hours line says 11 AM, 2 PM, 7:30 PM, 10:30 PM, but the Customer service hours (Sunday to Thursday) are 11 AM, 2 PM, 7:30 PM, 10 PM. Ask for a new recording."]);
  });
  it("the recording was made for other words: the note", () => {
    expect(recordedHoursWarnings(withCs(live), { text: R3C, recordingWording: "Our customer service is open Sunday through Thursday, from 11 AM to 4 PM." })).toEqual(["The recording on the hours line was made for different words than its approved text. Ask for a new recording."]);
  });
  it("the old fixed note is gone; the page passes the slot's text and recording words", () => {
    const src = readFileSync("src/lib/hours-schedule.ts", "utf8");
    expect(src).not.toContain("still says 11 AM to 4 PM");
    expect(readFileSync("src/app/admin/(app)/hours/page.tsx", "utf8")).toContain('recordedHoursWarnings(data, { text: promptText(prompts, "book_r3c"), recordingWording: rec?.wording ?? null })');
  });
});

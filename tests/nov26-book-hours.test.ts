import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* The customer service hours line in the Bookings menu (Abraham, Nov 26, 2026): book_r3c right after book_r3a, from
 * its uploaded recording only (off or no recording: skipped, never the Google voice), no key, bookings menu only. */
const h = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false, bookingLock: () => ({ locked: false }) }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => false, lateHoursToday: () => null }));
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => false }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { readFileSync } from "node:fs";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { MENU_RECORDINGS, menuOrder, setMenuOrder } from "@/lib/ivr/menu-order";
import { saveSetting } from "@/lib/settings";
import { defaultLayout, toggleLine, parseEditor } from "@/lib/ivr/menu-editor";

const SID = "CAbookhours";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550145" });
const R3C = "Our customer service is open Sunday through Thursday, from 11 AM to 2 PM, and at night from 7:30 PM to 10:30 PM.";
const REC = 9301;
/** The bookings menu as heard, in order: each Say's words, or "play:<recording id>" for each recording. */
const heard = (xml: string) =>
  [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>|<Play>([^<]+)<\/Play>/g)].map((m) => (m[1] ? m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&") : `play:${/(\d+)/.exec(decodeURIComponent(m[2]).replace(/^.*\/prompt-recordings?\//, ""))?.[1] ?? m[2]}`));

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await call("incoming");
});
beforeEach(async () => {
  h.overrides = { book_r3c: { text: null, audioUrl: null, recordingId: REC } };
  await saveSetting("menuOrders", "");
  await saveSetting("screenEditor" as never, {} as never);
});

describe("the slot", () => {
  it("the exact approved text and label", () => {
    expect(PROMPTS.book_r3c.text).toBe(R3C);
    expect(PROMPTS.book_r3c.label).toBe("Bookings menu, recording 3c: customer service hours");
  });
});

describe("the Bookings menu", () => {
  it("with its recording: plays right after 3a, before the next line; every other line as before", async () => {
    const xml = await call("book");
    const lines = heard(xml);
    const at = lines.indexOf(PROMPTS.book_r3a.text);
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toMatch(new RegExp(`^play:.*${REC}|${REC}`));
    expect(lines[at + 2]).toBe(PROMPTS.book_r2.text);
    expect(xml).toMatch(new RegExp(`<Play>[^<]*${REC}[^<]*</Play>`));
    expect(lines).not.toContain(R3C); // the recording, never the Google voice
    // the rest exactly as before: the same lines in the same order, without the hours recording
    h.overrides = {};
    const before = heard(await call("book"));
    expect(lines.filter((_, i) => i !== at + 1)).toEqual(before);
  });
  it("no recording: skipped silently (no Google voice)", async () => {
    h.overrides = {};
    const xml = await call("book");
    expect(heard(xml)).not.toContain(R3C);
    expect((xml.match(/<Play>[^<]*<\/Play>/g) ?? []).filter((x) => !/pause-/.test(x))).toEqual([]); // only the half-second pauses
    h.overrides = { book_r3c: { text: null, audioUrl: null, recordingId: null, googleRecordingId: 77 } }; // only a Google voice file
    expect(await call("book")).not.toMatch(/<Play>[^<]*77/);
  });
  it("turned off in Phone screens: skipped", async () => {
    const lay = defaultLayout("book");
    const i = lay.findIndex((l) => l.ref === "book_r3c");
    expect(lay[i - 1].ref).toBe("book_r3a");
    await saveSetting("screenEditor" as never, toggleLine(parseEditor({}), { layout: "book" }, i, false) as never);
    expect(await call("book")).not.toMatch(new RegExp(`<Play>[^<]*${REC}`));
  });
  it("information only: no key is tied to it (the bookings keys are unchanged)", async () => {
    const xml = await call("book");
    expect(xml.match(/<Gather [^>]*action="[^"]*book-choice/)).toBeTruthy();
    for (const [d, to] of [["0", "cs-closed"], ["8", "catalog"], ["9", "ring?k=8"], ["*", "menu"]] as const) {
      const r = await call("book-choice", { Digits: d });
      expect(r.match(/<Redirect method="POST">[^<]*\/api\/voice\/([^<]+)<\/Redirect>/)?.[1].replace(/&amp;/g, "&")).toBe(to);
    }
  });
  it("not played anywhere else: key 0 after hours", async () => {
    const xml = await call("book-choice", { Digits: "0" });
    let next = xml;
    for (let n = 0; n < 4 && !next.includes("<Gather"); n++) {
      const to = next.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
      if (!to) break;
      const [a, qs = ""] = to.split("?");
      next = await call(a, {}, Object.fromEntries(new URLSearchParams(qs)));
    }
    expect(next).not.toMatch(new RegExp(`<Play>[^<]*${REC}`));
    expect(heard(next)).not.toContain(R3C);
  });
});

describe("Admin > Phone > Menu order", () => {
  it("lists it right after 3a; Move up and Move down work on it", () => {
    expect(MENU_RECORDINGS.book.keys).toEqual(["book_r1", "book_orders_only", "book_r3a", "book_r3c", "book_r2", "book_r3b", "book_back"]);
    const order = menuOrder("book", "");
    const i = order.indexOf("book_r3c");
    const up = [...order];
    [up[i - 1], up[i]] = [up[i], up[i - 1]];
    expect(menuOrder("book", setMenuOrder("book", up, ""))).toEqual(["book_r1", "book_orders_only", "book_r3c", "book_r3a", "book_r2", "book_r3b", "book_back"]);
    const page = readFileSync("src/app/admin/(app)/phone/menu-order/page.tsx", "utf8");
    expect(page).toContain("menuOrder(menu, s.menuOrders)"); // the page lists the menu's order, so 3c shows with its arrows
  });
  it("an order saved before keeps its order, with 3c right after 3a", () => {
    const old = JSON.stringify({ book: ["book_r2", "book_r1", "book_orders_only", "book_r3a", "book_r3b", "book_back"] });
    expect(menuOrder("book", old)).toEqual(["book_r2", "book_r1", "book_orders_only", "book_r3a", "book_r3c", "book_r3b", "book_back"]);
  });
});

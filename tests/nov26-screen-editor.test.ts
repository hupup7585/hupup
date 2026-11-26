import { beforeAll, describe, expect, it, vi } from "vitest";

/* The screen editor (Abraham, Nov 26, 2026): lines in order, on/off, added lines (any recording, or typed text read by the
 * Google voice), combined recordings, and keys set in Admin. Nothing changes until the Owner turns a change on. */
const h = vi.hoisted(() => ({
  overrides: {} as Record<string, unknown>,
  session: { callSid: "CAedit", fromNumber: "+18455550149", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
  sent: [] as { to: string; body: string }[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false, bookingLock: () => ({ locked: false }) }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/sms", async (orig) => ({ ...(await orig<typeof import("@/lib/sms")>()), sendMessage: async (x: { to: string; body: string }) => (h.sent.push(x), { sent: true }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { saveSetting } from "@/lib/settings";
import { activeKey, addLine, applyLayout, defaultLayout, moveLine, parseEditor, removeLine, setKey, toggleLine, type Editor } from "@/lib/ivr/menu-editor";
import { SCREENS, screenForChoice } from "@/lib/ivr/screens";

const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAedit", ...body }, callSid: "CAedit", from: "+18455550149" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const T = (k: keyof typeof PROMPTS) => PROMPTS[k].text;
const save = async (e: Editor) => {
  await saveSetting("screenEditor" as never, e as never);
};
const NEW = "custom:cats_holiday_note";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await saveSetting("customRecordingSlots" as never, [{ key: NEW, label: "Holiday note", group: "Menu lines", text: "We are open all week.", lookup: "cats holiday note", plays: "" }] as never);
  await call("incoming");
});

describe("the rules", () => {
  it("no layout saved: exactly as built; a layout reorders, turns off, and adds lines only when on", () => {
    const parts = ["book_r2", "cart_key", "star"];
    expect(applyLayout(undefined, parts)).toEqual(parts);
    let e = parseEditor({});
    e = addLine(e, { layout: "book_r2" }, NEW, 0);
    expect(e.layouts.book_r2[0]).toEqual({ ref: NEW, on: false }); // a new line starts off
    expect(applyLayout(e.layouts.book_r2, parts)).toEqual(parts);
    e = toggleLine(e, { layout: "book_r2" }, 0, true);
    expect(applyLayout(e.layouts.book_r2, parts)).toEqual([NEW, ...parts]);
    e = moveLine(e, { layout: "book_r2" }, 2, -1); // cart_key before book_r2
    e = toggleLine(e, { layout: "book_r2" }, 3, false); // star off
    expect(applyLayout(e.layouts.book_r2, parts)).toEqual([NEW, "cart_key", "book_r2"]);
    expect(removeLine(e, { layout: "book_r2" }, 1).layouts.book_r2).toHaveLength(4); // a built line is turned off, never removed
    expect(removeLine(e, { layout: "book_r2" }, 0).layouts.book_r2.map((x) => x.ref)).not.toContain(NEW);
    expect(defaultLayout("book").map((x) => x.ref)).toEqual(["book_r1", "book_orders_only", "book_r3a", "book_r2", "book_r3b", "star"]);
  });
  it("keys: star and pound reserved; a new key needs its line on; a used key can be changed", () => {
    let e = parseEditor({});
    expect(setKey(e, "cats", { key: "*", on: true, action: { type: "back" } })).toHaveProperty("error");
    e = setKey(e, "cats", { key: "9", on: true, line: NEW, action: { type: "ring", ext: "4" } }) as Editor;
    expect(activeKey(e, "cats", "9")).toBeNull(); // its line is not on the screen yet
    e = addLine(e, { screen: "cats" }, NEW);
    expect(activeKey(e, "cats", "9")).toBeNull(); // added, still off
    e = toggleLine(e, { screen: "cats" }, 0, true);
    expect(activeKey(e, "cats", "9")?.action).toEqual({ type: "ring", ext: "4" });
    e = setKey(e, "cats", { key: "1", on: true, action: { type: "voicemail", box: "9" } }) as Editor; // 1 is used: no line needed
    expect(activeKey(e, "cats", "1")?.action.type).toBe("voicemail");
  });
  it("every screen that waits for a key is listed with its key step; key 2 and key 6 share one", () => {
    expect(Object.keys(SCREENS).length).toBeGreaterThan(60);
    expect(SCREENS.cats.choice).toBe("cats-choice");
    expect(screenForChoice("attraction-choice", new URLSearchParams("m=l"))).toBe("learn");
    expect(screenForChoice("menu-choice", new URLSearchParams())).toBe("menu");
  });
});

describe("on the call", () => {
  it("nothing saved: the categories menu plays as built", async () => {
    await save(parseEditor({}));
    expect(said(await call("cats"))).toEqual([T("book_r2"), T("cart_key"), T("book_back")]);
  });
  it("an added line, once on, plays where it sits (Google voice reads its typed text until it is recorded)", async () => {
    let e = addLine(parseEditor({}), { layout: "book_r2" }, NEW, 0);
    await save(e);
    expect(said(await call("cats"))[0]).toBe(T("book_r2")); // off: as built
    e = toggleLine(e, { layout: "book_r2" }, 0, true);
    await save(e);
    expect(said(await call("cats"))).toEqual(["We are open all week.", T("book_r2"), T("cart_key"), T("book_back")]);
  });
  it("lines at the end of any screen, and a new key: ring customer service only once its line is on", async () => {
    let e = setKey(parseEditor({}), "cats", { key: "9", on: true, line: NEW, action: { type: "ring", ext: "4" } }) as Editor;
    await save(e);
    expect(redirect(await call("cats-choice", { Digits: "9" }))).toBe("cats"); // not valid yet: as built
    e = toggleLine(addLine(e, { screen: "cats" }, NEW), { screen: "cats" }, 0, true);
    await save(e);
    expect(said(await call("cats")).at(-1)).toBe("We are open all week.");
    expect(redirect(await call("cats-choice", { Digits: "9" }))).toBe("ring?k=4");
    expect(redirect(await call("cats-choice", { Digits: "*" }))).toBe("book"); // star as built
  });
  it("key actions: play lines then back, a text to the caller, go to a menu, voicemail", async () => {
    const e = [
      { key: "4", on: true, action: { type: "play" as const, lines: ["book_r1"] } },
      { key: "5", on: true, action: { type: "text" as const, text: "Here is our address." } },
      { key: "6", on: true, action: { type: "screen" as const, target: "catalog" } },
    ].reduce((x, k) => setKey(x, "cats", k) as Editor, parseEditor({}));
    // keys 4 to 7 are used by the categories menu (items 1 to 7), so they act without a line
    await save(e);
    const play = await call("cats-choice", { Digits: "4" });
    expect(said(play)).toEqual([T("book_r1")]);
    expect(redirect(play)).toBe("cats");
    expect(redirect(await call("cats-choice", { Digits: "5" }))).toBe("cats");
    expect(h.sent.at(-1)).toMatchObject({ to: "+18455550149", body: "Here is our address." });
    expect(redirect(await call("cats-choice", { Digits: "6" }))).toBe("catalog");
  });
  it("key 7: the hours line can be turned off and a recorded line added; its combined recording plays instead", async () => {
    let e = addLine(parseEditor({}), { layout: "hours" }, NEW, 0);
    e = toggleLine(toggleLine(e, { layout: "hours" }, 0, true), { layout: "hours" }, 1, false);
    await save(e);
    expect(said(await call("hours"))).toEqual(["We are open all week."]);
    h.overrides = { whole_hours: { recordingId: 700 } };
    const xml = await call("hours");
    expect(said(xml)).toEqual([]);
    expect(xml).toMatch(/<Play>[^<]*700[^<]*<\/Play>/);
    h.overrides = {};
    await save(parseEditor({}));
  });
});

describe("Admin", () => {
  it("Owner only pages: phone screens, one screen, every recording; in the side menu", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/app/admin/(app)/phone/screens/page.tsx", "src/app/admin/(app)/phone/screens/[id]/page.tsx", "src/app/admin/(app)/phone/screens/recordings/page.tsx"]) expect(readFileSync(f, "utf8")).toContain("await requireOwner()");
    const actions = readFileSync("src/app/admin/(app)/phone/screens/actions.ts", "utf8");
    expect(actions.match(/await requireOwner\(\)/g)?.length).toBe(6);
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('"Phone screens", O]');
    void db;
    void schema;
  });
});

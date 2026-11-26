import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MENU_COMBOS, PROMPTS, lineSetFingerprint, type PromptKey, type PromptOverrides } from "@/lib/ivr/prompts";
import { applyLayout, defaultLayout, layoutIdFor, wholeFits, type Line } from "@/lib/ivr/menu-editor";

/* Hark's Phases 1-3 review, item 1 (Nov 26, 2026): a combined (whole-menu) recording plays only while the menu is
 * exactly the lines it was made for. Turn a line off, move one, add one, or change one line's words or recording,
 * and the separate lines play instead. Nothing changed: the combined recording, as today. */
const ids = Object.keys(MENU_COMBOS).filter((id) => `whole_${id}` in PROMPTS);
/** The combined recording put on the line now (its fingerprint saved with it). */
const recorded = (id: string, base: PromptOverrides = {}): PromptOverrides => ({ ...base, [`whole_${id}`]: { text: null, audioUrl: null, recordingId: 900, lineSet: lineSetFingerprint(id, base) } });
const realLines = (id: string) => MENU_COMBOS[id].filter((p) => p !== "pause" && p !== "star" && p in PROMPTS) as PromptKey[];
/** The layout the Admin page saves for this menu, all lines on (the hours line in the bookings menu stays off). */
const published = (id: string): Line[] => defaultLayout(layoutIdFor(id)).map((l) => ({ ...l, on: (MENU_COMBOS[id] as readonly string[]).includes(l.ref) }));

describe("combined recordings stop when the menu changes", () => {
  it("there are combined slots to check", () => expect(ids.length).toBeGreaterThan(3));
  it.each(ids)("%s: nothing changed -> the combined recording, as today", (id) => {
    const parts = MENU_COMBOS[id];
    expect(wholeFits(id, parts, undefined, recorded(id))).toBe(true);
    if (layoutIdFor(id) === id) expect(wholeFits(id, parts, published(id), recorded(id))).toBe(true);
  });
  it.each(ids)("%s: one line turned off -> the separate lines", (id) => {
    const parts = MENU_COMBOS[id];
    if (layoutIdFor(id) !== id) return; // shares another menu's layout: checked there
    const lay = published(id);
    const i = lay.findIndex((l) => l.on && l.ref !== "star");
    if (i < 0) return;
    lay[i] = { ...lay[i], on: false };
    expect(applyLayout(lay, parts)).not.toEqual([...parts]);
    expect(wholeFits(id, parts, lay, recorded(id))).toBe(false);
  });
  it.each(ids)("%s: lines in a new order -> the separate lines", (id) => {
    const parts = MENU_COMBOS[id];
    if (layoutIdFor(id) !== id) return;
    const lay = published(id).filter((l) => l.on);
    if (lay.length < 2) return;
    const swapped = [lay[1], lay[0], ...lay.slice(2)];
    expect(wholeFits(id, parts, swapped, recorded(id))).toBe(false);
  });
  it.each(ids)("%s: an added line -> the separate lines", (id) => {
    const parts = MENU_COMBOS[id];
    if (layoutIdFor(id) !== id) return;
    const lay = [...published(id), { ref: "custom_extra_line", on: true }];
    expect(wholeFits(id, parts, lay, recorded(id))).toBe(false);
  });
  it.each(ids)("%s: one line's words (or its recording) changed after the combined recording -> the separate lines", (id) => {
    const parts = MENU_COMBOS[id];
    const [first] = realLines(id);
    if (!first) return;
    const before = recorded(id);
    expect(wholeFits(id, parts, undefined, { ...before, [first]: { text: `${PROMPTS[first].text} Now with more words.`, audioUrl: null } })).toBe(false);
    expect(wholeFits(id, parts, undefined, { ...before, [first]: { text: null, audioUrl: null, recordingId: 4242 } })).toBe(false);
  });
  it("an older combined recording with no saved fingerprint keeps playing (as before) until it is chosen again", () => {
    const id = ids[0];
    expect(wholeFits(id, MENU_COMBOS[id], undefined, { [`whole_${id}`]: { text: null, audioUrl: null, recordingId: 7, lineSet: null } } as PromptOverrides)).toBe(true);
  });
  it("choosing a combined recording saves its fingerprint; the screen page says when it is out of date", () => {
    expect(readFileSync("src/lib/prompt-recordings.ts", "utf8")).toContain('lineSet = lineSetFingerprint(key.slice("whole_".length), await loadPromptOverrides())');
    const page = readFileSync("src/app/admin/(app)/phone/screens/[id]/page.tsx", "utf8");
    expect(page).toContain("Combined recording out of date: separate lines play");
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain("wholeFits(id, parts, editorOf(ctx).e.layouts[layoutIdFor(id)], ctx.prompts)");
    expect(flow).toContain("wholeFits(id, parts, editorOf(ctx).e.layouts.book, ctx.prompts)");
  });
});

import { MENU_COMBOS } from "@/lib/ivr/prompts";
import { SCREENS } from "@/lib/ivr/screens";

/**
 * The screen editor (Abraham, Nov 26, 2026): from Admin, with no code change, the Owner can
 *  - put a menu's lines in any order, turn any line on or off, and add a line anywhere (any recording from the list,
 *    or a new one typed in Admin) on the menus built from fixed lines;
 *  - add lines at the end of any screen that waits for a key;
 *  - choose what a key does on any screen: go to a screen, ring a staff extension (its hours and voicemail), a
 *    voicemail box, play lines then come back, send a text (or a picture text), forward the call, add an item, or go back.
 * Star and pound stay as built. A key the screen does not already use works only once its line is added and on. A new
 * line starts off. With nothing saved, every screen plays and acts exactly as built.
 * Stored in the setting `screenEditor` (JSON).
 */

export type Line = { ref: string; on: boolean };
export type KeyAction =
  | { type: "screen"; target: string }
  | { type: "ring"; ext: string }
  | { type: "voicemail"; box: string }
  | { type: "play"; lines: string[] }
  | { type: "text"; text: string; picture?: string }
  | { type: "forward"; phone: string }
  | { type: "item"; productId: number }
  | { type: "back" };
export type KeyDef = { key: string; on: boolean; line?: string; action: KeyAction };
export type Editor = { layouts: Record<string, Line[]>; extra: Record<string, Line[]>; keys: Record<string, KeyDef[]> };

export const EMPTY_EDITOR: Editor = { layouts: {}, extra: {}, keys: {} };
export const KEY_ACTIONS: Record<KeyAction["type"], string> = {
  screen: "Go to another menu or step",
  ring: "Ring a staff extension (its hours and voicemail)",
  voicemail: "Go to a voicemail box",
  play: "Play recording lines, then come back to this menu",
  text: "Send a text or picture text",
  forward: "Forward the call to a phone number",
  item: "Add an item to the cart",
  back: "Go back (the same as star)",
};

/** Built parts that are not recordings: the shared go-back line, a half pause, and key 7's hours from the Hours page. */
export const BUILT_PARTS = new Set(["star", "pause", "hours_lines"]);

/** The menu (layout) a combined slot belongs to: the coming-back bookings menu and Box 148's two endings share one. */
export function layoutIdFor(comboId: string): string {
  return comboId === "book_again" ? "book" : comboId === "pay_approved_optin" ? "pay_approved_text" : comboId;
}

/** A layout's default lines: its combined slot's lines (both variants for the shared ones), all on. */
export function defaultLayout(layoutId: string): Line[] {
  const parts = [...(MENU_COMBOS[layoutId] ?? [])];
  if (layoutId === "pay_approved_text") parts.splice(2, 0, "pay_approved_optin");
  // The customer service hours line (Nov 26, 2026) sits right after 3a, so it can be turned off in Phone screens
  if (layoutId === "book" && parts.includes("book_r3a")) parts.splice(parts.indexOf("book_r3a") + 1, 0, "book_r3c");
  return parts.filter((p) => p !== "pause").map((ref) => ({ ref, on: true }));
}

export function parseEditor(v: unknown): Editor {
  const x = (v && typeof v === "object" ? v : {}) as Partial<Editor>;
  const lines = (l: unknown): Line[] => (Array.isArray(l) ? l.filter((y) => y && typeof y.ref === "string").map((y) => ({ ref: String(y.ref), on: y.on !== false })) : []);
  const rec = <T>(o: unknown, f: (y: unknown) => T): Record<string, T> => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).map(([k, y]) => [k, f(y)]));
  return {
    layouts: rec(x.layouts, lines),
    extra: rec(x.extra, lines),
    keys: rec(x.keys, (k) => (Array.isArray(k) ? (k as KeyDef[]).filter((d) => d && /^[0-9]$/.test(d.key) && d.action && d.action.type in KEY_ACTIONS) : [])),
  };
}

/**
 * The parts to play this call: the layout's order and on/off over what the code would play now. Pauses stay with the
 * line after them; a built part missing from the layout keeps its place after the part before it; an added line plays
 * where it sits once on. No layout = exactly what the code plays.
 */
export function applyLayout(layout: Line[] | undefined, parts: readonly string[]): string[] {
  if (!layout?.length) return [...parts];
  // units: a part with the pauses just before it
  const units: { part: string; pre: number }[] = [];
  let pre = 0;
  for (const p of parts) {
    if (p === "pause") pre++;
    else {
      units.push({ part: p, pre });
      pre = 0;
    }
  }
  const present = new Map(units.map((u) => [u.part, u]));
  const inLayout = new Set(layout.map((l) => l.ref));
  const out: string[] = [];
  const emit = (u: { part: string; pre: number }) => out.push(...Array(u.pre).fill("pause"), u.part);
  for (const l of layout) {
    const u = present.get(l.ref);
    if (u) {
      if (l.on) emit(u);
    } else if (l.on && !isBuiltRef(l.ref)) out.push(l.ref); // an added line (only when on)
  }
  // built parts the layout does not know (new in the code): after the part before them, as built
  units.forEach((u, i) => {
    if (inLayout.has(u.part)) return;
    const prev = units[i - 1]?.part;
    const at = prev ? out.lastIndexOf(prev) + 1 : 0;
    out.splice(at, 0, ...Array(u.pre).fill("pause"), u.part);
  });
  return out;
}

/** A line the code itself plays somewhere (a recording slot of a screen, or a built part), not an added line. */
function isBuiltRef(ref: string): boolean {
  // book_r3c: a built bookings menu line that is skipped when it has no upload, never played as an added line
  return BUILT_PARTS.has(ref) || ref === "book_r3c" || Object.values(MENU_COMBOS).some((p) => p.includes(ref));
}

/** Is this line in the screen's lines (its layouts or its end lines) and on? */
export function lineOnAt(e: Editor, screen: string, ref: string): boolean {
  const s = SCREENS[screen];
  const lists = [...(s?.combos ?? []).map((c) => e.layouts[layoutIdFor(c)] ?? []), e.extra[screen] ?? []];
  return lists.some((l) => l.some((x) => x.ref === ref && x.on));
}

/**
 * The Owner's key for this screen, when it may act now: on, not star or pound, and (for a key the screen does not
 * already use) its line added and on.
 */
export function activeKey(e: Editor, screen: string, digit: string | undefined): KeyDef | null {
  if (!digit || !/^[0-9]$/.test(digit)) return null;
  const d = (e.keys[screen] ?? []).find((k) => k.key === digit && k.on);
  if (!d) return null;
  const built = (SCREENS[screen]?.keys ?? "").includes(digit);
  if (!built && !(d.line && lineOnAt(e, screen, d.line))) return null;
  return d;
}

/* ---------- editing (pure; the Admin actions save the result) ---------- */

const withLayout = (e: Editor, id: string, f: (l: Line[]) => Line[]): Editor => ({ ...e, layouts: { ...e.layouts, [id]: f([...(e.layouts[id] ?? defaultLayout(id))]) } });
const withExtra = (e: Editor, screen: string, f: (l: Line[]) => Line[]): Editor => ({ ...e, extra: { ...e.extra, [screen]: f([...(e.extra[screen] ?? [])]) } });
const edit = (e: Editor, where: { layout?: string; screen?: string }, f: (l: Line[]) => Line[]) => (where.layout ? withLayout(e, where.layout, f) : withExtra(e, where.screen!, f));

export function moveLine(e: Editor, where: { layout?: string; screen?: string }, index: number, dir: -1 | 1): Editor {
  return edit(e, where, (l) => {
    const j = index + dir;
    if (index < 0 || index >= l.length || j < 0 || j >= l.length) return l;
    [l[index], l[j]] = [l[j], l[index]];
    return l;
  });
}
export function toggleLine(e: Editor, where: { layout?: string; screen?: string }, index: number, on: boolean): Editor {
  return edit(e, where, (l) => l.map((x, i) => (i === index ? { ...x, on } : x)));
}
/** A new line starts off: nothing changes on the phone until the Owner turns it on. */
export function addLine(e: Editor, where: { layout?: string; screen?: string }, ref: string, at?: number): Editor {
  return edit(e, where, (l) => {
    const pos = at === undefined || at < 0 || at > l.length ? l.length : at;
    l.splice(pos, 0, { ref, on: false });
    return l;
  });
}
/** Only an added line can be removed; a built line is turned off instead. */
export function removeLine(e: Editor, where: { layout?: string; screen?: string }, index: number): Editor {
  return edit(e, where, (l) => (where.screen || !isBuiltRef(l[index]?.ref ?? "") ? l.filter((_, i) => i !== index) : l));
}

/** Set (or replace) a key on a screen. Star and pound are reserved; a key starts as the Owner chose (on or off). */
export function setKey(e: Editor, screen: string, def: KeyDef): Editor | { error: string } {
  if (!/^[0-9]$/.test(def.key)) return { error: "Choose a key from 0 to 9. Star and pound stay as built." };
  if (!SCREENS[screen]?.choice) return { error: "This step does not wait for a key." };
  const list = (e.keys[screen] ?? []).filter((k) => k.key !== def.key);
  return { ...e, keys: { ...e.keys, [screen]: [...list, def].sort((a, b) => a.key.localeCompare(b.key)) } };
}
export function removeKey(e: Editor, screen: string, key: string): Editor {
  return { ...e, keys: { ...e.keys, [screen]: (e.keys[screen] ?? []).filter((k) => k.key !== key) } };
}

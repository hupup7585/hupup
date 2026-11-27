import { MENU_COMBOS, PROMPTS, RETIRED_PROMPTS, promptRecordable, type PromptKey } from "@/lib/ivr/prompts";
import { SCREENS } from "@/lib/ivr/screens";
import { NOT_RECORDED, allSlots, pieces, KEPT_OLD_PIECES } from "@/lib/recording-slots";
import { RECORDING_USAGE } from "@/lib/recording-usage.generated";

/**
 * Recording library (Admin handoff Phase 3, section 7, Nov 26, 2026): every phone line in the code, how it is recorded
 * in Admin, which screens play it, and whether anything plays it now. Old recordings are never deleted: retired lines
 * stay listed as legacy. The counts reconcile with the Admin recording slots (tests/phase3-library.test.ts).
 */
export type LibraryKind = "one" | "pieces" | "shared" | "combined" | "voice" | "legacy";
export const KIND_LABEL: Record<LibraryKind, string> = {
  one: "One recording",
  pieces: "Recorded in pieces around the spoken values",
  shared: "Built from shared pieces",
  combined: "Combined recording for a whole menu",
  voice: "Computer voice only (no recording slot, decided earlier)",
  legacy: "Legacy: no longer played, kept with its history",
};
export const KIND_HELP: Record<LibraryKind, string> = {
  one: "The whole line is one recording. Until it is uploaded and approved, the computer voice reads the text.",
  pieces: "The line has changing parts (a date, a price, a name). The fixed words between them are recorded as pieces; the system says the changing parts.",
  shared: "The line is put together from pieces that other lines share, so one recording serves several lines.",
  combined: "One recording for a menu's fixed lines in order. It plays instead of the separate lines only while the menu's lines match it exactly.",
  voice: "The computer voice always reads this line. It has no recording slot because its words change too much to record.",
  legacy: "Retired from the call. The text and any recording stay in Admin for history; nothing plays it.",
};

export type LibraryEntry = {
  key: string;
  label: string;
  text: string;
  group: string;
  kind: LibraryKind;
  slotKeys: string[];
  screens: string[];
  files: string[];
  /** Not played by anything now (and not legacy): kept, shown so the Owner can decide. */
  unused: boolean;
};

const comboOf = (k: string) => (k.startsWith("whole_") ? k.slice(6) : null);

export function recordingLibrary(): LibraryEntry[] {
  const screensOf = new Map<string, string[]>();
  for (const [id, s] of Object.entries(SCREENS)) for (const l of new Set([...s.lines, ...s.combos.map((c) => `whole_${c}`)])) screensOf.set(l, [...(screensOf.get(l) ?? []), id]);
  return (Object.entries(PROMPTS) as [PromptKey, { label: string; text: string; group: string; parts?: string[]; textOnly?: boolean }][]).map(([key, d]) => {
    const combo = comboOf(key);
    const kind: LibraryKind = RETIRED_PROMPTS.has(key)
      ? "legacy"
      : combo && combo in MENU_COMBOS
        ? "combined"
        : NOT_RECORDED.includes(key) || d.textOnly
          ? "voice"
          : d.parts
            ? "shared"
            : promptRecordable(key)
              ? "one"
              : "pieces";
    const asPieces = () => pieces(d.text).map((_, i) => `${key}#${i + 1}`);
    const slotKeys = [
      ...(kind === "one" || kind === "combined" ? [key] : kind === "pieces" ? asPieces() : kind === "shared" ? [...(d.parts ?? [])] : kind === "legacy" ? (d.parts ? [] : promptRecordable(key) ? [key] : asPieces()) : []),
      ...(KEPT_OLD_PIECES[key] ?? []).map((x) => x.key),
    ];
    const screens = screensOf.get(key) ?? (combo ? Object.entries(SCREENS).filter(([, s]) => s.combos.includes(combo)).map(([id]) => id) : []);
    const files = RECORDING_USAGE[key] ?? [];
    return { key, label: d.label, text: d.text, group: d.group, kind, slotKeys, screens, files, unused: kind !== "legacy" && !files.length && !screens.length && !(combo && combo in MENU_COMBOS) };
  });
}

/** The reconciliation: every Admin recording slot belongs to a library line, or to the word, letter and number lists. */
export function libraryReconciliation() {
  const lib = recordingLibrary();
  const slots = allSlots();
  const fromLines = new Set(lib.flatMap((e) => e.slotKeys));
  const lineSlots = slots.filter((s) => s.kind === "line" || (s.kind === "piece" && s.key.includes("#")));
  const otherSlots = slots.length - lineSlots.length;
  const notInLibrary = lineSlots.filter((s) => !fromLines.has(s.key)).map((s) => s.key);
  const byKind = Object.fromEntries((Object.keys(KIND_LABEL) as LibraryKind[]).map((k) => [k, lib.filter((e) => e.kind === k).length])) as Record<LibraryKind, number>;
  return { lines: lib.length, byKind, adminSlots: slots.length, lineSlots: lineSlots.length, otherSlots, notInLibrary, unused: lib.filter((e) => e.unused).map((e) => e.key) };
}

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Slot } from "@/lib/recording-slots";
import { numberWords, townSlotKey } from "@/lib/spoken-words";
import { streetSlotKey, unitSlotKey } from "@/lib/streets";

/**
 * Recording slots added in Admin (Abraham, Nov 23, 2026): Hark names a slot, picks its group, types its exact spoken
 * text, its lookup key and where it plays, with no code change. The lookup key is what live joining uses (a street's
 * spoken name, zip 10930, unit 301, number 25): a key with a live recording is played, else Puck says it. A new slot
 * never goes live by itself: its upload waits for the Owner's Use this one, like every slot.
 */
const SETTING = "customRecordingSlots";

export const SLOT_GROUPS = ["Streets", "Towns", "Zip codes", "Unit numbers", "Number words", "Letters", "Address steps", "Box lines", "Other"] as const;

export type CustomSlot = { key: string; label: string; group: string; text: string; lookup: string; plays: string };

/** The slot key live joining looks for, from the group and the lookup key. Null = the lookup key does not fit. */
export function slotKeyFor(group: string, lookup: string): string | null {
  const v = lookup.trim();
  if (!v) return null;
  switch (group.trim().toLowerCase()) {
    case "streets":
      return streetSlotKey(v);
    case "towns":
      return townSlotKey(v);
    case "zip codes":
      return /^\d{5}$/.test(v) ? `zip:${v}` : null;
    case "unit numbers":
      return /^[0-9A-Za-z-]{1,8}$/.test(v) ? unitSlotKey(v) : null;
    case "number words": {
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n < 1000 && numberWords(n).length ? `word:${numberWords(n).join(" ")}` : null;
    }
    case "letters":
      return /^[A-Za-z]$/.test(v) ? `letter:${v.toLowerCase()}` : null;
    default: {
      const slug = v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
      return slug ? `custom:${slug}` : null;
    }
  }
}

async function readList(): Promise<CustomSlot[]> {
  try {
    const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, SETTING)).limit(1);
    return Array.isArray(row?.value) ? (row!.value as CustomSlot[]).filter((x) => x && x.key && x.text) : [];
  } catch {
    return [];
  }
}

async function writeList(list: CustomSlot[], userId: number | null) {
  await db
    .insert(schema.appSettings)
    .values({ key: SETTING, value: list, updatedAt: new Date(), updatedBy: userId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: list, updatedAt: new Date(), updatedBy: userId } });
}

export async function customSlotList(): Promise<CustomSlot[]> {
  return readList();
}

export async function customSlots(): Promise<Slot[]> {
  return (await readList()).map((x) => ({ key: x.key, kind: "line" as const, group: x.group, label: x.label, text: x.text }));
}

export type NewSlot = { name: string; group: string; text: string; lookup: string; plays?: string };

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/** Checks one new slot; a duplicate key in the same group warns and is not saved. */
function check(input: NewSlot, existing: { key: string; group: string }[]): { ok: true; slot: CustomSlot } | { ok: false; message: string } {
  const name = clean(input.name);
  const group = clean(input.group);
  const text = clean(input.text);
  const lookup = clean(input.lookup);
  const plays = clean(input.plays ?? "");
  if (!name || !group || !text || !lookup) return { ok: false, message: "Fill in the slot name, the group, the exact text and the lookup key." };
  if (name.length > 120 || group.length > 60 || text.length > 1200 || lookup.length > 120 || plays.length > 200) return { ok: false, message: "Something is too long. Keep the name under 120 letters and the text under 1,200." };
  if (/\b\w+'(t|s|re|ll|ve|d|m)\b/i.test(text) && !/\blet's\b/i.test(text)) return { ok: false, message: "No contractions in a prompt. Please write the words in full." };
  const key = slotKeyFor(group, lookup);
  if (!key) return { ok: false, message: `The lookup key "${lookup}" does not fit the group ${group} (for example: a street's spoken name, zip 10930, unit 301, number 25, letter A).` };
  const dup = existing.find((e) => e.key === key);
  if (dup && dup.group.toLowerCase() === group.toLowerCase()) return { ok: false, message: `That lookup key is already used in ${group}.` };
  if (dup) return { ok: false, message: `That lookup key is already used in the group ${dup.group}.` };
  return { ok: true, slot: { key, label: name, group, text, lookup, plays } };
}

export async function addCustomSlot(input: NewSlot, existing: { key: string; group: string }[], userId: number | null): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const r = check(input, existing);
  if (!r.ok) return r;
  await writeList([...(await readList()), r.slot], userId);
  return { ok: true, key: r.slot.key };
}

/** Many slots at once (CSV: name, group, exact text, key). Every row is checked; only good rows are saved. */
export async function addCustomSlots(rows: NewSlot[], existing: { key: string; group: string }[], userId: number | null): Promise<{ added: number; problems: { line: number; message: string }[] }> {
  const list = await readList();
  const seen = [...existing];
  const problems: { line: number; message: string }[] = [];
  let added = 0;
  rows.forEach((row, i) => {
    const r = check(row, seen);
    if (!r.ok) return void problems.push({ line: i + 2, message: r.message });
    list.push(r.slot);
    seen.push({ key: r.slot.key, group: r.slot.group });
    added++;
  });
  if (added) await writeList(list, userId);
  return { added, problems };
}

export async function renameCustomSlot(key: string, name: string, userId: number | null): Promise<{ ok: boolean; message: string }> {
  const n = clean(name);
  if (!n || n.length > 120) return { ok: false, message: "Type a name under 120 letters." };
  const list = await readList();
  const s = list.find((x) => x.key === key);
  if (!s) return { ok: false, message: "Only slots added in Admin can be renamed here." };
  s.label = n;
  await writeList(list, userId);
  return { ok: true, message: "Saved" };
}

/** Owner only (checked by the caller), after the Are you sure check. The recordings stay in the history. */
export async function deleteCustomSlot(key: string, userId: number | null): Promise<{ ok: boolean; message: string }> {
  const list = await readList();
  if (!list.some((x) => x.key === key)) return { ok: false, message: "Only slots added in Admin can be deleted." };
  await writeList(list.filter((x) => x.key !== key), userId);
  return { ok: true, message: "Deleted" };
}

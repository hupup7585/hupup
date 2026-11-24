import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { STREETS, findStreet } from "@/lib/streets";

/*
 * Street step search (Abraham, Nov 24, 2026): the street is searched in the real street list of the zip code the caller
 * already entered. Voice (key 1): the closest street to what was said. Keypad (key 2): the streets that start with the
 * first four letters typed.
 */

const SUFFIXES: Record<string, string> = {
  RD: "Road", DR: "Drive", CT: "Court", AVE: "Avenue", AV: "Avenue", LN: "Lane", ST: "Street", BLVD: "Boulevard", PKWY: "Parkway",
  CRES: "Crescent", PL: "Place", TER: "Terrace", TERR: "Terrace", CIR: "Circle", HWY: "Highway", TPKE: "Turnpike", TRL: "Trail", SQ: "Square", HTS: "Heights", EXT: "Extension",
};

/** The street as said aloud: from our list ("ACRES RD" = "Acres Road"), else the printed name with the short forms written out. */
export function spokenStreet(printed: string): string {
  const listed = findStreet(printed);
  if (listed) return listed.spoken;
  return printed
    .trim()
    .split(/\s+/)
    .map((w) => SUFFIXES[w.toUpperCase().replace(/\.$/, "")] ?? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** The streets of one zip code, as said aloud: the directory's streets for that zip; none there = our whole list. */
export async function streetsForZip(zip: string | undefined | null): Promise<string[]> {
  let rows: { street: string }[] = [];
  if (zip) {
    try {
      rows = await db
        .selectDistinct({ street: schema.directoryEntries.street })
        .from(schema.directoryEntries)
        .where(and(eq(schema.directoryEntries.zip, zip), sql`${schema.directoryEntries.street} <> ''`));
    } catch {
      rows = [];
    }
  }
  const names = rows.length ? rows.map((r) => spokenStreet(r.street)) : STREETS.map((s) => s.spoken);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const TYPE_WORDS = new Set(Object.values(SUFFIXES).map((w) => w.toLowerCase()));
/** The name without "Road", "Drive" and the like (callers often leave them out). */
const core = (s: string) => letters(s.split(/\s+/).filter((w) => !TYPE_WORDS.has(w.toLowerCase())).join(" ")) || letters(s);

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** How far a street is from what was heard (0 = the same); the full name or the name without its type word. */
function score(heard: string, street: string): number {
  const h = letters(heard);
  const hc = core(heard);
  const full = distance(h, letters(street)) / Math.max(h.length, letters(street).length, 1);
  const short = distance(hc, core(street)) / Math.max(hc.length, core(street).length, 1);
  // The full name breaks a tie ("Forest Road" over "Forest Avenue" when the caller said "Forest Road")
  return Math.min(full, short) + full / 100;
}

/** Voice: the closest street in the list to what was said (null only when nothing was said or the list is empty). */
export function closestStreet(heard: string, list: readonly string[]): string | null {
  if (!letters(heard) || !list.length) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const s of list) {
    const x = score(heard, s);
    if (x < bestScore) [best, bestScore] = [s, x];
  }
  return best;
}

/** Keypad: the streets that start with the first four letters typed (spaces and short words ignored). */
export function streetsByPrefix(typed: string, list: readonly string[]): string[] {
  const p = letters(typed).slice(0, 4);
  if (!p) return [];
  return list.filter((s) => letters(s).startsWith(p));
}

/** An exact name among the matches (the caller typed the whole name). */
export function exactStreet(typed: string, list: readonly string[]): string | null {
  const t = letters(typed);
  return list.find((s) => letters(s) === t || core(s) === t) ?? null;
}

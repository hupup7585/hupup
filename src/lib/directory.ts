import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DirectoryRow } from "@/lib/directory-list";

/**
 * The community directory in the database (Abraham, Nov 23, 2026). Owner only in Admin; on the phone line it is only
 * ever used for the caller's own number (caller ID), never read to anyone else.
 */

/** Replaces the whole list with these rows (the file is the list). */
export async function loadDirectory(rows: DirectoryRow[]): Promise<number> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.directoryEntries);
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(schema.directoryEntries).values(
        rows.slice(i, i + 500).map((r, j) => ({ sortOrder: i + j + 1, yiddishLastName: r.yiddishLastName ?? "", yiddishFirstName: r.yiddishFirstName ?? "", lastName: r.lastName, firstName: r.firstName, house: r.house, street: r.street, unit: r.unit, town: r.town, state: r.state, zip: r.zip, phone: r.phone, areaPrinted: r.areaPrinted })),
      );
    }
  });
  return rows.length;
}

export async function directoryCount(): Promise<{ rows: number; phones: number; shared: number }> {
  const r = (
    await db.execute(sql`SELECT COUNT(*)::int AS rows, COUNT(DISTINCT phone)::int AS phones,
      (SELECT COUNT(*)::int FROM (SELECT phone FROM directory_entries WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1) s) AS shared
      FROM directory_entries`)
  ).rows[0] as { rows: number; phones: number; shared: number } | undefined;
  return r ?? { rows: 0, phones: 0, shared: 0 };
}

export type DirectoryEntry = typeof schema.directoryEntries.$inferSelect;

/** The entries for this exact phone number (E.164). */
export async function lookupByPhone(phone: string | null | undefined): Promise<DirectoryEntry[]> {
  if (!phone) return [];
  try {
    return await db.select().from(schema.directoryEntries).where(eq(schema.directoryEntries.phone, phone)).orderBy(schema.directoryEntries.id).limit(10);
  } catch {
    return []; // the table is not there yet (before the update runs)
  }
}

/**
 * Directory address match (Abraham, Nov 25, 2026) for an address the caller entered by hand: house number, street,
 * unit and zip must all be equal after normalizing (short forms written out; capitals, spaces, periods and commas
 * ignored). Each apartment is its own household, matched only by its own unit; no unit matches only an entry with no
 * unit. Two different households at the very same address and unit (pending Abraham) = no match.
 */
export async function matchDirectoryAddress(a: { house: string; street: string; unit?: string | null; zip: string }): Promise<DirectoryEntry | null> {
  const { houseKey, streetKey, unitKey } = await import("@/lib/street-search");
  const zip = a.zip.replace(/\D/g, "");
  if (!zip || !houseKey(a.house) || !streetKey(a.street)) return null;
  let rows: DirectoryEntry[] = [];
  try {
    rows = await db.select().from(schema.directoryEntries).where(eq(schema.directoryEntries.zip, zip));
  } catch {
    return null;
  }
  const hits = rows.filter((r) => houseKey(r.house) === houseKey(a.house) && streetKey(r.street) === streetKey(a.street) && unitKey(r.unit) === unitKey(a.unit));
  const households = new Set(hits.map((r) => `${r.lastName.trim().toUpperCase()}|${r.firstName.trim().toUpperCase()}`));
  return households.size === 1 ? hits[0] : null;
}

/** Is any household listed at this house number and street (any unit; the zip too when given)? (Nov 25, 2026, unit step) */
/**
 * Hark's 2nd phone check, B7 (Nov 26, 2026): what the directory says about units at this house. "units" = every entry
 * there has a unit (the unit is required); "none" = no entry has one (a one-family house: no unit asked); "mixed" =
 * some do, some don't (the usual unit question); null = the house is not in the directory.
 */
export async function directoryHouseUnits(a: { house: string; street: string; zip?: string | null }): Promise<"units" | "none" | "mixed" | null> {
  const { houseKey, streetKey } = await import("@/lib/street-search");
  if (!houseKey(a.house) || !streetKey(a.street)) return null;
  const zip = a.zip?.replace(/\D/g, "");
  let rows: DirectoryEntry[] = [];
  try {
    rows = zip ? await db.select().from(schema.directoryEntries).where(eq(schema.directoryEntries.zip, zip)) : await db.select().from(schema.directoryEntries);
  } catch {
    return null;
  }
  const here = rows.filter((r) => houseKey(r.house) === houseKey(a.house) && streetKey(r.street) === streetKey(a.street));
  if (!here.length) return null;
  const withUnit = here.filter((r) => (r.unit ?? "").trim()).length;
  return withUnit === here.length ? "units" : withUnit === 0 ? "none" : "mixed";
}

export async function directoryHasHouse(a: { house: string; street: string; zip?: string | null }): Promise<boolean> {
  const { houseKey, streetKey } = await import("@/lib/street-search");
  if (!houseKey(a.house) || !streetKey(a.street)) return false;
  const zip = a.zip?.replace(/\D/g, "");
  let rows: DirectoryEntry[] = [];
  try {
    rows = zip ? await db.select().from(schema.directoryEntries).where(eq(schema.directoryEntries.zip, zip)) : await db.select().from(schema.directoryEntries);
  } catch {
    return false;
  }
  return rows.some((r) => houseKey(r.house) === houseKey(a.house) && streetKey(r.street) === streetKey(a.street));
}

/** The household name as the directory has it, last name first ("Schwartz, Avram"); last name only = just the last name. */
export function householdName(e: { lastName: string; firstName: string }): string {
  return [e.lastName.trim(), e.firstName.trim()].filter(Boolean).join(", ");
}

/** Entries with no unit (Abraham asked how many, Nov 25, 2026). */
export async function entriesWithoutUnit(): Promise<number> {
  const r = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM directory_entries WHERE coalesce(trim(unit), '') = ''`)).rows[0] as { n: number } | undefined;
  return r?.n ?? 0;
}

export type NewDirectoryEntry = { lastName: string; firstName: string; phone: string | null; house: string; street: string; unit: string | null; town: string; zip: string };

/**
 * Add a name (Abraham, Nov 23, 2026): one entry into the same directory, without reloading the list. The phone lookup
 * reads the table directly, so the new entry is found right away. Returns the other entries already on that number.
 */
export async function addDirectoryEntry(e: NewDirectoryEntry, opts: { allowShared: boolean }): Promise<{ ok: true; id: number } | { ok: false; sharedWith: string[] }> {
  if (e.phone && !opts.allowShared) {
    const same = await lookupByPhone(e.phone);
    if (same.length) return { ok: false, sharedWith: same.map((s) => `${s.lastName}, ${s.firstName} (${s.house} ${s.street}${s.unit ? `, unit ${s.unit}` : ""}, ${s.town})`) };
  }
  const [row] = await db
    .insert(schema.directoryEntries)
    .values({ lastName: e.lastName, firstName: e.firstName, house: e.house, street: e.street, unit: e.unit, town: e.town, state: "NY", zip: e.zip, phone: e.phone, areaPrinted: null })
    .returning({ id: schema.directoryEntries.id });
  return { ok: true, id: row.id };
}

export async function removeDirectoryEntry(id: number): Promise<boolean> {
  const r = await db.delete(schema.directoryEntries).where(eq(schema.directoryEntries.id, id)).returning({ id: schema.directoryEntries.id });
  return r.length > 0;
}

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

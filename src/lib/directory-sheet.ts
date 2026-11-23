import { and, asc, eq, gt, lt, ne, desc, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { directoryPhone, splitTownStateZip } from "@/lib/directory-list";
import { formatPhone } from "@/lib/phone";
import { buildXlsx } from "@/lib/xlsx";

/**
 * The Directory list as a sheet (Abraham, Nov 23, 2026): Owner only. Every cell saves right away; the phone lookup reads
 * the same table, so a change is used on the next call.
 */
export const SHEET_COLUMNS = [
  { key: "yiddishLastName", label: "Yiddish last name", rtl: true },
  { key: "yiddishFirstName", label: "Yiddish first name", rtl: true },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "house", label: "House number" },
  { key: "street", label: "Street" },
  { key: "unit", label: "Unit" },
  { key: "place", label: "Town, state and zip" },
  { key: "phone", label: "Phone" },
  { key: "areaPrinted", label: "Area as printed" },
] as const;
export type SheetKey = (typeof SHEET_COLUMNS)[number]["key"];
export const SHEET_KEYS = SHEET_COLUMNS.map((c) => c.key) as SheetKey[];

/** One row as the sheet shows it: id plus the ten cells as text. */
export type SheetRow = { id: number } & Record<SheetKey, string>;
type Entry = typeof schema.directoryEntries.$inferSelect;

export const placeText = (e: { town: string; state: string; zip: string }) => (e.town || e.zip ? `${e.town}${e.town ? ", " : ""}${e.state || "NY"} ${e.zip}`.trim() : "");
export const phoneText = (p: string | null) => (p ? formatPhone(p) : "");

export function toSheetRow(e: Entry): SheetRow {
  return {
    id: e.id,
    yiddishLastName: e.yiddishLastName ?? "",
    yiddishFirstName: e.yiddishFirstName ?? "",
    lastName: e.lastName,
    firstName: e.firstName,
    house: e.house,
    street: e.street,
    unit: e.unit ?? "",
    place: placeText(e),
    phone: phoneText(e.phone),
    areaPrinted: e.areaPrinted ?? "",
  };
}

export async function sheetRows(): Promise<SheetRow[]> {
  const rows = await db.select().from(schema.directoryEntries).orderBy(asc(schema.directoryEntries.sortOrder), asc(schema.directoryEntries.id));
  return rows.map(toSheetRow);
}

/** A cell's text to what is stored, or the reason it cannot be saved. */
export function cellPatch(key: SheetKey, raw: string): { patch: Partial<Entry> } | { error: string } {
  const v = raw.replace(/\s+/g, " ").trim();
  switch (key) {
    case "place": {
      if (!v) return { patch: { town: "", state: "NY", zip: "" } };
      const p = splitTownStateZip(v);
      return p ? { patch: p } : { error: 'Write the town, state and zip like "Monroe, NY 10950".' };
    }
    case "phone": {
      if (!v) return { patch: { phone: null } };
      const p = directoryPhone(v);
      return p ? { patch: { phone: p } } : { error: "The phone number must be 10 digits (or 7, for 845)." };
    }
    case "unit":
      return { patch: { unit: v || null } };
    case "areaPrinted":
      return { patch: { areaPrinted: v || null } };
    default:
      if (v.length > 120) return { error: "That is too long for one cell." };
      return { patch: { [key]: v } as Partial<Entry> };
  }
}

/** The other entries on this phone number (for the shared-number warning). */
export async function othersOnPhone(phone: string, exceptId: number | null): Promise<string[]> {
  const rows = await db
    .select()
    .from(schema.directoryEntries)
    .where(exceptId ? and(eq(schema.directoryEntries.phone, phone), ne(schema.directoryEntries.id, exceptId)) : eq(schema.directoryEntries.phone, phone))
    .limit(10);
  return rows.map((s) => `${s.lastName}, ${s.firstName} (${s.house} ${s.street}${s.unit ? `, unit ${s.unit}` : ""}, ${s.town})`);
}

export type SaveResult = { ok: true; row: SheetRow } | { ok: false; error?: string; sharedWith?: string[] };

/** Several cells of one row (one cell, or a pasted row). A phone already in the directory asks first. */
export async function saveCells(id: number, cells: Partial<Record<SheetKey, string>>, opts: { allowShared: boolean }): Promise<SaveResult> {
  let patch: Partial<Entry> = {};
  for (const [k, raw] of Object.entries(cells) as [SheetKey, string][]) {
    if (!SHEET_KEYS.includes(k)) continue;
    const r = cellPatch(k, raw ?? "");
    if ("error" in r) return { ok: false, error: r.error };
    patch = { ...patch, ...r.patch };
  }
  const [before] = await db.select().from(schema.directoryEntries).where(eq(schema.directoryEntries.id, id)).limit(1);
  if (!before) return { ok: false, error: "This row is no longer in the list. Please reload the page." };
  if (patch.phone && patch.phone !== before.phone && !opts.allowShared) {
    const others = await othersOnPhone(patch.phone, id);
    if (others.length) return { ok: false, sharedWith: others };
  }
  if (!Object.keys(patch).length) return { ok: true, row: toSheetRow(before) };
  const [after] = await db.update(schema.directoryEntries).set(patch).where(eq(schema.directoryEntries.id, id)).returning();
  return { ok: true, row: toSheetRow(after) };
}

/** A new empty row at the end, or right above or below another row. */
export async function insertRow(where: { at: "end" } | { at: "above" | "below"; id: number }): Promise<SheetRow> {
  let order: number;
  if (where.at === "end") {
    const [last] = await db.select({ o: schema.directoryEntries.sortOrder }).from(schema.directoryEntries).orderBy(desc(schema.directoryEntries.sortOrder)).limit(1);
    order = (last?.o ?? 0) + 1;
  } else {
    const [ref] = await db.select().from(schema.directoryEntries).where(eq(schema.directoryEntries.id, where.id)).limit(1);
    if (!ref) throw new Error("That row is no longer in the list.");
    const here = ref.sortOrder ?? ref.id;
    const [next] =
      where.at === "below"
        ? await db.select({ o: schema.directoryEntries.sortOrder }).from(schema.directoryEntries).where(gt(schema.directoryEntries.sortOrder, here)).orderBy(asc(schema.directoryEntries.sortOrder)).limit(1)
        : await db.select({ o: schema.directoryEntries.sortOrder }).from(schema.directoryEntries).where(lt(schema.directoryEntries.sortOrder, here)).orderBy(desc(schema.directoryEntries.sortOrder)).limit(1);
    const other = next?.o ?? (where.at === "below" ? here + 2 : here - 2);
    order = (here + other) / 2;
  }
  const [row] = await db
    .insert(schema.directoryEntries)
    .values({ lastName: "", firstName: "", house: "", street: "", town: "", state: "NY", zip: "", phone: null, sortOrder: order })
    .returning();
  return toSheetRow(row);
}

/** Delete a row; the whole entry comes back so Undo can put it back exactly. */
export async function deleteRow(id: number): Promise<Entry | null> {
  const [row] = await db.delete(schema.directoryEntries).where(eq(schema.directoryEntries.id, id)).returning();
  return row ?? null;
}

export async function restoreRow(e: Entry): Promise<SheetRow> {
  const [row] = await db
    .insert(schema.directoryEntries)
    .values({ ...e, createdAt: new Date(e.createdAt) })
    .onConflictDoNothing()
    .returning();
  // Keep the id counter ahead of a restored id
  await db.execute(sql`SELECT setval(pg_get_serial_sequence('directory_entries', 'id'), GREATEST((SELECT MAX(id) FROM directory_entries), 1))`).catch(() => null);
  return toSheetRow(row ?? e);
}

/** The whole list, all ten columns, for Download. */
export async function sheetTable(): Promise<{ header: string[]; rows: string[][] }> {
  const rows = await sheetRows();
  return { header: SHEET_COLUMNS.map((c) => c.label), rows: rows.map((r) => SHEET_KEYS.map((k) => r[k])) };
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s);

/** CSV with a byte-order mark, so Excel shows the Hebrew letters. */
export function toCsv(t: { header: string[]; rows: string[][] }): string {
  return "﻿" + [t.header, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function toXlsx(t: { header: string[]; rows: string[][] }): Buffer {
  return buildXlsx([{ name: "Directory list", header: t.header, rows: t.rows }]);
}

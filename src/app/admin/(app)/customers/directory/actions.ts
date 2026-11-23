"use server";

import { requireOwner } from "@/lib/auth";
import { parseDirectoryCsv } from "@/lib/directory-list";
import { formatPhone } from "@/lib/phone";

export type DirectoryPreview = {
  ok: boolean;
  message?: string;
  rows?: number;
  bloomingGrove?: number;
  towns?: { town: string; count: number }[];
  sample?: string[];
  issues?: { line: number; reason: string; text: string }[];
  issueCount?: number;
  shared?: { phone: string; names: string[] }[];
};

/**
 * Owner only (Abraham, Nov 22, 2026): checks the directory file and shows what would be loaded. Nothing is saved:
 * loading waits for Abraham's OK.
 */
export async function previewDirectoryAction(form: FormData): Promise<DirectoryPreview> {
  await requireOwner();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the CSV file first." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, message: "The file is larger than 10 MB." };
  const { rows, issues, sharedPhones } = parseDirectoryCsv(await file.text());
  const towns = new Map<string, number>();
  for (const r of rows) towns.set(r.town, (towns.get(r.town) ?? 0) + 1);
  return {
    ok: true,
    rows: rows.length,
    bloomingGrove: rows.filter((r) => /blooming\s*grove/i.test(r.areaPrinted ?? "")).length,
    towns: [...towns.entries()].sort((a, b) => b[1] - a[1]).map(([town, count]) => ({ town, count })),
    sample: rows.slice(0, 5).map((r) => `${r.lastName}, ${r.firstName} | ${r.house} ${r.street}${r.unit ? `, unit ${r.unit}` : ""} | ${r.town}, ${r.state} ${r.zip} | ${formatPhone(r.phone)}${r.areaPrinted ? ` | ${r.areaPrinted}` : ""}`),
    issues: issues.slice(0, 50),
    issueCount: issues.length,
    shared: sharedPhones.map((s) => ({ phone: formatPhone(s.phone), names: s.names })),
  };
}

/** Owner only (Abraham, Nov 23, 2026: the list is final): replaces the directory with this file. Audited. */
export async function loadDirectoryAction(form: FormData): Promise<{ ok: boolean; message: string }> {
  const me = await requireOwner();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the CSV file first." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, message: "The file is larger than 10 MB." };
  const { rows, issues } = parseDirectoryCsv(await file.text());
  if (!rows.length) return { ok: false, message: "No rows to load." };
  const { loadDirectory } = await import("@/lib/directory");
  const n = await loadDirectory(rows);
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.auditLog).values({ userId: me.userId, action: "directory.loaded", entityType: "directory", entityId: "all", after: { rows: n, skipped: issues.length } });
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/admin/customers/directory");
  return { ok: true, message: `Saved: ${n} rows loaded${issues.length ? `, ${issues.length} rows with a problem not loaded` : ""}.` };
}

export type AddNameResult = { ok: boolean; message: string; sharedWith?: string[] };

/** Owner only (Abraham, Nov 23, 2026): Add a name, one entry at a time. A number already in the directory asks first. */
export async function addDirectoryNameAction(form: FormData, allowShared = false): Promise<AddNameResult> {
  const me = await requireOwner();
  const v = (k: string) => String(form.get(k) ?? "").trim();
  const { STREETS } = await import("@/lib/streets");
  const lastName = v("lastName");
  const firstName = v("firstName");
  const house = v("house");
  const street = STREETS.find((s) => s.name === v("street"))?.name;
  const unit = v("unit") || null;
  const town = v("town");
  const zip = v("zip");
  const digits = v("phone").replace(/\D/g, "");
  if (!lastName || !firstName) return { ok: false, message: "Enter the last name and first name." };
  if (digits && digits.length !== 10) return { ok: false, message: "The phone number must be 10 digits, or leave it empty." };
  if (!house) return { ok: false, message: "Enter the house number." };
  if (!street) return { ok: false, message: "Pick the street from the list." };
  if (!town) return { ok: false, message: "Enter the town." };
  if (!/^\d{5}$/.test(zip)) return { ok: false, message: "The zip code must be 5 digits." };
  const phone = digits ? `+1${digits}` : null;
  const { addDirectoryEntry } = await import("@/lib/directory");
  const r = await addDirectoryEntry({ lastName, firstName, phone, house, street, unit, town, zip }, { allowShared });
  if (!r.ok) return { ok: false, message: "", sharedWith: r.sharedWith };
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.auditLog).values({ userId: me.userId, action: "directory.added", entityType: "directory_entry", entityId: String(r.id), after: { lastName, firstName, phone, house, street, unit, town, zip, shared: allowShared } });
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/admin/customers/directory");
  return { ok: true, message: "Saved" };
}

/** Owner only: removes one entry added with Add a name (a test entry, or a mistake). Audited. */
export async function removeDirectoryNameAction(id: number): Promise<{ ok: boolean }> {
  const me = await requireOwner();
  const { removeDirectoryEntry } = await import("@/lib/directory");
  const ok = await removeDirectoryEntry(id);
  const { db, schema } = await import("@/lib/db");
  if (ok) await db.insert(schema.auditLog).values({ userId: me.userId, action: "directory.removed", entityType: "directory_entry", entityId: String(id) });
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/admin/customers/directory");
  return { ok };
}

/** Owner only: what the phone lookup finds for a number (the same lookup the phone line uses, right away). */
export async function lookupDirectoryPhoneAction(raw: string): Promise<{ ok: boolean; message?: string; found?: string[] }> {
  await requireOwner();
  const d = raw.replace(/\D/g, "");
  if (d.length !== 10) return { ok: false, message: "Enter a 10-digit phone number." };
  const { lookupByPhone } = await import("@/lib/directory");
  const rows = await lookupByPhone(`+1${d}`);
  return { ok: true, found: rows.map((s) => `${s.lastName}, ${s.firstName} | ${s.house} ${s.street}${s.unit ? `, unit ${s.unit}` : ""} | ${s.town}, ${s.state} ${s.zip}`) };
}

/* ---------- The Directory list as a sheet (Abraham, Nov 23, 2026), Owner only; every change audited ---------- */
type SheetKeyT = import("@/lib/directory-sheet").SheetKey;
type SheetRowT = import("@/lib/directory-sheet").SheetRow;

async function audit(userId: number | null, action: string, id: number | string, after?: Record<string, unknown>, before?: Record<string, unknown>) {
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.auditLog).values({ userId, action, entityType: "directory_entry", entityId: String(id), after: after ?? null, before: before ?? null });
}

export async function sheetRowsAction(): Promise<SheetRowT[]> {
  await requireOwner();
  const { sheetRows } = await import("@/lib/directory-sheet");
  return sheetRows();
}

/** One cell, or a pasted row. A phone number already in the directory comes back with sharedWith, nothing saved. */
export async function saveCellsAction(id: number, cells: Partial<Record<SheetKeyT, string>>, allowShared = false): Promise<{ ok: boolean; row?: SheetRowT; error?: string; sharedWith?: string[] }> {
  const me = await requireOwner();
  try {
    const { saveCells } = await import("@/lib/directory-sheet");
    const r = await saveCells(id, cells, { allowShared });
    if (r.ok) await audit(me.userId, "directory.edited", id, { ...cells, ...(allowShared ? { shared: true } : {}) });
    return r;
  } catch {
    return { ok: false };
  }
}

export async function insertRowAction(where: { at: "end" } | { at: "above" | "below"; id: number }): Promise<{ ok: boolean; row?: SheetRowT }> {
  const me = await requireOwner();
  try {
    const { insertRow } = await import("@/lib/directory-sheet");
    const row = await insertRow(where);
    await audit(me.userId, "directory.row_added", row.id, where);
    return { ok: true, row };
  } catch {
    return { ok: false };
  }
}

/** Delete; the deleted entry comes back (as a token) so Undo can restore it exactly. */
export async function deleteRowAction(id: number): Promise<{ ok: boolean; undo?: string }> {
  const me = await requireOwner();
  try {
    const { deleteRow } = await import("@/lib/directory-sheet");
    const row = await deleteRow(id);
    if (!row) return { ok: false };
    await audit(me.userId, "directory.row_deleted", id, undefined, row as unknown as Record<string, unknown>);
    return { ok: true, undo: JSON.stringify(row) };
  } catch {
    return { ok: false };
  }
}

export async function undoDeleteAction(undo: string): Promise<{ ok: boolean; row?: SheetRowT }> {
  const me = await requireOwner();
  try {
    const e = JSON.parse(undo);
    if (!e || typeof e.id !== "number") return { ok: false };
    const { restoreRow } = await import("@/lib/directory-sheet");
    const row = await restoreRow(e);
    await audit(me.userId, "directory.row_restored", row.id);
    return { ok: true, row };
  } catch {
    return { ok: false };
  }
}

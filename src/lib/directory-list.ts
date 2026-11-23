import { parseCsv } from "@/lib/books";

/**
 * The community directory list (Abraham, Nov 22, 2026): the address-lookup source, kept apart from customer
 * accounts. Columns, in this order, with a header row: last name, first name, house number, street, unit,
 * town/state/zip, phone, area as printed. Every 7-digit phone number is 845.
 */
export const DIRECTORY_COLUMNS = ["last name", "first name", "house number", "street", "unit", "town/state/zip", "phone", "area as printed"] as const;

export type DirectoryRow = { lastName: string; firstName: string; house: string; street: string; unit: string | null; town: string; state: string; zip: string; phone: string; areaPrinted: string | null };
export type DirectoryIssue = { line: number; reason: string; text: string };

/** "8452382784", "238-2784", "(845) 238-2784" -> +18452382784; anything else is null. */
export function directoryPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 7) return `+1845${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** "Monroe, NY 10950" / "Monroe NY 10950" / "Highland Mills, New York 10930". */
export function splitTownStateZip(raw: string): { town: string; state: string; zip: string } | null {
  const m = /^\s*(.+?)[,\s]+(NY|N\.Y\.|New York)[,\s]+(\d{5})(?:-\d{4})?\s*$/i.exec(raw);
  return m ? { town: m[1].replace(/,$/, "").trim(), state: "NY", zip: m[3] } : null;
}

export function parseDirectoryCsv(text: string): { rows: DirectoryRow[]; issues: DirectoryIssue[]; sharedPhones: { phone: string; names: string[] }[] } {
  const all = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  const head = (all[0] ?? []).map((c) => c.trim().toLowerCase());
  const hasHeader = head[0]?.includes("last") && head.some((c) => c.includes("phone"));
  const rows: DirectoryRow[] = [];
  const issues: DirectoryIssue[] = [];
  all.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const [lastName = "", firstName = "", house = "", street = "", unit = "", tsz = "", phoneRaw = "", area = ""] = r.map((c) => c.trim());
    const place = splitTownStateZip(tsz);
    const phone = directoryPhone(phoneRaw);
    const reason = !lastName ? "no last name" : !house || !street ? "no house number or street" : !place ? "town/state/zip not like \"Monroe, NY 10950\"" : !phone ? "phone is not 7 or 10 digits" : null;
    if (reason) return void issues.push({ line, reason, text: r.join(", ").slice(0, 200) });
    rows.push({ lastName, firstName, house, street, unit: unit || null, town: place!.town, state: place!.state, zip: place!.zip, phone: phone!, areaPrinted: area || null });
  });
  const byPhone = new Map<string, string[]>();
  for (const r of rows) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), `${r.lastName}, ${r.firstName}, ${r.house} ${r.street}`]);
  const sharedPhones = [...byPhone.entries()].filter(([, n]) => n.length > 1).map(([phone, names]) => ({ phone, names }));
  return { rows, issues, sharedPhones };
}

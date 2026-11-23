import { parseCsv } from "@/lib/books";

/**
 * The community directory list (Abraham, Nov 22, 2026): the address-lookup source, kept apart from customer
 * accounts. Columns, in this order, with a header row: last name, first name, house number, street, unit,
 * town/state/zip, phone, area as printed. Every 7-digit phone number is 845.
 */
export const DIRECTORY_COLUMNS = ["last name", "first name", "house number", "street", "unit", "town/state/zip", "phone", "area as printed"] as const;
/** Nov 23, 2026: the same file may start with the two Yiddish name columns (Hebrew letters). */
export const DIRECTORY_COLUMNS_YIDDISH = ["Yiddish last name", "Yiddish first name", ...DIRECTORY_COLUMNS] as const;
const HEBREW = /[\u0590-\u05FF]/;

export type DirectoryRow = { yiddishLastName?: string; yiddishFirstName?: string; lastName: string; firstName: string; house: string; street: string; unit: string | null; town: string; state: string; zip: string; phone: string | null; areaPrinted: string | null };
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
  // The Yiddish layout: a header whose first column says Yiddish, or rows that start with Hebrew letters and have 10 columns
  const body = all.slice(hasHeader || /yiddish|אידיש/i.test(head[0] ?? "") ? 1 : 0);
  const yiddish = /yiddish|אידיש/i.test(head[0] ?? "") || (!hasHeader && body.some((r) => r.length >= 10 && HEBREW.test(`${r[0]}${r[1]}`)));
  body.forEach((raw, i) => {
    const line = i + (body.length < all.length ? 2 : 1);
    const yLast = yiddish ? (raw[0] ?? "").trim() : "";
    const yFirst = yiddish ? (raw[1] ?? "").trim() : "";
    const r = yiddish ? raw.slice(2) : raw;
    const [lastName = "", firstName = "", house = "", street = "", unit = "", tsz = "", phoneRaw = "", area = ""] = r.map((c) => c.trim());
    const place = splitTownStateZip(tsz);
    const phone = directoryPhone(phoneRaw);
    const reason = !lastName ? "no last name" : !house || !street ? "no house number or street" : !place ? "town/state/zip not like \"Monroe, NY 10950\"" : phoneRaw.replace(/\D/g, "") && !phone ? "phone is not 7 or 10 digits" : null; // no phone: kept (it just cannot be found by phone)
    if (reason) return void issues.push({ line, reason, text: r.join(", ").slice(0, 200) });
    rows.push({ yiddishLastName: yLast, yiddishFirstName: yFirst, lastName, firstName, house, street, unit: unit || null, town: place!.town, state: place!.state, zip: place!.zip, phone: phone ?? null, areaPrinted: area || null });
  });
  const byPhone = new Map<string, string[]>();
  for (const r of rows) if (r.phone) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), `${r.lastName}, ${r.firstName}, ${r.house} ${r.street}`]);
  const sharedPhones = [...byPhone.entries()].filter(([, n]) => n.length > 1).map(([phone, names]) => ({ phone, names }));
  return { rows, issues, sharedPhones };
}

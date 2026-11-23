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

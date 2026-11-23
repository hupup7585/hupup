import { currentStaff } from "@/lib/auth";
import { sheetTable, toCsv, toXlsx } from "@/lib/directory-sheet";
import { XLSX_MIME } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** GET /api/admin/directory/export?format=xlsx|csv: the whole Directory list, all columns (Owner only, Nov 23, 2026). */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || staff.role !== "owner") return new Response("Not found", { status: 404 });
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const t = await sheetTable();
  const stamp = new Date().toISOString().slice(0, 10);
  const { db, schema } = await import("@/lib/db");
  await db
    .insert(schema.auditLog)
    .values({ userId: staff.userId, action: "directory.downloaded", entityType: "directory", entityId: "all", after: { format: csv ? "csv" : "xlsx", rows: t.rows.length } })
    .catch(() => null);
  return csv
    ? new Response(toCsv(t), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="directory-list-${stamp}.csv"`, "Cache-Control": "no-store" } })
    : new Response(new Uint8Array(toXlsx(t)), { headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="directory-list-${stamp}.xlsx"`, "Cache-Control": "no-store" } });
}

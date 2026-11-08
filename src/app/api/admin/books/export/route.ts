import { currentStaff } from "@/lib/auth";
import { bookAudit, canUseBooks } from "@/lib/books";
import { BOOK_REPORTS, buildBookReport, entriesBetween, quickbooksCsv, quickbooksIif, type BookReport } from "@/lib/books-reports";
import { XLSX_MIME, buildXlsx, type Cell } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

function csvCell(v: Cell) {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
const iso = (v: string | null, d: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);

/** GET /api/admin/books/export?report=&from=&to=&group=&format=xlsx|csv|qbo|iif (Owner only). */
export async function GET(req: Request) {
  const s = await currentStaff();
  if (!s || !(await canUseBooks(s))) return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  const report = (u.searchParams.get("report") ?? "ledger") as BookReport;
  if (!BOOK_REPORTS.includes(report)) return new Response("Unknown report", { status: 400 });
  const year = new Date().getFullYear();
  const from = iso(u.searchParams.get("from"), `${year}-01-01`);
  const to = iso(u.searchParams.get("to"), new Date().toISOString().slice(0, 10));
  const group = (["month", "quarter", "year"].includes(u.searchParams.get("group") ?? "") ? u.searchParams.get("group") : "month") as "month";
  const format = u.searchParams.get("format") ?? "xlsx";
  const name = `hup-up-${report}-${from}-to-${to}`;
  await bookAudit(s.userId, "export", "report", report, { from, to, format });
  if (format === "qbo") {
    const body = quickbooksCsv(await entriesBetween(from, to)).map((r) => r.map((c) => csvCell(c)).join(",")).join("\n");
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-quickbooks-online.csv"`, "Cache-Control": "no-store" } });
  }
  if (format === "iif") {
    return new Response(quickbooksIif(await entriesBetween(from, to)), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-quickbooks-desktop.iif"`, "Cache-Control": "no-store" } });
  }
  const sheets = await buildBookReport(report, from, to, group);
  if (format === "csv") {
    const body = sheets.map((sh) => [sh.header, ...sh.rows].map((r) => r.map(csvCell).join(",")).join("\n")).join("\n\n");
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
  }
  return new Response(new Uint8Array(buildXlsx(sheets)), { headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
}

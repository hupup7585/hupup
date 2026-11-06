import { currentStaff } from "@/lib/auth";
import { reportFor, type ReportParams } from "@/lib/reports";
import { XLSX_MIME, buildXlsx, type Cell } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** CSV fallback: formula-injection guard and quote escaping. */
function csvCell(v: Cell) {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** GET /api/admin/export/<report>?format=xlsx|csv&q=&status=&from=&to= */
export async function GET(req: Request, ctx: { params: Promise<{ report: string }> }) {
  const staff = await currentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });
  const found = reportFor((await ctx.params).report, staff.role);
  if ("error" in found) return new Response(found.error, { status: found.status });
  const u = new URL(req.url);
  const p: ReportParams = {};
  for (const k of ["q", "status", "from", "to"] as const) {
    const v = u.searchParams.get(k);
    if (v) p[k] = v.slice(0, 100);
  }
  let sheets;
  try {
    sheets = await found.report.build(p);
  } catch (e) {
    console.error(`[export ${found.report.file}] failed:`, e);
    return new Response("This report is temporarily unavailable. Please try again later.", { status: 503 });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (u.searchParams.get("format") === "csv") {
    const s = sheets[0];
    const body = [s.header, ...s.rows].map((r) => r.map(csvCell).join(",")).join("\n");
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${found.report.file}-${stamp}.csv"` } });
  }
  return new Response(new Uint8Array(buildXlsx(sheets)), {
    headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${found.report.file}-${stamp}.xlsx"`, "Cache-Control": "no-store" },
  });
}

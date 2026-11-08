import { currentStaff } from "@/lib/auth";
import { TASK_REPORTS, buildTaskReport, type TaskReport } from "@/lib/tasks-reports";
import { XLSX_MIME, buildXlsx, type Cell } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

function csvCell(v: Cell) {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** GET /api/admin/tasks/export?report=tasks|time|projects&format=csv|xlsx (projects: Owner only). */
export async function GET(req: Request) {
  const s = await currentStaff();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const report = u.searchParams.get("report") as TaskReport;
  if (!TASK_REPORTS.includes(report)) return new Response("Unknown report", { status: 400 });
  if (report === "projects" && s.role !== "owner") return new Response("Not allowed", { status: 403 });
  const sheets = await buildTaskReport(report, s);
  const name = `hup-up-${report}-${new Date().toISOString().slice(0, 10)}`;
  if (u.searchParams.get("format") === "xlsx")
    return new Response(new Uint8Array(buildXlsx(sheets)), { headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
  const body = "﻿" + [sheets[0].header, ...sheets[0].rows].map((r) => r.map(csvCell).join(",")).join("\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
}

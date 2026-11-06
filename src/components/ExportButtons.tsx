import { FileSpreadsheet, Sheet } from "lucide-react";
import { currentStaff } from "@/lib/auth";
import { REPORTS } from "@/lib/reports";

/**
 * The two sheet buttons every exportable admin list gets (Abraham): Export to Excel (.xlsx download) and
 * Open in Google Sheets. Google Sheets needs a Google sign-in setup Abraham hasn't approved yet, so that button
 * is shown but disabled with the reason.
 */
export default async function ExportButtons({ report, params = {} }: { report: string; params?: Record<string, string | undefined> }) {
  // Only shown to roles that may download this report (the route enforces the same rule).
  const staff = await currentStaff();
  if (!staff || !REPORTS[report]?.roles.includes(staff.role)) return null;
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  qs.set("format", "xlsx");
  return (
    <span data-export={report} className="inline-flex flex-wrap items-center gap-2">
      <a className="btn-ghost inline-flex items-center gap-1.5" href={`/api/admin/export/${report}?${qs}`} download>
        <FileSpreadsheet className="h-4 w-4" aria-hidden /> {REPORTS[report].title}: Export to Excel
      </a>
      <button type="button" disabled className="btn-ghost inline-flex cursor-not-allowed items-center gap-1.5 opacity-50" title="Needs a Google sign-in setup first (waiting for Abraham's approval). Meanwhile, download the Excel file and open it in Google Sheets.">
        <Sheet className="h-4 w-4" aria-hidden /> Open in Google Sheets
      </button>
    </span>
  );
}

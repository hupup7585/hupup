import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { TASK_REPORTS, TASK_REPORT_LABEL, buildTaskReport, type TaskReport } from "@/lib/tasks-reports";
import PrintButton from "../../(app)/bookkeeping/print/PrintButton";

export const dynamic = "force-dynamic";

/** Printable task reports: Print -> Save as PDF (free, no service). */
export default async function PrintTasks({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const report = (await searchParams).report as TaskReport;
  if (!TASK_REPORTS.includes(report) || (report === "projects" && staff.role !== "owner")) notFound();
  const [s] = await buildTaskReport(report, staff);
  const fmt = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v));
  return (
    <div className="bg-white p-2" data-print-report>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Hup Up Attractions</h1>
          <p className="text-lg font-bold">{TASK_REPORT_LABEL[report]}</p>
          <p className="text-sm text-muted">Printed {todayISO()}</p>
        </div>
        <PrintButton />
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-xs">
          <thead><tr>{s.header.map((h) => <th key={h} className="border border-line bg-bg px-2 py-1 text-left">{h}</th>)}</tr></thead>
          <tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-line px-2 py-1">{fmt(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {s.rows.length === 0 && <p className="mt-3 text-sm text-muted">Nothing to show.</p>}
    </div>
  );
}

import { requireBooks } from "@/lib/books";
import { BOOK_REPORTS, BOOK_REPORT_LABEL, buildBookReport, type BookReport } from "@/lib/books-reports";
import { todayISO } from "@/lib/dates";
import PrintButton from "./PrintButton";

export const metadata = { title: "Bookkeeping report | Hup Up Attractions" };
export const dynamic = "force-dynamic";

/** Printable report: the browser's Print → Save as PDF makes the PDF (free, no service). */
export default async function PrintReport({ searchParams }: { searchParams: Promise<{ report?: string; from?: string; to?: string; group?: string }> }) {
  await requireBooks();
  const sp = await searchParams;
  const report = (BOOK_REPORTS.includes(sp.report as BookReport) ? sp.report : "pnl") as BookReport;
  const today = todayISO();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const group = (["month", "quarter", "year"].includes(sp.group ?? "") ? sp.group : "month") as "month";
  const sheets = await buildBookReport(report, from, to, group);
  const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) : v === null || v === undefined ? "" : String(v));
  return (
    <div className="mx-auto max-w-5xl bg-white p-6 print:p-0" data-print-report>
      <div className="mb-4 flex items-start justify-between gap-3 print:mb-2">
        <div>
          <h1 className="text-2xl font-black">Hup Up Attractions</h1>
          <p className="text-lg font-bold">{BOOK_REPORT_LABEL[report]}</p>
          <p className="text-sm text-muted">{from} to {to} · printed {today}</p>
        </div>
        <PrintButton />
      </div>
      {sheets.map((s) => (
        <section key={s.name} className="mb-6 break-inside-avoid">
          {sheets.length > 1 && <h2 className="mb-2 font-bold">{s.name}</h2>}
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-xs">
              <thead><tr>{s.header.map((h) => <th key={h} className="border border-line bg-bg px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`border border-line px-2 py-1 ${typeof c === "number" ? "text-right" : ""}`}>{fmt(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {s.rows.length === 0 && <p className="text-sm text-muted">Nothing in this range.</p>}
        </section>
      ))}
    </div>
  );
}

import { requireBooks } from "@/lib/books";
import { statement } from "@/lib/invoices";
import { publicEmail } from "@/lib/config";
import { todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import PrintButton from "../print/PrintButton";

export const dynamic = "force-dynamic";
const m = (c: number) => (c < 0 ? `-${formatMoney(-c)}` : formatMoney(c));

/** Customer statement (Bookkeeping spec 3.1): every invoice, credit and payment with a running balance. */
export default async function StatementPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireBooks();
  const name = ((await searchParams).c ?? "").slice(0, 200);
  const rows = name ? await statement(name) : [];
  const balance = rows.at(-1)?.balanceCents ?? 0;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex gap-2"><a href="/admin/bookkeeping?tab=invoices" className="btn-ghost">← Invoices</a><PrintButton /></div>
      <article className="card bg-white p-8 print:p-0" data-statement>
        <header className="mb-6 flex justify-between gap-4 border-b border-line pb-4">
          <div className="text-sm leading-6"><div className="text-lg font-black">Hup Up Attractions</div><div>(845) 777-7585</div><div>{publicEmail()}</div></div>
          <div className="text-right text-sm leading-6"><div className="text-2xl font-black uppercase">Statement</div><div>{todayISO()}</div><div className="font-bold">{name}</div></div>
        </header>
        <table className="w-full text-sm">
          <thead><tr className="border-b-2 border-navy text-left"><th className="py-2">Date</th><th className="py-2">Reference</th><th className="py-2">Details</th><th className="py-2 text-right">Amount</th><th className="py-2 text-right">Balance</th></tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i} className="border-b border-line"><td className="py-2">{r.date}</td><td className="py-2">{r.ref}</td><td className="py-2">{r.what}</td><td className="py-2 text-right">{m(r.cents)}</td><td className="py-2 text-right">{m(r.balanceCents)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">Nothing on this account.</td></tr>}
          </tbody>
        </table>
        <div className="mt-4 text-right text-base font-black">Balance due: {m(balance)}</div>
      </article>
    </div>
  );
}

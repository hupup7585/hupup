import { publicEmail } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { orderNumber } from "@/lib/order-number";
import { KIND_NAME, type DocKind, type docDetail } from "@/lib/invoices";

const m = (c: number) => (c < 0 ? `-${formatMoney(-c)}` : formatMoney(c));

/** The printed invoice, quote or credit note: the same in Admin and on the customer's own page. */
export default function InvoiceDocument({ d }: { d: NonNullable<Awaited<ReturnType<typeof docDetail>>> }) {
  const { doc } = d;
  const title = KIND_NAME[doc.kind as DocKind] ?? "Invoice";
  return (
    <article className="card bg-white p-8 print:p-0 print:shadow-none" data-invoice>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/hupup-logo-h96@1x.png" srcSet="/brand/hupup-logo-h96@1x.png 1x, /brand/hupup-logo-h96@2x.png 2x" width={91} height={96} alt="Hup Up Attractions" className="h-20 w-auto" />
          <div className="text-sm leading-6">
            <div className="text-lg font-black">Hup Up Attractions</div>
            <div>(845) 777-7585</div>
            <div>{publicEmail()}</div>
          </div>
        </div>
        <div className="text-right text-sm leading-6">
          <div className="text-2xl font-black uppercase tracking-wide">{title}</div>
          <div className="font-bold">{doc.number ?? `#${doc.id}`}</div>
          <div>Date: {doc.issueDate}</div>
          {doc.kind === "invoice" && <div>Due: {doc.dueDate}</div>}
          {doc.orderId && <div data-order-number>Order {orderNumber(doc.orderId)}</div>}
          <div className="mt-1 inline-block rounded-full bg-bg px-3 py-0.5 text-xs font-bold" data-invoice-status>{d.status}</div>
        </div>
      </header>
      <section className="mb-6 text-sm leading-6">
        <div className="text-xs font-bold uppercase tracking-wider text-muted">Bill to</div>
        <div className="font-bold">{doc.customerName}</div>
        {doc.billingAddress && <div>{doc.billingAddress}</div>}
        {doc.customerEmail && <div>{doc.customerEmail}</div>}
        {doc.customerPhone && <div>{doc.customerPhone}</div>}
        {doc.taxExempt && <div className="mt-1 font-semibold">Tax exempt{doc.exemptCertNo ? `, certificate ${doc.exemptCertNo}` : ""}</div>}
      </section>
      <table className="mb-6 w-full text-sm">
        <thead><tr className="border-b-2 border-navy text-left"><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">Amount</th></tr></thead>
        <tbody>
          {d.lines.length ? d.lines.map((l) => (
            <tr key={l.id} className="border-b border-line"><td className="py-2">{l.description}</td><td className="py-2 text-right">{l.qty}</td><td className="py-2 text-right">{m(l.unitCents)}</td><td className="py-2 text-right">{m(l.lineCents)}</td></tr>
          )) : (
            <tr className="border-b border-line"><td className="py-2">{doc.notes || "Rental services"}</td><td className="py-2 text-right">1</td><td className="py-2 text-right">{m(doc.amountCents)}</td><td className="py-2 text-right">{m(doc.amountCents)}</td></tr>
          )}
        </tbody>
      </table>
      <div className="ml-auto max-w-xs space-y-1 text-sm" data-invoice-totals>
        {doc.subtotalCents !== null && <div className="flex justify-between"><span>Subtotal</span><span>{m(doc.subtotalCents)}</span></div>}
        {doc.discountCents > 0 && <div className="flex justify-between"><span>Discount</span><span>-{m(doc.discountCents)}</span></div>}
        {doc.subtotalCents !== null && <div className="flex justify-between"><span>Sales tax</span><span>{m(doc.taxCents)}</span></div>}
        <div className="flex justify-between border-t-2 border-navy pt-1 text-base font-black"><span>Total</span><span>{m(doc.amountCents)}</span></div>
        {doc.kind === "invoice" && (
          <>
            {doc.depositRequiredCents > 0 && <div className="flex justify-between"><span>Deposit required</span><span>{m(doc.depositRequiredCents)}</span></div>}
            <div className="flex justify-between"><span>Paid</span><span>{m(d.paidCents)}</span></div>
            {d.creditCents > 0 && <div className="flex justify-between"><span>Credits</span><span>-{m(d.creditCents)}</span></div>}
            <div className="flex justify-between text-base font-black"><span>Balance due</span><span>{m(d.balanceCents)}</span></div>
          </>
        )}
      </div>
      {doc.notes && d.lines.length > 0 && <p className="mt-6 text-sm">{doc.notes}</p>}
    </article>
  );
}

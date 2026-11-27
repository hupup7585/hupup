import { trustedMsg } from "@/lib/url-message";
import { desc } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { discountNote } from "@/lib/customer-discounts";
import { addDiscountAction, turnOffDiscountAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discounts · Hup Up Attractions", robots: { index: false } };

/**
 * Customer discounts (Abraham, Nov 17-18, 2026): Owner only. By phone number, dollars or percent off the rentals,
 * before tax; stays until turned off, with an optional end date; never combined with an offer (the bigger saving).
 */
export default async function DiscountsPage({ searchParams }: { searchParams: Promise<{ m?: string; ms?: string }> }) {
  await requireOwner();
  const { m: rawM, ms } = await searchParams;
  const m = trustedMsg(rawM, ms);
  const rows = await db.select().from(schema.customerDiscounts).orderBy(desc(schema.customerDiscounts.id)).limit(200);
  const on = rows.filter((r) => r.active);
  const off = rows.filter((r) => !r.active);
  const label = (r: (typeof rows)[number]) => discountNote({ kind: r.kind, amount_cents: r.amountCents, percent: r.percent }).replace("Customer discount: ", "");
  return (
    <div className="w-full" data-discounts>
      <h1 className="text-2xl font-black sm:text-3xl">Discounts</h1>
      <p className="mb-5 mt-1 text-muted">
        A discount for one customer, by phone number. It comes off the rentals before sales tax, on every booking until you turn it off (or until the end date). It is never
        combined with an offer: the one that saves the customer more applies. The phone reads the total with the discount and never mentions it.
      </p>
      {m && <p className="mb-4 rounded-xl bg-bg p-3 text-sm font-semibold" role="status">{m}</p>}
      <form action={addDiscountAction} className="card mb-6 grid gap-3 p-5 sm:grid-cols-2">
        <h2 className="text-xl font-black sm:col-span-2">Add a discount</h2>
        <label className="block"><span className="label">Customer phone</span><input name="phone" type="tel" inputMode="tel" className="input" placeholder="845-415-7585" required /></label>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <label className="block"><span className="label">Type</span>
            <select name="kind" className="input" defaultValue="amount"><option value="amount">Dollars off</option><option value="percent">Percent off</option></select>
          </label>
          <label className="block"><span className="label">Amount</span><input name="value" inputMode="decimal" className="input" placeholder="25 or 10" required /></label>
        </div>
        <label className="block"><span className="label">End date (optional, the last day it counts)</span><input name="endsOn" type="date" className="input" /></label>
        <label className="block"><span className="label">Note (Admin only)</span><input name="note" maxLength={200} className="input" placeholder="e.g. school, regular customer" /></label>
        <div className="sm:col-span-2"><button className="btn-dark">Save discount</button></div>
      </form>
      <section className="card p-5">
        <h2 className="mb-3 text-xl font-black">On now</h2>
        {on.length === 0 && <p className="text-sm text-muted">No discounts on.</p>}
        {on.map((r) => (
          <form key={r.id} action={turnOffDiscountAction} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg p-3">
            <input type="hidden" name="id" value={r.id} />
            <span>
              <b>{formatPhone(r.phone)}</b>: {label(r)}
              <span className="block text-sm text-muted">{r.endsOn ? `Until ${r.endsOn}` : "No end date"}{r.note ? ` · ${r.note}` : ""}</span>
            </span>
            <button className="btn-ghost">Turn off</button>
          </form>
        ))}
        {off.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-muted">Turned off ({off.length})</summary>
            {off.map((r) => (
              <p key={r.id} className="mt-1 text-sm text-muted">{formatPhone(r.phone)}: {label(r)}{r.note ? ` · ${r.note}` : ""}</p>
            ))}
          </details>
        )}
      </section>
    </div>
  );
}

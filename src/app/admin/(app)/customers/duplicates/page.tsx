import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { trustedMsg } from "@/lib/url-message";
import { formatPhone } from "@/lib/phone";
import { findDuplicateCustomers } from "@/lib/duplicate-customers";
import { mergeGroupAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Possible duplicate customers (Abraham, Nov 27, 2026, 2:14 AM). Owner only. A list to look at: nothing is merged
 * until the Owner presses Merge on a group (and ticks the confirm box).
 */
export default async function DuplicateCustomersPage({ searchParams }: { searchParams: Promise<{ m?: string; ms?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const msg = trustedMsg(sp.m, sp.ms);
  const groups = await findDuplicateCustomers();
  return (
    <div className="w-full">
      <Link href="/admin/customers" className="text-sm font-bold text-navy underline-offset-2 hover:underline">← Customers</Link>
      <h1 className="mt-2 text-2xl font-black sm:text-3xl">Possible duplicate customers</h1>
      <p className="mb-5 mt-1 text-muted">
        Customer records that look like the same person: the same phone number, or the same name and address. Nothing changes until you press Merge on a group. Merging moves the orders (with their payments), texts and notes to the record you keep, and never deletes an order or a payment. If any record replied STOP, the kept record is stopped too.
      </p>
      {msg && <p className="mb-4 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]">{msg}</p>}
      <p className="mb-4 font-semibold" data-dup-count>{groups.length === 0 ? "No possible duplicates found." : `${groups.length} possible duplicate group${groups.length === 1 ? "" : "s"} found.`}</p>
      {groups.map((g) => (
        <section key={g.key} className="card mb-5 p-4" data-dup-group>
          <div className="mb-2 text-sm text-muted">Why: {g.why.join(", ")}</div>
          <form action={mergeGroupAction}>
            <input type="hidden" name="ids" value={g.key} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-1 pr-2">Keep</th><th className="py-1 pr-2">Name</th><th className="py-1 pr-2">Phone</th><th className="py-1 pr-2">Email</th><th className="py-1 pr-2">Address</th><th className="py-1 pr-2">Orders</th><th className="py-1 pr-2">First and last order</th><th className="py-1">Texts</th>
                  </tr>
                </thead>
                <tbody>
                  {g.records.map((r) => (
                    <tr key={r.id} className="border-b border-line align-top">
                      <td className="py-1 pr-2"><input type="radio" name="keepId" value={r.id} defaultChecked={r.id === g.keepId} aria-label={`Keep record ${r.id}`} />{r.id === g.keepId && <span className="ml-1 text-xs font-bold text-[#13895C]">suggested</span>}</td>
                      <td className="py-1 pr-2"><Link className="font-semibold text-navy underline-offset-2 hover:underline" href={`/admin/customers/${r.id}`}>{r.name || "No name"}</Link></td>
                      <td className="py-1 pr-2">{r.phone ? formatPhone(r.phone) : "—"}</td>
                      <td className="py-1 pr-2">{r.email || "—"}</td>
                      <td className="py-1 pr-2">{r.address || "—"}</td>
                      <td className="py-1 pr-2">{r.orders}</td>
                      <td className="py-1 pr-2">{r.firstOrder ? `${r.firstOrder} to ${r.lastOrder}` : "—"}</td>
                      <td className="py-1">{r.smsOptOut ? <b className="text-[#b3261e]">Replied STOP</b> : r.marketingOptIn ? "Offers: yes" : "Offers: no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" /> I checked these are the same customer</label>
              <button className="btn-dark">Merge</button>
            </div>
          </form>
        </section>
      ))}
    </div>
  );
}

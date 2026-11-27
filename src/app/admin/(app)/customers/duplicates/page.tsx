import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { findDuplicateCustomers } from "@/lib/duplicate-customers";
import { formatPhone } from "@/lib/phone";
import MergeGroup from "./MergeGroup";

export const dynamic = "force-dynamic";

/**
 * Possible duplicate customers (Hark for Abraham, Nov 27, 2026, item 2). Owner only. A list: nothing is merged unless
 * the Owner presses a group's Merge button.
 */
export default async function DuplicateCustomersPage() {
  await requireOwner();
  const groups = await findDuplicateCustomers();
  const records = groups.reduce((s, g) => s + g.records.length, 0);
  return (
    <div className="w-full space-y-5">
      <div>
        <Link href="/admin/customers" className="text-sm font-bold text-navy">
          &larr; Customers
        </Link>
        <h1 className="text-2xl font-black sm:text-3xl">Possible duplicate customers</h1>
        <p className="mt-1 text-sm text-muted">
          Customer records that look like the same person: the same phone number, or the same name and address (phone, website and staff bookings). This is a list only:
          nothing is merged unless you press Merge on a group. Merging moves every order, payment, text, consent record and note to the record you keep, and never deletes an
          order, a payment or a record. A STOP on any record wins.
        </p>
        <p className="mt-2 text-sm font-semibold" data-dup-count>
          {groups.length} group{groups.length === 1 ? "" : "s"} found ({records} records).
        </p>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="card p-4" data-dup-group={g.key}>
          <div className="mb-2 text-sm font-bold">{g.reasons.join("; ")}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1.5">Record</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Orders</th><th>First order</th><th>Last order</th><th>Booked by</th><th>Texts</th>
                </tr>
              </thead>
              <tbody>
                {g.records.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-2 font-semibold">
                      <Link className="hover:underline" href={`/admin/customers/${r.id}`}>Number {r.id}</Link>
                      {r.id === g.suggestedKeepId && <span className="ml-1 rounded-full bg-bg px-2 py-0.5 text-xs font-bold text-navy ring-1 ring-line" data-suggested-keep>Keep</span>}
                      {r.isTest && <span className="ml-1 rounded-full bg-bg px-2 py-0.5 text-xs font-bold text-muted ring-1 ring-line">Test entry</span>}
                    </td>
                    <td>{r.name || "Unknown caller"}</td>
                    <td>{formatPhone(r.phone)}</td>
                    <td className="max-w-[200px] break-words">{r.email}</td>
                    <td className="max-w-[240px]">{r.address || r.orderAddresses[0] || ""}{!r.address && r.orderAddresses.length > 1 ? ` (+${r.orderAddresses.length - 1} more)` : ""}</td>
                    <td>{r.orders}{r.cancelled ? ` (${r.cancelled} cancelled)` : ""}</td>
                    <td>{r.firstOrder ?? ""}</td>
                    <td>{r.lastOrder ?? ""}</td>
                    <td>{r.channels.join(", ")}</td>
                    <td>{r.smsOptOut ? <span className="font-semibold text-[#C83A2F]">Replied STOP</span> : r.marketingOptIn ? "Promos: yes" : "Order texts only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MergeGroup groupKey={g.key} ids={g.records.map((r) => r.id)} suggestedKeepId={g.suggestedKeepId} anyStop={g.anyStop} />
        </div>
      ))}
      {!groups.length && <div className="card p-6 text-center text-muted">No possible duplicates found.</div>}
    </div>
  );
}

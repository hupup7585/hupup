import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

type Row = { id: number; name: string | null; phone: string; email: string | null; bookings: number; last_event: string | null; marketing_opt_in: boolean; sms_opt_out: boolean ; is_test: boolean };

/** Customer records (Owner and Secretary). No customer login exists anywhere. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStaff(["owner", "secretary"]);
  const { q } = await searchParams;
  const like = q?.trim() ? `%${q.trim()}%` : null;
  const digits = q?.replace(/\D/g, "") || "";
  const rows = (
    await db.execute(sql`
      SELECT c.id, c.name, c.phone, c.email, c.marketing_opt_in, c.sms_opt_out, c.is_test,
             (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED') AS bookings,
             (SELECT MAX(o.event_date)::text FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED') AS last_event
      FROM customers c
      ${like ? sql`WHERE c.name ILIKE ${like} OR c.email ILIKE ${like} OR c.address ILIKE ${like} ${digits.length >= 3 ? sql`OR c.phone LIKE ${`%${digits}%`}` : sql``}` : sql``}
      ORDER BY c.created_at DESC LIMIT 300`)
  ).rows as Row[];
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-5 text-2xl font-black sm:text-3xl">Customers</h1>
      <form className="card mb-5 flex gap-2 p-4">
        <input name="q" defaultValue={q} placeholder="Name, phone, email or address" className="input" />
        <button className="btn-dark">Search</button>
      </form>
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2">Name</th><th>Phone</th><th>Email</th><th>Bookings</th><th>Last event</th><th>Texts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="py-2.5 font-semibold"><Link className="hover:underline" href={`/admin/customers/${c.id}`}>{c.name || "Unknown caller"}</Link>{c.is_test && <span data-test-entry className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-bold text-muted ring-1 ring-line">Test entry</span>}</td>
                <td>{formatPhone(c.phone)}</td>
                <td className="max-w-[220px] truncate">{c.email}</td>
                <td>{c.bookings}</td>
                <td>{c.last_event ?? ""}</td>
                <td>{c.sms_opt_out ? <span className="font-semibold text-[#C83A2F]">Replied STOP</span> : c.marketing_opt_in ? "Promos: yes" : ""}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="py-6 text-center text-muted">No customers found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

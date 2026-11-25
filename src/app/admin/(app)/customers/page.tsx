import { phoneQueryDigits } from "@/lib/phone-search";
import { phoneMatchSql, phoneRankSql } from "@/lib/phone-search-sql";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

type Row = { id: number; name: string | null; phone: string; email: string | null; bookings: number; last_event: string | null; marketing_opt_in: boolean; sms_opt_out: boolean ; is_test: boolean; matched_phone: string | null };

/** Customer records (Owner and Secretary). No customer login exists anywhere. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireStaff(["owner", "secretary"]);
  const owner = me.role === "owner";
  const { q } = await searchParams;
  const like = q?.trim() ? `%${q.trim()}%` : null;
  // A phone number however it is typed (Nov 24, 2026). Nov 25, 2026: matched at the start of the number, the start of
  // the 7-digit local part, or the last 4 (never the middle), on the customer's phone and any number on their orders;
  // best match first (exact, starts with, last 4), then newest.
  const pd = phoneQueryDigits(q);
  const digits = pd && pd.length >= 3 ? pd : "";
  const textOnly = like && !digits ? sql`c.name ILIKE ${like} OR c.email ILIKE ${like} OR c.address ILIKE ${like}` : null;
  const orderPhone = sql`(SELECT o.text_phone FROM orders o WHERE o.customer_id = c.id AND o.text_phone IS NOT NULL AND ${phoneMatchSql(sql`o.text_phone`, digits || "x")} ORDER BY o.id DESC LIMIT 1)`;
  const rows = (
    await db.execute(sql`
      SELECT x.id, x.name, x.phone, x.email, x.marketing_opt_in, x.sms_opt_out, x.is_test, x.bookings, x.last_event, x.matched_phone FROM (
        SELECT c.id, c.name, c.phone, c.email, c.marketing_opt_in, c.sms_opt_out, c.is_test, c.created_at,
               (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED') AS bookings,
               (SELECT MAX(o.event_date)::text FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED') AS last_event,
               ${digits ? sql`CASE WHEN ${phoneMatchSql(sql`c.phone`, digits)} THEN c.phone ELSE ${orderPhone} END` : sql`NULL`} AS matched_phone
        FROM customers c
        ${digits ? sql`WHERE ${phoneMatchSql(sql`c.phone`, digits)} OR ${orderPhone} IS NOT NULL OR c.name ILIKE ${like} OR c.email ILIKE ${like} OR c.address ILIKE ${like}` : textOnly ? sql`WHERE ${textOnly}` : sql``}
      ) x
      ORDER BY ${digits ? sql`${phoneRankSql(sql`x.matched_phone`, digits)}, ` : sql``}x.created_at DESC LIMIT 300`)
  ).rows as Row[];
  // The same number in the directory list (Owner): shown with the household, so it is clear what matched
  const dirRows = digits && owner
    ? ((await db.execute(sql`SELECT id, last_name, first_name, house, street, unit, phone FROM directory_entries WHERE ${phoneMatchSql(sql`phone`, digits)} ORDER BY ${phoneRankSql(sql`phone`, digits)}, last_name LIMIT 10`)).rows as { id: number; last_name: string; first_name: string; house: string; street: string; unit: string | null; phone: string }[])
    : [];
  return (
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-black sm:text-3xl">Customers</h1>
        {owner && (
          <Link href="/admin/customers/directory" className="text-sm font-bold text-navy" data-directory-link>
            Directory list
          </Link>
        )}
      </div>
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
                <td>
                  {formatPhone(c.phone)}
                  {c.matched_phone && c.matched_phone !== c.phone && <div data-matched-phone className="text-xs text-muted">Matched order text number {formatPhone(c.matched_phone)}</div>}
                </td>
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
      {dirRows.length > 0 && (
        <div className="card mt-5 p-4" data-directory-matches>
          <h2 className="mb-2 font-bold">Also in the directory list</h2>
          <ul className="space-y-1 text-sm">
            {dirRows.map((d) => (
              <li key={d.id}>
                {[d.last_name, d.first_name].filter(Boolean).join(", ")} · {d.house} {d.street}{d.unit ? `, unit ${d.unit}` : ""} · <span className="text-muted">matched {formatPhone(d.phone)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

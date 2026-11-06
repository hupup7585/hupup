import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
type Row = { id: number; created_at: string; action: string; entity_type: string | null; entity_id: string | null; user_name: string | null; role: string | null; ip: string | null; before: unknown; after: unknown };

/** Owner: every audited action (sign-ins, bookings, consent, settings, staff, voicemail...), newest first. */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ who?: string; what?: string; from?: string; to?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const conds = [sql`TRUE`];
  if (sp.who) conds.push(sql`u.name ILIKE ${`%${sp.who}%`}`);
  if (sp.what) conds.push(sql`(a.action ILIKE ${`%${sp.what}%`} OR a.entity_type ILIKE ${`%${sp.what}%`})`);
  if (sp.from) conds.push(sql`a.created_at >= ${sp.from}::date`);
  if (sp.to) conds.push(sql`a.created_at < (${sp.to}::date + 1)`);
  const rows = (
    await db.execute(sql`
      SELECT a.id, a.created_at::text, a.action, a.entity_type, a.entity_id, a.ip, a.before, a.after, u.name AS user_name, u.role
      FROM audit_log a LEFT JOIN admin_users u ON u.id = a.user_id
      WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY a.created_at DESC LIMIT 300`)
  ).rows as Row[];
  const show = (v: unknown) => {
    if (!v || (typeof v === "object" && !Object.keys(v as object).length)) return "";
    const s = JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 157) + "..." : s;
  };
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Activity</h1>
      <p className="mb-5 text-muted">Who did what and when: sign-ins, bookings, consent, settings, staff and voicemail changes.</p>
      <form className="card mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
        <input name="who" defaultValue={sp.who} placeholder="Staff name" className="input" />
        <input name="what" defaultValue={sp.what} placeholder="Action (login, voicemail, settings...)" className="input" />
        <input name="from" type="date" defaultValue={sp.from} className="input" />
        <input name="to" type="date" defaultValue={sp.to} className="input" />
        <button className="btn-dark">Filter</button>
      </form>
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-muted"><th className="py-2">When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap py-2">{new Date(r.created_at).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td>{r.user_name ?? (r.action.startsWith("login") ? "Sign-in" : "System / Owner")}{r.role ? <span className="text-muted"> · {r.role}</span> : null}</td>
                <td className="font-semibold">{r.action.replace(/[._]/g, " ")}</td>
                <td>{r.entity_type ? `${r.entity_type.replace(/_/g, " ")}${r.entity_id ? ` ${r.entity_id}` : ""}` : ""}</td>
                <td className="max-w-[360px] break-words font-mono text-xs text-muted">{show(r.after) || show(r.before)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-muted">Nothing found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

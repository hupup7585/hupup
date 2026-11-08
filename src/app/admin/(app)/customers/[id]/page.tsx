import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { orderNumber } from "@/lib/orders";
import { CUSTOMER_COLS } from "@/lib/messages";
import { StatusBadge } from "@/components/StatusBadge";
import { saveCustomerAction } from "../actions";
import DualDate from "@/components/DualDate";
import { dualDateTime, localISO } from "@/lib/dual-date";

export const dynamic = "force-dynamic";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const when = (d: Date | string) => dualDateTime(d);

type Event = { at: Date; kind: string; text: string; href?: string };

/** One customer: details (editable), bookings, and a timeline of texts, calls and voicemails. */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["owner", "secretary"]);
  const id = Number((await params).id);
  const [c] = Number.isInteger(id) ? await db.select(CUSTOMER_COLS).from(schema.customers).where(eq(schema.customers.id, id)).limit(1) : [];
  if (!c) notFound();
  const phone = c.phone ?? "";
  const orders = await db
    .select({ id: schema.orders.id, status: schema.orders.status, eventDate: schema.orders.eventDate, subtotalCents: schema.orders.subtotalCents, paidCents: schema.orders.paidCents, channel: schema.orders.channel })
    .from(schema.orders)
    .where(eq(schema.orders.customerId, id))
    .orderBy(desc(schema.orders.eventDate));
  const msgs = await db
    .select({ at: schema.messages.createdAt, direction: schema.messages.direction, body: schema.messages.body, status: schema.messages.status })
    .from(schema.messages)
    .where(eq(schema.messages.contactPhone, phone))
    .orderBy(desc(schema.messages.createdAt))
    .limit(100);
  const calls = (await db.execute(sql`SELECT started_at, outcome FROM call_sessions WHERE from_number = ${phone} ORDER BY started_at DESC LIMIT 100`)).rows as { started_at: string; outcome: string }[];
  // Voicemail arrives with migration 0012; skip quietly until it exists.
  const vms = await db
    .select({ id: schema.voicemails.id, at: schema.voicemails.createdAt, durationSec: schema.voicemails.durationSec, transcription: schema.voicemails.transcription })
    .from(schema.voicemails)
    .where(eq(schema.voicemails.fromNumber, phone))
    .limit(50)
    .catch(() => []);
  const timeline: Event[] = [
    ...msgs.map((m) => ({ at: m.at, kind: m.direction === "in" ? "Text from customer" : "Text sent", text: m.body + (m.direction === "out" ? ` (${m.status})` : "") })),
    ...calls.map((k) => ({ at: new Date(k.started_at), kind: "Call", text: k.outcome.replace(/_/g, " ") })),
    ...vms.map((v) => ({ at: v.at, kind: "Voicemail", text: v.transcription || `${v.durationSec}s message`, href: "/admin/voicemail" })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const showMoney = staff.role === "owner";

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/customers" className="text-sm font-semibold text-navy hover:underline">← Customers</Link>
      <div className="mb-5 mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black sm:text-3xl">{c.name || "Unknown caller"}</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          {phone && <a className="btn-ghost" href={`tel:${phone}`}>Call {formatPhone(phone)}</a>}
          {phone && <Link className="btn-ghost" href={`/admin/messages?p=${encodeURIComponent(phone)}`}>Texts</Link>}
          <Link className="btn" href="/admin/pos">+ New booking</Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <form action={saveCustomerAction} className="card grid gap-3 p-5">
          <input type="hidden" name="id" value={c.id} />
          <label className="block"><span className="label">Name</span><input name="name" defaultValue={c.name ?? ""} className="input" /></label>
          <label className="block"><span className="label">Email</span><input name="email" type="email" defaultValue={c.email ?? ""} className="input" /></label>
          <label className="block"><span className="label">Address</span><input name="address" defaultValue={c.address ?? ""} className="input" /></label>
          <label className="block"><span className="label">Notes</span><textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className="input" /></label>
          <p className="text-sm text-muted">
            Texts: {c.smsOptOut ? <b className="text-[#C83A2F]">replied STOP (no texts)</b> : c.marketingOptIn ? "agreed to promotional texts" : "no promotional consent"}. Customer since <DualDate yi iso={localISO(new Date(c.createdAt))} />.
          </p>
          <button className="btn-dark w-fit">Save</button>
        </form>

        <div className="card p-5">
          <h2 className="mb-3 text-lg font-black">Bookings ({orders.length})</h2>
          {!orders.length && <p className="text-muted">No bookings yet.</p>}
          <ul className="divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/admin/orders/${o.id}`} className="flex items-center gap-2 font-semibold hover:underline">
                  {orderNumber(o.id)} <StatusBadge status={o.status} />
                </Link>
                <span className="text-sm text-muted">
                  {o.eventDate} · {o.channel}
                  {showMoney && ` · ${formatMoney(o.subtotalCents)} (paid ${formatMoney(o.paidCents)})`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card mt-4 p-5">
        <h2 className="mb-3 text-lg font-black">Timeline</h2>
        {!timeline.length && <p className="text-muted">No texts, calls or voicemails yet.</p>}
        <ol className="space-y-2">
          {timeline.map((e, i) => (
            <li key={i} className="flex gap-3 text-[15px]">
              <span className="w-56 shrink-0 text-sm text-muted"><DualDate yi at={e.at} stack /></span>
              <span className="w-36 shrink-0 font-semibold">{e.kind}</span>
              <span className="min-w-0 break-words">{e.href ? <Link className="hover:underline" href={e.href}>{e.text}</Link> : e.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

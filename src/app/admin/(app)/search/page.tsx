import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { searchEverything, searchHits } from "@/lib/search";
import { orderNumber } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { inboxWhen } from "@/lib/inbox-format";
import { StatusBadge } from "@/components/StatusBadge";
import DualDate from "@/components/DualDate";
import SearchBar from "@/components/SearchBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search · Hup Up Attractions", robots: { index: false } };

function Section({ title, n, children }: { title: string; n: number; children: React.ReactNode }) {
  if (!n) return null;
  return (
    <section className="card mb-4 overflow-hidden" data-search-section={title}>
      <h2 className="border-b border-line bg-bg px-4 py-2 text-sm font-bold">{title} <span className="font-normal text-muted">({n})</span></h2>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}
const row = "flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm hover:bg-[#EAF3FC] sm:flex-nowrap";

/** Search everything (Abraham, Nov 15, 2026): orders, customers, emails (Owner), voicemails and calls. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requireAdmin();
  const { q = "" } = await searchParams;
  const r = await searchEverything(q, { owner: staff.role === "owner" });
  return (
    <div className="mx-auto max-w-5xl">
      <SearchBar q={q} />
      {q.trim().length < 2 ? (
        <p className="text-muted">Type at least 2 letters: a name, phone number, email, address or order number.</p>
      ) : searchHits(r) === 0 ? (
        <p className="text-muted" data-search-empty>Nothing found for &ldquo;{q}&rdquo;.</p>
      ) : (
        <>
          <Section title="Orders" n={r.orders.length}>
            {r.orders.map(({ order: o, name, phone }) => (
              <li key={o.id}><Link href={`/admin/orders/${o.id}`} className={row}>
                <span className="w-32 shrink-0 font-bold">Order number {orderNumber(o.id)}</span>
                <span className="min-w-0 flex-1 truncate">{name ?? "No name"}{phone ? ` · ${formatPhone(phone)}` : ""}{o.deliveryAddress ? ` · ${o.deliveryAddress}` : ""}</span>
                <span className="shrink-0 text-muted"><DualDate iso={o.eventDate} style="short" /></span>
                <StatusBadge status={o.status} />
              </Link></li>
            ))}
          </Section>
          <Section title="Customers" n={r.customers.length}>
            {r.customers.map((c) => (
              <li key={c.id}><Link href={`/admin/customers/${c.id}`} className={row}>
                <span className="w-48 shrink-0 truncate font-bold">{c.name ?? "Unknown caller"}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{[c.phone ? formatPhone(c.phone) : null, c.email, c.address].filter(Boolean).join(" · ")}</span>
              </Link></li>
            ))}
          </Section>
          <Section title="Emails" n={r.emails.length}>
            {r.emails.map((e) => (
              <li key={e.id}><Link href={`/admin/inbox/${e.id}`} className={row}>
                <span className={`w-48 shrink-0 truncate ${e.readAt ? "" : "font-bold"}`}>{e.fromName || e.fromAddress}</span>
                <span className="min-w-0 flex-1 truncate">{e.subject || "(no subject)"}</span>
                <span className="shrink-0 text-xs text-muted">{inboxWhen(e.receivedAt)}</span>
              </Link></li>
            ))}
          </Section>
          <Section title="Voicemails" n={r.voicemails.length}>
            {r.voicemails.map((v) => (
              <li key={v.id}><Link href="/admin/voicemail" className={row}>
                <span className="w-48 shrink-0 font-bold">{v.fromNumber ? formatPhone(v.fromNumber) : "Withheld number"}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{v.transcription ?? `${v.durationSec} seconds`}</span>
                <span className="shrink-0 text-xs text-muted">{inboxWhen(v.createdAt)}</span>
              </Link></li>
            ))}
          </Section>
          <Section title="Calls" n={r.calls.length}>
            {r.calls.map((c) => (
              <li key={c.callSid}><Link href="/admin/calls" className={row}>
                <span className="w-48 shrink-0 font-bold">{c.fromNumber ? formatPhone(c.fromNumber) : "Withheld number"}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{c.outcome.replace(/_/g, " ")}</span>
                <span className="shrink-0 text-xs text-muted">{inboxWhen(c.startedAt)}</span>
              </Link></li>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

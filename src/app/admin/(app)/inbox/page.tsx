import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { inboxUnreadCount, listInbox } from "@/lib/inbox";
import { inboxWhen } from "@/lib/inbox-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · Hup Up Attractions" };

/** info@hupupattractions.com (Abraham, Nov 12, 2026). Owner only. Nothing is ever deleted. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireOwner();
  const { q } = await searchParams;
  const [list, unread] = await Promise.all([listInbox(q), inboxUnreadCount()]);
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-black sm:text-3xl">Inbox</h1>
      <p className="mb-4 mt-1 text-muted">
        Email to info@hupupattractions.com. {unread} unread. Every email and reply is kept.
      </p>
      <form className="card mb-4 flex flex-wrap gap-2 p-4" action="/admin/inbox">
        <input name="q" defaultValue={q ?? ""} className="input min-w-0 flex-1" placeholder="Search sender, subject or text" aria-label="Search the inbox" />
        <button className="btn-dark">Search</button>
        {q && (
          <Link href="/admin/inbox" className="btn-ghost">
            Clear
          </Link>
        )}
      </form>
      <div className="card divide-y divide-line" data-inbox-list>
        {list.map((e) => (
          <Link key={e.id} href={`/admin/inbox/${e.id}`} className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 hover:bg-bg ${e.readAt ? "" : "font-bold"}`}>
            <span className="flex w-56 min-w-0 items-center gap-2 truncate">
              {!e.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-coral" aria-label="Unread" />}
              <span className="truncate">{e.fromName || e.fromAddress}</span>
            </span>
            <span className="min-w-0 flex-1 truncate">{e.subject || "(no subject)"}</span>
            <span className="text-sm font-normal text-muted">{inboxWhen(e.receivedAt)}</span>
          </Link>
        ))}
        {list.length === 0 && <p className="px-4 py-10 text-center text-muted">{q ? "No emails match." : "No emails yet."}</p>}
      </div>
    </div>
  );
}

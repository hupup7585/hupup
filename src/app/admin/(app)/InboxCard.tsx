import Link from "next/link";
import { inboxUnreadCount, listInbox } from "@/lib/inbox";
import { inboxWhen } from "@/lib/inbox-format";

/** Dashboard: unread info@ emails and the newest 3 (Abraham, Nov 12, 2026). */
export default async function InboxCard() {
  let unread = 0;
  let newest: Awaited<ReturnType<typeof listInbox>> = [];
  try {
    [unread, newest] = await Promise.all([inboxUnreadCount(), listInbox(undefined, 3)]);
  } catch {
    // the Inbox tables arrive with this release; the card simply shows nothing until then
  }
  return (
    <div className="card mb-5 p-5" data-inbox-card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href="/admin/inbox" className="text-lg font-bold hover:underline">
          Inbox
        </Link>
        <span className={`text-sm font-bold ${unread ? "text-coral-dark" : "text-muted"}`}>{unread} unread</span>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {newest.map((e) => (
          <li key={e.id}>
            <Link href={`/admin/inbox/${e.id}`} className={`flex flex-wrap gap-x-3 py-2 text-sm hover:underline ${e.readAt ? "" : "font-bold"}`}>
              <span className="w-48 truncate">{e.fromName || e.fromAddress}</span>
              <span className="min-w-0 flex-1 truncate">{e.subject || "(no subject)"}</span>
              <span className="font-normal text-muted">{inboxWhen(e.receivedAt)}</span>
            </Link>
          </li>
        ))}
        {newest.length === 0 && <li className="py-2 text-sm text-muted">No emails yet.</li>}
      </ul>
      <Link href="/admin/inbox" className="mt-2 inline-block text-sm font-bold text-navy underline">
        Open the Inbox
      </Link>
    </div>
  );
}

import Link from "next/link";
import { Pencil, Star } from "lucide-react";
import { inboxUnreadCount } from "@/lib/inbox";
import { listEmails } from "@/lib/inbox-folders";
import { inboxWhen } from "@/lib/inbox-format";

/** Dashboard: unread info@ emails and the newest 3 (Abraham, Nov 12, 2026). */
export default async function InboxCard() {
  let unread = 0;
  let newest: Awaited<ReturnType<typeof listEmails>>["rows"] = [];
  try {
    const [u, list] = await Promise.all([inboxUnreadCount(), listEmails({ folder: "inbox" })]);
    unread = u;
    newest = list.rows.slice(0, 5);
  } catch {
    // the Inbox tables arrive with this release; the card simply shows nothing until then
  }
  return (
    <div className="card mb-5 overflow-hidden" data-inbox-card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <Link href="/admin/inbox" className="text-lg font-bold hover:underline">
          Inbox
        </Link>
        <span className="flex items-center gap-3">
          <span className={`text-sm font-bold ${unread ? "text-coral-dark" : "text-muted"}`}>{unread} unread</span>
          <Link href="/admin/inbox/new" className="inline-flex items-center gap-1 rounded-full bg-sky px-3 py-1 text-sm font-bold text-white"><Pencil className="h-3.5 w-3.5" aria-hidden /> Compose</Link>
        </span>
      </div>
      <ul className="mt-2 divide-y divide-line border-t border-line">
        {newest.map((e) => (
          <li key={e.id}>
            <Link href={`/admin/inbox/${e.id}`} className={`flex flex-wrap items-center gap-x-3 px-5 py-2 text-sm hover:bg-[#EAF3FC] sm:flex-nowrap ${e.readAt ? "bg-bg/60" : "bg-white font-bold"}`}>
              <Star className={`h-4 w-4 shrink-0 ${e.starred ? "fill-[#FFD229] text-[#E5B800]" : "text-muted"}`} aria-label={e.starred ? "Starred" : undefined} />
              <span className="w-44 truncate">{e.fromName || e.fromAddress}</span>
              <span className="min-w-0 flex-1 truncate">{e.subject || "(no subject)"}<span className="font-normal text-muted"> - {(e.textBody ?? "").replace(/\s+/g, " ").slice(0, 90)}</span></span>
              <span className="font-normal text-muted">{inboxWhen(e.receivedAt)}</span>
            </Link>
          </li>
        ))}
        {newest.length === 0 && <li className="px-5 py-2 text-sm text-muted">No emails yet.</li>}
      </ul>
      <Link href="/admin/inbox" className="inline-block px-5 py-3 text-sm font-bold text-navy underline">
        Open the Inbox
      </Link>
    </div>
  );
}

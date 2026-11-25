import Link from "next/link";
import NotActive from "@/components/NotActive";
import { requireStaff } from "@/lib/auth";
import { formatPhone, toE164 } from "@/lib/phone";
import { listThreads, markThreadRead, threadCounts, threadMessages, type ThreadView } from "@/lib/messages";
import ReplyForm from "./ReplyForm";
import MessageFiles from "@/components/staff/MessageFiles";
import { filesForMessages } from "@/lib/message-files";
import { dualDateTime } from "@/lib/dual-date";

export const dynamic = "force-dynamic";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const when = (d: Date | string) => dualDateTime(d);

/** Text conversations with customers (Owner and Secretary). Owner can reply free-form. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ p?: string; q?: string; v?: string }> }) {
  const staff = await requireStaff(["owner", "secretary"]);
  const sp = await searchParams;
  // Abraham, Nov 19, 2026: real conversations by default; numbers that only texted CATALOG on their own tab; All too
  const view: ThreadView = sp.v === "catalog" || sp.v === "all" ? sp.v : "conversations";
  const [threads, counts] = await Promise.all([listThreads(sp.q, 200, view), threadCounts()]);
  const phone = sp.p ? toE164(sp.p) : null;
  const msgs = phone ? await threadMessages(phone) : [];
  if (phone) await markThreadRead(phone);
  const files = await filesForMessages(msgs.map((m) => m.id));
  const current = threads.find((t) => t.contact_phone === phone);
  return (
    <div className="w-full">
      {/* Abraham, Nov 24, 2026: the search bar at the top right of the page (any number, name or word) */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-black sm:text-3xl">Messages</h1>
          <p className="text-muted">Texts to and from customers on the hotline number.</p>
        </div>
        <form className="flex w-full gap-2 sm:w-96" role="search" data-search>
          {view !== "conversations" && <input type="hidden" name="v" value={view} />}
          <input name="q" defaultValue={sp.q} placeholder="Search any number, name or word" aria-label="Search texts" className="input" />
          <button className="btn-ghost">Search</button>
        </form>
      </div>
      <NotActive k="sms" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className={`card p-3 ${phone ? "hidden lg:block" : ""}`}>
          {/* Abraham, Nov 24, 2026: the side is the conversation list; catalog requests are one extra line at its top */}
          <div className="mb-2 px-1">
            <h2 className="text-base font-black text-navy" data-list-title>
              {view === "catalog" ? `Catalog requests (${counts.totalCatalog})` : view === "all" ? "All texts" : `All conversations (${counts.totalConversations})`}
            </h2>
            {sp.q && (
              <p className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                <span>Results for &ldquo;{sp.q}&rdquo;</span>
                <Link href={`/admin/messages${view === "conversations" ? "" : `?v=${view}`}`} className="font-semibold text-navy underline" data-clear-search>Clear search</Link>
              </p>
            )}
          </div>
          {view === "conversations" ? (
            <Link href="/admin/messages?v=catalog" className="mb-2 flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2.5 text-sm font-bold text-navy hover:border-navy" data-catalog-entry>
              <span>Catalog requests</span>
              <span className="flex items-center gap-2">
                {counts.catalog > 0 && <span className="rounded-full bg-sun px-2 text-xs font-black">{counts.catalog}</span>}
                <span aria-hidden>›</span>
              </span>
            </Link>
          ) : (
            <Link href="/admin/messages" className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm font-bold text-navy hover:border-navy" data-conversations-entry>
              <span aria-hidden>‹</span> All conversations
            </Link>
          )}
          {!threads.length && <p className="p-3 text-muted">{sp.q ? "Nothing found." : view === "catalog" ? "No catalog requests yet." : "No conversations yet."}</p>}
          <ul className="divide-y divide-line">
            {threads.map((t) => (
              <li key={t.contact_phone}>
                <Link href={`/admin/messages?${view !== "conversations" ? `v=${view}&` : ""}p=${encodeURIComponent(t.contact_phone)}`} className={`block rounded-lg px-3 py-3 hover:bg-bg ${t.contact_phone === phone ? "bg-bg" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-bold">{t.customer_name || formatPhone(t.contact_phone)}</span>
                    <span className="shrink-0 text-xs text-muted">{when(t.last_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm text-muted">
                    <span className="truncate">{t.last_direction === "out" ? "You: " : ""}{t.last_body}</span>
                    {t.unread > 0 && <span className="shrink-0 rounded-full bg-sun px-2 text-xs font-black text-navy">{t.unread}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="card order-first p-4 lg:order-none">
          {/* Abraham, Nov 24, 2026: search and a new text at the top of this box */}
          {/* Abraham, Nov 24, 2026: a new text at the top of this box; search is the icon on the conversation list */}
          <div className={`grid gap-2 ${phone ? "mb-3 border-b border-line pb-3" : ""}`} data-messages-toolbar>
            {staff.role === "owner" && (
              <form className="flex gap-2" data-new-text>
                <input name="p" type="tel" inputMode="tel" autoComplete="off" required placeholder="845-415-7585" aria-label="Phone number for a new text" className="input" />
                <button className="btn-dark whitespace-nowrap">New text</button>
              </form>
            )}
            {sp.p && !phone && (
              <p role="alert" className="text-sm font-semibold text-[#C83A2F]" data-bad-number>
                &ldquo;{sp.p}&rdquo; is not a valid US or Canada mobile number. Enter 10 digits, for example 845-415-7585.
              </p>
            )}
          </div>
          {!phone && <p className="hidden p-3 text-muted lg:block">Choose a conversation{staff.role === "owner" ? ", or start a new text above" : ""}.</p>}
          {phone && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <div>
                  <Link href="/admin/messages" className="mb-1 block text-sm font-semibold text-navy lg:hidden">← All conversations</Link>
                  <div className="text-lg font-black">{current?.customer_name || formatPhone(phone)}</div>
                  <div className="text-sm text-muted">{formatPhone(phone)}</div>
                </div>
                <div className="flex gap-2 text-sm">
                  <a className="btn-ghost" href={`tel:${phone}`}>Call</a>
                  {current?.customer_id && <Link className="btn-ghost" href={`/admin/customers/${current.customer_id}`}>Customer</Link>}
                </div>
              </div>
              {!msgs.length && <p className="p-3 text-muted" data-new-thread>No texts with this number yet. Type your message below.</p>}
              <ol className="max-h-[60vh] space-y-2 overflow-y-auto pr-1" data-thread>
                {msgs.map((m) => (
                  <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${m.direction === "out" ? "bg-navy text-white" : "bg-bg"}`}>
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      <MessageFiles files={files.filter((f) => f.messageId === m.id)} dark={m.direction === "out"} />
                      {m.mediaUrls.length > 0 && !files.some((f) => f.messageId === m.id) && (
                        <p className={`text-xs ${m.direction === "out" ? "text-white/80" : "text-muted"}`}>{m.mediaUrls.length} file{m.mediaUrls.length > 1 ? "s" : ""} (from before files were saved here)</p>
                      )}
                      <p className={`mt-1 text-[11px] ${m.direction === "out" ? "text-white/70" : "text-muted"}`}>
                        {when(m.createdAt)}
                        {m.direction === "out" && ` · ${m.status}`}
                        {m.event && m.direction === "out" ? ` · ${m.event.replace(/_/g, " ")}` : ""}
                        {m.errorMessage ? ` · ${m.errorMessage}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {staff.role === "owner" ? (
                <ReplyForm phone={phone} />
              ) : (
                <p className="mt-4 text-sm text-muted">Secretaries send approved messages (booking confirmation, payment link) from the order page.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

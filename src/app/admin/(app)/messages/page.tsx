import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { formatPhone, toE164 } from "@/lib/phone";
import { listThreads, markThreadRead, threadMessages } from "@/lib/messages";
import ReplyForm from "./ReplyForm";

export const dynamic = "force-dynamic";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const when = (d: Date | string) => new Date(d).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Text conversations with customers (Owner and Secretary). Owner can reply free-form. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ p?: string; q?: string }> }) {
  const staff = await requireStaff(["owner", "secretary"]);
  const sp = await searchParams;
  const threads = await listThreads(sp.q);
  const phone = sp.p ? toE164(sp.p) : null;
  const msgs = phone ? await threadMessages(phone) : [];
  if (phone) await markThreadRead(phone);
  const current = threads.find((t) => t.contact_phone === phone);
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Messages</h1>
      <p className="mb-5 text-muted">Texts to and from customers on the hotline number.</p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className={`card p-3 ${phone ? "hidden lg:block" : ""}`}>
          <form className="mb-3 flex gap-2">
            <input name="q" defaultValue={sp.q} placeholder="Search name, number or text" className="input" />
            <button className="btn-ghost">Search</button>
          </form>
          {!threads.length && <p className="p-3 text-muted">No conversations yet.</p>}
          <ul className="divide-y divide-line">
            {threads.map((t) => (
              <li key={t.contact_phone}>
                <Link href={`/admin/messages?p=${encodeURIComponent(t.contact_phone)}`} className={`block rounded-lg px-3 py-3 hover:bg-bg ${t.contact_phone === phone ? "bg-bg" : ""}`}>
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

        <div className={`card p-4 ${phone ? "" : "hidden lg:block"}`}>
          {!phone && <p className="p-3 text-muted">Choose a conversation.</p>}
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
              <ol className="max-h-[60vh] space-y-2 overflow-y-auto pr-1" data-thread>
                {msgs.map((m) => (
                  <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${m.direction === "out" ? "bg-navy text-white" : "bg-bg"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
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

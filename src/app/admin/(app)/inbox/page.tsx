import Link from "next/link";
import { inArray } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { htmlToText, inboxWhen } from "@/lib/inbox-format";
import { FOLDERS, PAGE_SIZE, folderWhere, hasFilters, isFolder, listDrafts, listLabels, listScheduled, listSent, listThreads, type Folder, type MailFilters } from "@/lib/inbox-folders";
import MailShell from "./MailShell";
import RefreshMail from "./RefreshMail";
import { discardDraftRowAction, unscheduleAction } from "./actions";
import MailList, { type MailRow } from "./MailList";
import { and, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · Hup Up Attractions" };

const snippet = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

type SP = { q?: string; f?: string; label?: string; p?: string; from?: string; to?: string; subject?: string; has?: string; not?: string; within?: string; attach?: string; unread?: string; sort?: string };

/** The attachments of each email, by email id (names for the chips under a row, like Gmail). */
async function filesFor(ids: number[]) {
  if (!ids.length) return new Map<number, string[]>();
  const rows = await db.select({ emailId: schema.inboxFiles.emailId, name: schema.inboxFiles.fileName }).from(schema.inboxFiles).where(inArray(schema.inboxFiles.emailId, ids));
  const m = new Map<number, string[]>();
  for (const r of rows) if (r.emailId) m.set(r.emailId, [...(m.get(r.emailId) ?? []), r.name]);
  return m;
}

/**
 * info@hupupattractions.com, like Gmail (Abraham, Nov 12, 15 and 19, 2026), in our colors, full width. Owner only.
 * Every email opens: received (Inbox, Spam, Snoozed, every folder), Sent, Drafts and Scheduled. Nothing is ever
 * deleted: Trash and Spam only hide an email.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireOwner();
  const sp = await searchParams;
  const folder: Folder = isFolder(sp.f) ? sp.f : "inbox";
  const page = Math.max(1, Number(sp.p) || 1);
  const filters: MailFilters = {
    q: sp.q?.trim() || undefined,
    from: sp.from?.trim() || undefined,
    to: sp.to?.trim() || undefined,
    subject: sp.subject?.trim() || undefined,
    has: sp.has?.trim() || undefined,
    not: sp.not?.trim() || undefined,
    within: sp.within || undefined,
    attach: sp.attach === "1",
    unread: sp.unread === "1",
    sort: sp.sort === "relevant" ? "relevant" : "recent",
  };
  const searching = hasFilters(filters);
  const title = sp.label ?? FOLDERS.find((x) => x.key === folder)!.label;
  const keep: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (v && k !== "p") keep[k] = String(v);
  const qs = (p: number) => `/admin/inbox?${new URLSearchParams({ ...keep, ...(p > 1 ? { p: String(p) } : {}) }).toString()}`;

  let body: React.ReactNode;
  let total = 0;
  if (folder === "sent") {
    const r = await listSent({ q: filters.q, page });
    total = r.total;
    body = (
      <div className="card divide-y divide-line" data-mail-sent>
        {r.rows.map((x) => (
          <Link key={x.id} href={`/admin/inbox/sent/${x.id}`} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 hover:bg-bg hover:shadow-[inset_0_-1px_0_#cfd8e3] sm:flex-nowrap" data-sent-row={x.id}>
            <span className="w-full truncate sm:w-56 sm:shrink-0">To: {x.toAddress}</span>
            <span className="min-w-0 flex-1 truncate">{x.subject}<span className="text-muted"> - {snippet(x.body)}</span></span>
            <span className={`shrink-0 text-xs ${x.sent ? "text-muted" : "font-bold text-coral-dark"}`}>{x.sent ? inboxWhen(x.createdAt) : "Not sent"}</span>
          </Link>
        ))}
        {!r.rows.length && <p className="px-4 py-10 text-center text-muted">Nothing sent yet.</p>}
      </div>
    );
  } else if (folder === "drafts" || folder === "scheduled") {
    const drafts = folder === "drafts" ? await listDrafts() : await listScheduled();
    total = drafts.length;
    body = (
      <div className="card divide-y divide-line" data-mail-drafts>
        {drafts.map((d) => (
          <div key={d.id} className="flex items-center gap-2 px-4 py-2 hover:bg-bg">
            <Link href={`/admin/inbox/new?draft=${d.id}`} className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 sm:flex-nowrap" data-draft-row={d.id}>
              <span className="w-full truncate sm:w-56 sm:shrink-0"><span className="text-coral-dark">{folder === "drafts" ? "Draft" : "Scheduled"}</span>{d.toAddress ? <span className="text-muted">, {d.toAddress}</span> : null}</span>
              <span className="min-w-0 flex-1 truncate">{d.subject || "(no subject)"}<span className="text-muted"> - {snippet(d.body)}</span>{d.sendError && <span className="ml-2 text-xs font-bold text-coral-dark">Not sent: {d.sendError}</span>}</span>
              <span className="shrink-0 text-xs text-muted">{d.sendAt ? `Sends ${inboxWhen(d.sendAt)}` : inboxWhen(d.updatedAt)}</span>
            </Link>
            {folder === "scheduled" ? (
              <form action={unscheduleAction}>
                <input type="hidden" name="id" value={d.id} />
                <button className="rounded-full px-2 py-1 text-xs font-semibold text-muted hover:bg-white hover:text-coral-dark" data-cancel-schedule={d.id}>Cancel send</button>
              </form>
            ) : (
              <form action={discardDraftRowAction.bind(null, d.id)}>
                <button className="rounded-full px-2 py-1 text-xs font-semibold text-muted hover:bg-white hover:text-coral-dark" data-discard-draft={d.id}>Discard</button>
              </form>
            )}
          </div>
        ))}
        {!drafts.length && <p className="px-4 py-10 text-center text-muted">{folder === "drafts" ? "No drafts." : "Nothing scheduled."}</p>}
      </div>
    );
  } else {
    // One row per conversation, like Gmail (Nov 19, 2026)
    const [r, labels] = await Promise.all([listThreads({ folder, label: sp.label, page, filters }), listLabels()]);
    total = r.total;
    const color = Object.fromEntries(labels.map((l) => [l.name, l.color]));
    const files = await filesFor(r.rows.flatMap((x) => x.ids));
    // "Inbox" chip on rows that are in the Inbox, when the list is a search, All mail or a label (like Gmail)
    const inInbox = searching || folder !== "inbox" || sp.label
      ? new Set((await db.select({ id: schema.inboxEmails.id }).from(schema.inboxEmails).where(and(folderWhere("inbox"), r.rows.length ? inArray(schema.inboxEmails.id, r.rows.map((x) => x.id)) : sql`false`))).map((x) => x.id))
      : new Set<number>();
    const rows: MailRow[] = r.rows.map((x) => ({
      id: x.id,
      from: x.fromName || x.fromAddress,
      subject: x.subject || "(no subject)",
      snippet: snippet(x.textBody?.trim() ? x.textBody : htmlToText(x.htmlBody ?? "")),
      when: inboxWhen(x.receivedAt),
      unread: x.unreadAny,
      ids: x.ids,
      count: x.count,
      hasDraft: x.hasDraft,
      sentByUs: x.sentByUs,
      starred: x.starred,
      important: x.important,
      inbox: inInbox.has(x.id) && folder !== "inbox",
      snoozedUntil: x.snoozedUntil && x.snoozedUntil > new Date() ? inboxWhen(x.snoozedUntil) : null,
      labels: x.labels.map((n) => ({ name: n, color: color[n] ?? "#2585D8" })),
      files: x.ids.flatMap((i) => files.get(i) ?? []),
    }));
    const words = [filters.q, filters.has, filters.from, filters.subject].filter(Boolean).join(" ").split(/\s+/).filter((w) => w.length > 1);
    body = <MailList rows={rows} folder={folder} label={sp.label} back={qs(page)} labels={labels.map((l) => ({ name: l.name, color: l.color }))} highlight={words} />;
  }

  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * PAGE_SIZE);
  const sortHref = (s: string) => `/admin/inbox?${new URLSearchParams({ ...keep, sort: s }).toString()}`;
  return (
    <MailShell folder={folder} label={sp.label} filters={filters}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black">{searching ? "Search results" : title}</h1>
        <div className="flex items-center gap-2 text-sm text-muted" data-mail-pages>
          {searching && filters.q && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full bg-bg px-3 py-1 text-xs font-semibold text-ink">{filters.sort === "relevant" ? "Showing most relevant" : "Showing most recent"} ▾</summary>
              <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-line bg-white py-1 shadow-lg">
                <Link href={sortHref("relevant")} className="block px-3 py-1.5 hover:bg-bg">Most relevant</Link>
                <Link href={sortHref("recent")} className="block px-3 py-1.5 hover:bg-bg">Most recent</Link>
              </div>
            </details>
          )}
          <RefreshMail />
          <span data-mail-range>{total ? `${from}–${to} of ${total}` : ""}</span>
          {page > 1 ? <Link className="rounded-full p-1.5 hover:bg-bg" href={qs(page - 1)} aria-label="Newer"><ChevronLeft className="h-4 w-4" /></Link> : <span className="p-1.5 opacity-30"><ChevronLeft className="h-4 w-4" /></span>}
          {to < total ? <Link className="rounded-full p-1.5 hover:bg-bg" href={qs(page + 1)} aria-label="Older"><ChevronRight className="h-4 w-4" /></Link> : <span className="p-1.5 opacity-30"><ChevronRight className="h-4 w-4" /></span>}
        </div>
      </div>
      {body}
      <p className="mt-2 text-xs text-muted">Email to info@hupupattractions.com. Every email and reply is kept; Trash and Spam only hide an email.</p>
    </MailShell>
  );
}

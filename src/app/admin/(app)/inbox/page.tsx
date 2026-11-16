import Link from "next/link";
import { inArray } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { inboxWhen } from "@/lib/inbox-format";
import { FOLDERS, PAGE_SIZE, isFolder, listDrafts, listEmails, listLabels, listSent, type Folder } from "@/lib/inbox-folders";
import MailShell from "./MailShell";
import RefreshMail from "./RefreshMail";
import MailList, { type MailRow } from "./MailList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · Hup Up Attractions" };

const snippet = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

/**
 * info@hupupattractions.com, Gmail-style (Abraham, Nov 12 and Nov 15, 2026), in our colors. Owner only.
 * Nothing is ever deleted: Trash only hides an email.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; label?: string; p?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const folder: Folder = isFolder(sp.f) ? sp.f : "inbox";
  const page = Math.max(1, Number(sp.p) || 1);
  const q = sp.q?.trim() || undefined;
  const title = sp.label ?? FOLDERS.find((x) => x.key === folder)!.label;
  const qs = (p: number) => `/admin/inbox?${new URLSearchParams({ ...(folder !== "inbox" ? { f: folder } : {}), ...(sp.label ? { label: sp.label } : {}), ...(q ? { q } : {}), ...(p > 1 ? { p: String(p) } : {}) }).toString()}`;

  let body: React.ReactNode;
  let total = 0;
  if (folder === "sent") {
    const r = await listSent({ q, page });
    total = r.total;
    body = (
      <div className="card divide-y divide-line" data-mail-sent>
        {r.rows.map((x) => (
          <Link key={x.id} href={x.emailId ? `/admin/inbox/${x.emailId}` : "/admin/inbox?f=sent"} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 hover:bg-bg sm:flex-nowrap">
            <span className="w-full truncate sm:w-48 sm:shrink-0">To: {x.toAddress}</span>
            <span className="min-w-0 flex-1 truncate">{x.subject}<span className="text-muted"> - {snippet(x.body)}</span></span>
            <span className={`shrink-0 text-xs ${x.sent ? "text-muted" : "font-bold text-coral-dark"}`}>{x.sent ? inboxWhen(x.createdAt) : "Not sent"}</span>
          </Link>
        ))}
        {!r.rows.length && <p className="px-4 py-10 text-center text-muted">Nothing sent yet.</p>}
      </div>
    );
  } else if (folder === "drafts") {
    const drafts = await listDrafts();
    total = drafts.length;
    body = (
      <div className="card divide-y divide-line" data-mail-drafts>
        {drafts.map((d) => (
          <Link key={d.id} href={`/admin/inbox/new?draft=${d.id}`} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 hover:bg-bg sm:flex-nowrap">
            <span className="w-full truncate font-semibold text-coral-dark sm:w-48 sm:shrink-0">Draft{d.toAddress ? `: ${d.toAddress}` : ""}</span>
            <span className="min-w-0 flex-1 truncate">{d.subject || "(no subject)"}<span className="text-muted"> - {snippet(d.body)}</span></span>
            <span className="shrink-0 text-xs text-muted">{inboxWhen(d.updatedAt)}</span>
          </Link>
        ))}
        {!drafts.length && <p className="px-4 py-10 text-center text-muted">No drafts.</p>}
      </div>
    );
  } else {
    const [r, labels] = await Promise.all([listEmails({ folder, q, label: sp.label, page }), listLabels()]);
    total = r.total;
    const color = Object.fromEntries(labels.map((l) => [l.name, l.color]));
    const withFiles = r.rows.length
      ? new Set((await db.selectDistinct({ id: schema.inboxFiles.emailId }).from(schema.inboxFiles).where(inArray(schema.inboxFiles.emailId, r.rows.map((x) => x.id)))).map((x) => x.id))
      : new Set<number | null>();
    const rows: MailRow[] = r.rows.map((x) => ({
      id: x.id,
      from: x.fromName || x.fromAddress,
      subject: x.subject || "(no subject)",
      snippet: snippet(x.textBody),
      when: inboxWhen(x.receivedAt),
      unread: !x.readAt,
      starred: x.starred,
      labels: x.labels.map((n) => ({ name: n, color: color[n] ?? "#2585D8" })),
      attach: withFiles.has(x.id),
    }));
    body = <MailList rows={rows} folder={folder} back={qs(page)} labels={labels.map((l) => ({ name: l.name, color: l.color }))} />;
  }

  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <MailShell folder={folder} label={sp.label} q={q}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h1 className="text-xl font-black">{q ? `Search: ${q}` : title}</h1>
        <div className="flex items-center gap-2 text-sm text-muted" data-mail-pages>
          <RefreshMail />
          <span>{total ? `${from} to ${to} of ${total}` : ""}</span>
          {page > 1 && <Link className="btn-ghost !py-1" href={qs(page - 1)} aria-label="Newer">Newer</Link>}
          {to < total && <Link className="btn-ghost !py-1" href={qs(page + 1)} aria-label="Older">Older</Link>}
        </div>
      </div>
      {body}
      <p className="mt-2 text-xs text-muted">Email to info@hupupattractions.com. Every email and reply is kept; Trash only hides an email.</p>
    </MailShell>
  );
}

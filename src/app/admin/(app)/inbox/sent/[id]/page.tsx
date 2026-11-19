import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Forward, Reply } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { inboxWhen } from "@/lib/inbox-format";
import MailShell from "../../MailShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sent email · Inbox · Hup Up Attractions" };

/** A sent email opens like Gmail (Abraham, Nov 19, 2026): who it went to, when, the files, then Reply or Forward. */
export default async function SentEmailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const id = Number((await params).id);
  const [r] = Number.isInteger(id) ? await db.select().from(schema.inboxReplies).where(eq(schema.inboxReplies.id, id)).limit(1) : [];
  if (!r) notFound();
  const files = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.replyId, r.id));
  return (
    <MailShell folder="sent">
      <div className="card mb-3 flex flex-wrap items-center gap-1 px-2 py-1.5" data-email-toolbar>
        <Link href="/admin/inbox?f=sent" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold text-navy hover:bg-bg">← Back</Link>
        {r.emailId && <Link href={`/admin/inbox/${r.emailId}`} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg">Open the conversation</Link>}
        <Link href={r.emailId ? `/admin/inbox/${r.emailId}#reply` : `/admin/inbox/new?sentReply=${r.id}`} className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg" data-sent-reply><Reply className="h-4 w-4" aria-hidden /> Reply</Link>
        <Link href={`/admin/inbox/new?sentForward=${r.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg" data-sent-forward><Forward className="h-4 w-4" aria-hidden /> Forward</Link>
      </div>
      <div className="card p-5" data-sent-email>
        <h1 className="text-xl font-black sm:text-2xl">{r.subject || "(no subject)"}</h1>
        <p className="mt-1 text-sm"><b>From:</b> Hup Up Attractions &lt;info@hupupattractions.com&gt;</p>
        <p className="text-sm"><b>To:</b> {r.toAddress}</p>
        <p className="text-sm text-muted">{inboxWhen(r.createdAt)}{r.sent ? "" : " · Not sent"}{r.error ? ` (${r.error})` : ""}</p>
        <pre className="mt-4 whitespace-pre-wrap break-words border-t border-line pt-4 font-sans text-[15px] leading-relaxed">{r.body}</pre>
        {files.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <h2 className="mb-2 font-bold">Attachments</h2>
            {files.map((f) => <a key={f.id} className="mr-3 text-sm font-semibold underline" href={`/api/admin/inbox/file/${f.id}`}>{f.fileName}</a>)}
          </div>
        )}
      </div>
    </MailShell>
  );
}

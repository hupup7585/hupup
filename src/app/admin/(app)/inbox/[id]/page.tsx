import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { getInboxEmail, repliesActive, setRead } from "@/lib/inbox";
import { inboxWhen, sizeLabel } from "@/lib/inbox-format";
import ReplyForm from "./ReplyForm";
import MailShell from "../MailShell";
import StarButton from "./StarButton";
import { bulkAction } from "../actions";
import { listDrafts, listLabels } from "@/lib/inbox-folders";
import { Archive, Forward, Inbox, Mail, Reply, Trash2, Undo2 } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email · Inbox · Hup Up Attractions" };

export default async function InboxEmailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const id = Number((await params).id);
  const found = Number.isInteger(id) ? await getInboxEmail(id) : null;
  if (!found) notFound();
  const { email, files, replies, replyFiles, contact } = found;
  if (!email.readAt) await setRead(email.id, true); // opening it marks it read
  const labels = await listLabels();
  const replyDraft = (await listDrafts()).find((d) => d.replyToEmailId === email.id);
  const folder = email.trashedAt ? "trash" : email.archivedAt ? "archive" : "inbox";
  const back = folder === "inbox" ? "/admin/inbox" : `/admin/inbox?f=${folder}`;
  const act = (action: string, icon: React.ReactNode, text: string, to = back) => (
    <form action={bulkAction}>
      <input type="hidden" name="id" value={email.id} />
      <input type="hidden" name="back" value={to} />
      <button name="action" value={action} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg">{icon} {text}</button>
    </form>
  );
  const ic = "h-4 w-4";
  return (
    <MailShell folder={folder}>
      <div className="card mb-3 flex flex-wrap items-center gap-1 px-2 py-1.5" data-email-toolbar>
        <Link href={back} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold text-navy hover:bg-bg">← Back</Link>
        {folder === "trash"
          ? act("restore", <Undo2 className={ic} aria-hidden />, "Restore", `/admin/inbox/${email.id}`)
          : (
            <>
              {folder === "archive" ? act("inbox", <Inbox className={ic} aria-hidden />, "Move to Inbox", `/admin/inbox/${email.id}`) : act("archive", <Archive className={ic} aria-hidden />, "Archive")}
              {act("trash", <Trash2 className={ic} aria-hidden />, "Trash")}
            </>
          )}
        {act("unread", <Mail className={ic} aria-hidden />, "Mark as unread")}
        <StarButton id={email.id} starred={email.starred} />
        {labels.length > 0 && (
          <form action={bulkAction} className="inline-flex items-center gap-1">
            <input type="hidden" name="id" value={email.id} />
            <input type="hidden" name="back" value={`/admin/inbox/${email.id}`} />
            <select name="label" className="input !w-36 !py-1 text-sm" aria-label="Label">{labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}</select>
            <button name="action" value="label" className="rounded-full px-2 py-1.5 text-sm hover:bg-bg">Add label</button>
            <button name="action" value="unlabel" className="rounded-full px-2 py-1.5 text-sm hover:bg-bg">Remove</button>
          </form>
        )}
        <a href="#reply" className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg"><Reply className={ic} aria-hidden /> Reply</a>
        <Link href={`/admin/inbox/new?forward=${email.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg" data-forward><Forward className={ic} aria-hidden /> Forward</Link>
      </div>
      <div className="card p-5" data-inbox-email>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-black sm:text-2xl">{email.subject || "(no subject)"}</h1>
            <p className="mt-1 text-sm">
              <b>From:</b> {email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}
              {contact && (
                <>
                  {" "}
                  ·{" "}
                  <Link className="font-semibold underline" href={`/admin/customers/${contact.id}`}>
                    Contact: {contact.name || contact.phone || contact.email}
                  </Link>
                </>
              )}
            </p>
            <p className="text-sm text-muted">{inboxWhen(email.receivedAt)}</p>
          </div>
          {email.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {email.labels.map((n) => <span key={n} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: labels.find((l) => l.name === n)?.color ?? "#2585D8" }}>{n}</span>)}
            </div>
          )}
        </div>
        <div className="mt-4 border-t border-line pt-4">
          {email.textBody?.trim() ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed">{email.textBody}</pre>
          ) : email.htmlBody ? (
            // HTML-only email: shown in a locked frame (no scripts, no forms, no outside requests run)
            <iframe title="Email" sandbox="" srcDoc={email.htmlBody} className="h-[60vh] w-full rounded-lg border border-line bg-white" />
          ) : (
            <p className="text-muted">(no text)</p>
          )}
        </div>
        {files.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <h2 className="mb-2 font-bold">Attachments</h2>
            <ul className="space-y-1 text-sm">
              {files.map((f) => (
                <li key={f.id}>
                  {f.tooBig ? (
                    <span className="text-muted">
                      {f.fileName} ({sizeLabel(f.sizeBytes)}): over 10 MB, so it's only in the Gmail copy
                    </span>
                  ) : (
                    <a className="font-semibold underline" href={`/api/admin/inbox/file/${f.id}`} target="_blank" rel="noreferrer">
                      {f.fileName}
                    </a>
                  )}{" "}
                  {!f.tooBig && <span className="text-muted">({sizeLabel(f.sizeBytes)})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {replies.map((r) => (
        <div key={r.id} className="card mt-3 border-l-4 border-sky p-5">
          <p className="text-sm">
            <b>{r.sent ? "Reply sent" : "Reply not sent"}</b> to {r.toAddress} · {inboxWhen(r.createdAt)}
            {r.error && <span className="text-coral-dark"> ({r.error})</span>}
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[15px]">{r.body}</pre>
          {replyFiles.filter((f) => f.replyId === r.id).map((f) => (
            <a key={f.id} className="mr-3 text-sm font-semibold underline" href={`/api/admin/inbox/file/${f.id}`}>
              {f.fileName}
            </a>
          ))}
        </div>
      ))}
      <div id="reply">
        <ReplyForm emailId={email.id} to={email.fromAddress} active={repliesActive()} draftId={replyDraft?.id} initialBody={replyDraft?.body} />
      </div>
    </MailShell>
  );
}

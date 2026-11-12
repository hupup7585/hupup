import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { getInboxEmail, repliesActive, setRead } from "@/lib/inbox";
import { inboxWhen, sizeLabel } from "@/lib/inbox-format";
import ReadToggle from "./ReadToggle";
import ReplyForm from "./ReplyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email · Inbox · Hup Up Attractions" };

export default async function InboxEmailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const id = Number((await params).id);
  const found = Number.isInteger(id) ? await getInboxEmail(id) : null;
  if (!found) notFound();
  const { email, files, replies, replyFiles, contact } = found;
  if (!email.readAt) await setRead(email.id, true); // opening it marks it read
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/inbox" className="text-sm font-bold text-navy">
        ← Inbox
      </Link>
      <div className="card mt-3 p-5" data-inbox-email>
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
          <ReadToggle id={email.id} />
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
      <ReplyForm emailId={email.id} to={email.fromAddress} active={repliesActive()} />
    </div>
  );
}

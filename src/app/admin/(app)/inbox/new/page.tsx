import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getInboxEmail, repliesActive } from "@/lib/inbox";
import { forwardText, getDraft } from "@/lib/inbox-folders";
import ReplyForm from "../[id]/ReplyForm";
import MailShell from "../MailShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "New email · Hup Up Attractions" };

/** Compose from info@hupupattractions.com (Abraham, Nov 13 and 15, 2026): new, a saved draft, or a forward. Owner only. */
export default async function NewEmailPage({ searchParams }: { searchParams: Promise<{ draft?: string; forward?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  let init: { to?: string; subject?: string; body?: string; draftId?: number; forwardOf?: number; forwardFiles?: string[]; replyTo?: number } = {};
  if (sp.draft) {
    const d = await getDraft(Number(sp.draft));
    if (!d || d.discardedAt || d.sentReplyId) notFound();
    if (d.replyToEmailId) {
      // a reply draft opens on its email
      const { redirect } = await import("next/navigation");
      redirect(`/admin/inbox/${d.replyToEmailId}#reply`);
    }
    init = { to: d.toAddress, subject: d.subject, body: d.body, draftId: d.id, forwardOf: d.forwardOfEmailId ?? undefined };
  } else if (sp.forward) {
    const found = await getInboxEmail(Number(sp.forward));
    if (!found) notFound();
    const fw = forwardText(found.email);
    init = { subject: fw.subject, body: fw.body, forwardOf: found.email.id };
  }
  if (init.forwardOf) {
    const files = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.emailId, init.forwardOf));
    init.forwardFiles = files.filter((f) => f.complete && !f.tooBig).map((f) => f.fileName);
  }
  return (
    <MailShell>
      <ReplyForm active={repliesActive()} draftId={init.draftId} initialTo={init.to} initialSubject={init.subject} initialBody={init.body} forwardOf={init.forwardOf} forwardFiles={init.forwardFiles} />
    </MailShell>
  );
}

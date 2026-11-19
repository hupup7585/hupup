import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getInboxEmail, repliesActive } from "@/lib/inbox";
import { forwardText, getDraft } from "@/lib/inbox-folders";
import ReplyForm from "../[id]/ReplyForm";
import MailShell from "../MailShell";
import { currentCatalog } from "@/lib/catalog-pdf";
import { catalogEmailTemplate } from "@/lib/catalog-send";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "New email · Hup Up Attractions" };

/** Compose from info@hupupattractions.com (Abraham, Nov 13 and 15, 2026): new, a saved draft, or a forward. Owner only. */
export default async function NewEmailPage({ searchParams }: { searchParams: Promise<{ draft?: string; forward?: string; sentReply?: string; sentForward?: string }> }) {
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
  // Reply to or forward an email we sent (Abraham, Nov 19, 2026: every email opens and can be answered)
  if (sp.sentReply || sp.sentForward) {
    const [r] = await db.select().from(schema.inboxReplies).where(eq(schema.inboxReplies.id, Number(sp.sentReply ?? sp.sentForward))).limit(1);
    if (!r) notFound();
    const when = r.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
    init = sp.sentReply
      ? { to: r.toAddress, subject: /^re:/i.test(r.subject) ? r.subject : `Re: ${r.subject}`, body: `\n\nOn ${when}, Hup Up Attractions <info@hupupattractions.com> wrote:\n${r.body.split("\n").map((l) => `> ${l}`).join("\n")}` }
      : { subject: /^fwd?:/i.test(r.subject) ? r.subject : `Fwd: ${r.subject}`, body: `\n\n---------- Forwarded message ----------\nFrom: Hup Up Attractions <info@hupupattractions.com>\nDate: ${when}\nSubject: ${r.subject}\nTo: ${r.toAddress}\n\n${r.body}` };
  }
  if (init.forwardOf) {
    const files = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.emailId, init.forwardOf));
    init.forwardFiles = files.filter((f) => f.complete && !f.tooBig).map((f) => f.fileName);
  }
  // Add our catalog (Abraham, Nov 17, 2026): the current PDF and the catalog email wording from Admin
  const pdf = await currentCatalog();
  const catalog = pdf ? { fileName: pdf.fileName, ...catalogEmailTemplate(await getSettings()) } : null;
  return (
    <MailShell>
      <ReplyForm catalog={catalog} active={repliesActive()} draftId={init.draftId} initialTo={init.to} initialSubject={init.subject} initialBody={init.body} forwardOf={init.forwardOf} forwardFiles={init.forwardFiles} />
    </MailShell>
  );
}

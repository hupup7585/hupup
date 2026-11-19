import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { LABEL_COLORS, listLabels } from "@/lib/inbox-folders";
import { sql } from "drizzle-orm";
import MailShell from "../MailShell";
import { createLabelAction, editLabelAction, removeLabelAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage labels · Inbox · Hup Up Attractions" };

/** Manage labels, like Gmail's settings (Abraham, Nov 19, 2026): rename, color, how many emails, remove, create. */
export default async function LabelsPage() {
  await requireOwner();
  const labels = await listLabels();
  const counts = await db.select({ name: sql<string>`unnest(${schema.inboxEmails.labels})`, n: sql<number>`count(*)::int` }).from(schema.inboxEmails).groupBy(sql`1`);
  const count = Object.fromEntries(counts.map((c) => [c.name, c.n]));
  return (
    <MailShell>
      <div className="card p-5" data-manage-labels-page>
        <h1 className="text-xl font-black">Manage labels</h1>
        <p className="mb-4 text-sm text-muted">Renaming a label keeps it on every email. Removing a label takes it off the emails; the emails stay.</p>
        <div className="divide-y divide-line">
          {labels.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 py-2">
              <form action={editLabelAction} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="old" value={l.name} />
                <input name="name" defaultValue={l.name} className="input !w-56 !py-1" aria-label="Label name" maxLength={40} />
                <select name="color" defaultValue={l.color} className="input !w-32 !py-1" aria-label="Color" style={{ color: l.color }}>
                  {LABEL_COLORS.map((c) => <option key={c} value={c} style={{ color: c }}>■ {c}</option>)}
                </select>
                <span className="text-sm text-muted">{count[l.name] ?? 0} email{(count[l.name] ?? 0) === 1 ? "" : "s"}</span>
                <button className="btn-ghost !py-1 text-sm">Save</button>
              </form>
              <form action={removeLabelAction}>
                <input type="hidden" name="name" value={l.name} />
                <button className="rounded-full px-3 py-1 text-sm text-coral-dark hover:bg-bg">Remove</button>
              </form>
            </div>
          ))}
          {!labels.length && <p className="py-6 text-center text-muted">No labels yet.</p>}
        </div>
        <form action={createLabelAction} className="mt-4 flex gap-2">
          <input name="name" className="input !w-56 !py-1" placeholder="New label" aria-label="New label name" maxLength={40} />
          <input type="hidden" name="color" value={LABEL_COLORS[labels.length % LABEL_COLORS.length]} />
          <button className="btn-dark !py-1">Create</button>
        </form>
      </div>
    </MailShell>
  );
}

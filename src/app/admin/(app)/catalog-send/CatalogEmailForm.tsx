"use client";

import { useActionState } from "react";
import { saveCatalogEmailAction } from "./actions";

/**
 * Catalog name, "attach automatically" and the catalog email's wording (Abraham, Nov 17, 2026). The same subject and
 * message go out automatically (phone key 8, info@ "Catalog") and fill in when Compose > Add our catalog is pressed.
 */
export default function CatalogEmailForm({ name, auto, subject, body }: { name: string; auto: boolean; subject: string; body: string }) {
  const [state, action, pending] = useActionState(saveCatalogEmailAction, null);
  return (
    <form action={action} className="mt-4 grid gap-3 border-t border-line pt-4" data-catalog-email>
      <label className="block">
        <span className="label">Catalog name (added to the email subject)</span>
        <input name="name" defaultValue={name} maxLength={80} className="input max-w-md" placeholder="e.g. Chanukah Catalog 2026" />
      </label>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" name="auto" defaultChecked={auto} /> Attach the catalog PDF automatically to every catalog email
      </label>
      <label className="block">
        <span className="label">Email subject</span>
        <input name="subject" defaultValue={subject} maxLength={200} className="input" data-catalog-email-subject />
      </label>
      <label className="block">
        <span className="label">Email message</span>
        <textarea name="body" defaultValue={body} rows={8} maxLength={5000} className="input" data-catalog-email-body />
      </label>
      <p className="text-sm text-muted">
        <b>{"{Catalog Name}"}</b> is replaced with the catalog name above. The logo and signature are added by themselves. This wording is used for the
        automatic catalog email and when you press <b>Add our catalog</b> in Compose.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        <button className="btn-ghost" name="reset" value="1" disabled={pending} data-catalog-email-reset>
          Back to the approved wording
        </button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
      <p className="text-sm text-muted">Uploading a new PDF replaces the old one; type the new catalog&rsquo;s name here and save.</p>
    </form>
  );
}

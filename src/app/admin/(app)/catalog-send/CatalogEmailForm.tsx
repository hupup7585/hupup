"use client";

import { useActionState } from "react";
import { saveCatalogEmailAction } from "./actions";

/** Catalog name and "attach automatically" (Abraham, Nov 17, 2026). */
export default function CatalogEmailForm({ name, auto }: { name: string; auto: boolean }) {
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
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
      <p className="text-sm text-muted">Uploading a new PDF replaces the old one; type the new catalog&rsquo;s name here and save.</p>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { saveItemTypesAction } from "./actions";

/** The Item types form: one Save for the whole list (Admin handoff Phase 4). */
export default function TypesForm({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      data-item-types-form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveItemTypesAction(f);
          setMsg({ ok: r.ok, text: r.message });
        });
      }}
      className="space-y-4"
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {msg && <span role="status" className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

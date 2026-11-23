"use client";

import { useState, useTransition } from "react";
import { lookupDirectoryPhoneAction } from "./actions";

/** Owner only: what the phone line finds for a number, right now (the same lookup). */
export default function LookupBox() {
  const [pending, start] = useTransition();
  const [look, setLook] = useState("");
  const [found, setFound] = useState<{ ok: boolean; lines: string[]; message?: string } | null>(null);
  return (
    <div className="rounded-2xl border border-[#D9E3F0] bg-white p-4 shadow-sm">
      <h2 className="text-base font-black text-[#123D73]">Look up a phone number</h2>
      <p className="mb-2 text-sm text-[#5A6B82]">The same lookup the phone line uses. Every change in the sheet is used right away.</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await lookupDirectoryPhoneAction(look).catch(() => ({ ok: false, message: "Please try again." }));
            setFound({ ok: r.ok, lines: ("found" in r && r.found) || [], message: r.message });
          });
        }}
      >
        <input value={look} onChange={(e) => setLook(e.target.value)} inputMode="tel" placeholder="845 555 0123" className="input max-w-xs" data-lookup-phone />
        <button className="btn-dark" disabled={pending}>Look up</button>
      </form>
      {found && (
        <div className="mt-2 text-sm" data-lookup-result>
          {!found.ok ? <p className="rounded-lg bg-[#ffe6e4] p-2 font-bold text-[#b3261e]">{found.message}</p> : found.lines.length ? <ul className="ml-5 list-disc">{found.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>Not in the directory.</p>}
        </div>
      )}
    </div>
  );
}

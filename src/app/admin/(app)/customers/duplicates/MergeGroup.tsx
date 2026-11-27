"use client";

import { useState, useTransition } from "react";
import { mergeGroupAction } from "./actions";

/** One group's choice of the record to keep and its Merge button. Nothing happens until the Owner presses Merge and confirms. */
export default function MergeGroup({ groupKey, ids, suggestedKeepId, anyStop }: { groupKey: string; ids: number[]; suggestedKeepId: number; anyStop: boolean }) {
  const [keep, setKeep] = useState(suggestedKeepId);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3" data-merge-group={groupKey}>
      <label className="text-sm font-semibold">
        Keep record{" "}
        <select className="input inline-block w-auto py-1" value={keep} onChange={(e) => setKeep(Number(e.target.value))} data-keep-select>
          {ids.map((id) => (
            <option key={id} value={id}>
              Number {id}{id === suggestedKeepId ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn-dark"
        disabled={pending}
        data-merge-button
        onClick={() => {
          const others = ids.filter((i) => i !== keep);
          const ask = `Merge customer number ${others.join(", ")} into customer number ${keep}?\n\nEvery order, payment, text and note moves to customer number ${keep}. Nothing is deleted.${anyStop ? "\nOne of these records replied STOP, so the kept record will be marked Replied STOP." : ""}`;
          if (!window.confirm(ask)) return;
          start(async () => {
            const r = await mergeGroupAction(keep, others);
            setMsg({ ok: r.ok, text: r.message });
          });
        }}
      >
        {pending ? "Merging..." : "Merge"}
      </button>
      {msg && <span className={`text-sm font-semibold ${msg.ok ? "text-[#1F7A3A]" : "text-[#C83A2F]"}`} data-merge-result>{msg.text}</span>}
    </div>
  );
}

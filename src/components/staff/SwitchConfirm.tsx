"use client";

import { useState, useTransition } from "react";
import { requestSwitchCodeAction } from "@/app/admin/(app)/switch-actions";
import type { SensitiveSwitch } from "@/lib/switch-guard";

/**
 * The safety check before turning on a sensitive switch (Hark's review item 9): a fresh code to the Owner's own phone
 * and the typed words. Its two boxes are sent with the page's own Save (names switchCode and switchTyped).
 */
export function SwitchConfirm({ sw, label, phrase }: { sw: SensitiveSwitch; label: string; phrase: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-2 rounded-xl border border-[#E8C547] bg-[#FFF8E1] p-3 text-sm" data-switch-confirm={sw}>
      <p className="font-semibold">To turn on {label}: ask for a code, then type the code and the words below, then Save.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => start(async () => { const r = await requestSwitchCodeAction(sw); setMsg(r.devCode ? `${r.message} Test site code: ${r.devCode}` : r.message); })}>
          {pending ? "Sending..." : "Send me a code"}
        </button>
        <input name="switchCode" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" className="input w-32" />
        <input name="switchTyped" autoComplete="off" placeholder={phrase} className="input w-64" aria-label={`Type ${phrase}`} />
      </div>
      <p className="mt-1 text-xs text-muted">Type exactly: <b>{phrase}</b>. Turning it off never needs a code.</p>
      {msg && <p role="status" className="mt-1 font-semibold">{msg}</p>}
    </div>
  );
}

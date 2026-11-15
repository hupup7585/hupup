"use client";

import { useState, useTransition } from "react";
import { achirdSwitchAction, googleLiveSwitchAction } from "./actions";

/** The two Owner-only voice switches (Abraham, Nov 15, 2026). Both start off. */
export default function VoiceSwitches(p: { achird: boolean; allUploaded: boolean; missing: number; google: boolean; googleKey: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => setMsg(await fn()));
  return (
    <section className="card mb-4 grid gap-3 p-4 text-sm" data-voice-switches>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <b>Achird for the whole line</b>{" "}
          <span className="text-muted">
            {p.achird ? "On." : "Off."} {p.allUploaded ? "Every slot is uploaded." : `${p.missing} slots still need a recording, so this stays off.`} When on, lines with changing parts (names, amounts, dates, order numbers) are put together from the recordings.
          </span>
        </div>
        <button
          className="btn-dark !py-1 text-xs"
          disabled={pending || (!p.achird && !p.allUploaded)}
          onClick={() => {
            if (!p.achird && !confirm("Turn on Achird for the whole line? Every line will play from the recordings.")) return;
            run(() => achirdSwitchAction(!p.achird));
          }}
        >
          {p.achird ? "Turn off" : "Turn on"}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div>
          <b>Google Achird for the changing parts</b>{" "}
          <span className="text-muted">
            {p.google ? "On." : "Off."} Google speaks names, amounts and dates in Achird during the call. It needs a Google Cloud account with a card and GOOGLE_TTS_API_KEY in Vercel {p.googleKey ? "(the key is there)" : "(not there yet)"}, and it can cost money.
          </span>
        </div>
        <button
          className="btn-ghost !py-1 text-xs"
          disabled={pending || (!p.google && !p.googleKey)}
          onClick={() => {
            if (!p.google && !confirm("Turn on Google Achird for the changing parts? Google may charge for this.")) return;
            run(() => googleLiveSwitchAction(!p.google));
          }}
        >
          {p.google ? "Turn off" : "Turn on"}
        </button>
      </div>
      {msg && <p className={`text-xs font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
    </section>
  );
}

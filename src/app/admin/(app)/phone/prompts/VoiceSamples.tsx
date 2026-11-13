"use client";

import { useState, useTransition } from "react";
import { makeVoiceSamplesAction } from "./actions";

export type Sample = { voice: string; fileName: string; src: string | null };

/** Voice samples for picking the hotline voice. Listening only: the live voice doesn't change here. */
export default function VoiceSamples(props: { text: string; samples: Sample[]; ttsReady: boolean; liveVoice: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const missing = props.samples.filter((s) => !s.src).length;
  return (
    <section id="voice-samples" className="card mb-5 scroll-mt-20 p-5" data-voice-samples>
      <h2 className="text-lg font-bold">Voice samples</h2>
      <p className="mt-1 text-sm text-muted">
        Listening only. The phone line keeps its current voice (<b className="text-navy">{props.liveVoice}</b>) until you pick one. Each sample reads:
      </p>
      <p className="mt-2 rounded-lg bg-bg p-3 text-sm">{props.text}</p>
      <ul className="mt-3 divide-y divide-line">
        {props.samples.map((s) => (
          <li key={s.voice} className="flex flex-wrap items-center gap-3 py-2">
            <span className="w-64 font-semibold">{s.voice}</span>
            {s.src ? (
              <>
                <audio controls preload="none" src={s.src} className="h-8 max-w-full" aria-label={`Voice sample: ${s.voice}`} />
                <a className="text-xs text-muted underline" href={s.src} download={s.fileName}>
                  {s.fileName}
                </a>
              </>
            ) : (
              <span className="text-sm text-muted">{props.ttsReady ? "Not made yet" : "Not active yet"}</span>
            )}
          </li>
        ))}
      </ul>
      {missing > 0 &&
        (props.ttsReady ? (
          <button className="btn-dark mt-3 !py-1.5 text-sm" disabled={pending} onClick={() => start(async () => setMsg(await makeVoiceSamplesAction()))}>
            Make the {missing} sample{missing > 1 ? "s" : ""}
          </button>
        ) : (
          <p className="mt-3 text-sm">
            <b>Not active yet:</b> the samples are made with Google Text-to-Speech, which needs a Google Cloud billing account and key
            (GOOGLE_TTS_API_KEY in Vercel). All 16 Chirp 3 HD male voices, about 2,500 characters in all, inside Google&apos;s free monthly allowance.
          </p>
        ))}
      {msg?.message && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</p>}
    </section>
  );
}

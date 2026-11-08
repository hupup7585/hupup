"use client";

import { useState, useTransition } from "react";
import { KeyRound, MessageSquareText } from "lucide-react";
import { passwordAction, sendCodeAction, verifyCodeAction } from "./actions";

/** Staff sign-in: phone number, then a texted code (everyone) or a password (Owner and Secretary). */
export default function LoginForm() {
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<"code" | "password">("code");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [trust, setTrust] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendCodeAction(phone);
      if (!r.ok) return setError(r.message);
      setSent(true);
      setMsg(r.message);
      setDevCode(r.devCode ?? null);
    });

  return (
    // Abraham's sign-in design: bigger card and logo; logo on light blue #8CCBFF (never on navy); yellow #FFD84D accent; navy #123D73 and white.
    <div data-signin-card className="w-full max-w-md overflow-hidden sm:max-w-[560px] rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
      <div data-signin-logo-panel className="bg-sky px-8 pb-6 pt-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/hupup-logo-h128@1x.png" srcSet="/brand/hupup-logo-h128@1x.png 1x, /brand/hupup-logo-h128@2x.png 2x, /brand/hupup-logo-h128@3x.png 3x" width={122} height={128} alt="Hup Up Attractions" className="mx-auto h-32 w-auto" />
        <div className="mt-4 text-sm font-extrabold uppercase tracking-[0.2em] text-navy">Staff sign-in</div>
      </div>
      <div data-signin-accent className="h-1.5 bg-sun" aria-hidden />
      <div className="space-y-5 px-8 py-8">
        <label className="block">
          <span className="label">Your mobile number</span>
          <input className="input" inputMode="tel" autoComplete="tel-national" placeholder="(845) 555-0123" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} />
        </label>

        {!sent && (
          <div className="flex rounded-lg bg-bg p-1" role="tablist" aria-label="Sign-in method">
            {(
              [
                ["code", "Text me a code", MessageSquareText],
                ["password", "Use password", KeyRound],
              ] as const
            ).map(([m, label, Icon]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => (setMode(m), setError(null))} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold ${mode === m ? "bg-white text-navy shadow-sm" : "text-muted"}`}>
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </button>
            ))}
          </div>
        )}

        {mode === "code" && !sent && (
          <button className="btn-dark w-full py-3" onClick={send} disabled={pending || phone.replace(/\D/g, "").length < 10}>
            {pending ? "Sending…" : "Send code"}
          </button>
        )}

        {mode === "code" && sent && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                const r = await verifyCodeAction(phone, code, trust);
                if (r && !r.ok) setError(r.error ?? "Could not sign in.");
              });
            }}
            className="space-y-3"
          >
            {msg && <p className="text-sm text-muted">{msg}</p>}
            <label className="block">
              <span className="label">6-digit code</span>
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input text-center text-2xl tracking-[0.4em]" placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
            {devCode && <p className="rounded-lg bg-sun/40 p-2 text-sm">Dev mode code: <b>{devCode}</b></p>}
            <button className="btn-dark w-full py-3" disabled={pending || code.length !== 6}>
              {pending ? "Checking…" : "Sign in"}
            </button>
            <button type="button" className="text-sm font-bold text-navy underline-offset-2 hover:underline" onClick={() => (setSent(false), setCode(""))}>
              Use a different number
            </button>
          </form>
        )}

        {mode === "password" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                const r = await passwordAction(phone, password, trust);
                if (r && !r.ok) setError(r.error ?? "Could not sign in.");
              });
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="label">Password</span>
              <input type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="btn-dark w-full py-3" disabled={pending || !password || phone.replace(/\D/g, "").length < 10}>
              {pending ? "Checking…" : "Sign in"}
            </button>
            <p className="text-xs text-muted">Delivery accounts sign in with a texted code.</p>
          </form>
        )}

        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> Keep me signed in on this device for 30 days
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-[#ffe6e4] p-2 text-sm font-semibold text-[#b3261e]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

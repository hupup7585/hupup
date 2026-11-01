"use client";

import { useState, useTransition } from "react";
import { sendCodeAction, verifyCodeAction } from "./actions";

export default function LoginForm({ sms, email }: { sms: string; email: string }) {
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendCodeAction(channel);
      if (!r.ok) return setError(r.error || "Could not send code");
      setSent(true);
      setDevCode(r.devCode ?? null);
    });

  const verify = () =>
    start(async () => {
      setError(null);
      const r = await verifyCodeAction(code, trust);
      if (r && !r.ok) setError(r.error || "Incorrect code");
    });

  return (
    <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl shadow-navy/10 sm:p-10">
      <div className="flex items-center gap-3 text-xl font-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" className="h-10" />
        Hup Up Admin
      </div>
      <h1 className="mt-6 text-2xl font-black">{sent ? "Enter your 6-digit code" : "Owner sign-in"}</h1>
      <p className="mb-6 mt-1 text-muted">hupupattractions.com/admin</p>

      <div className="mb-3 flex rounded-xl bg-bg p-1">
        {(["sms", "email"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setChannel(c);
              setSent(false);
              setCode("");
            }}
            className={`flex-1 rounded-lg py-2.5 font-bold ${channel === c ? "bg-white text-navy shadow-sm" : "text-muted"}`}
          >
            {c === "sms" ? "💬 Text message" : "✉️ Email"}
          </button>
        ))}
      </div>

      {!sent ? (
        <>
          <p className="mb-5 text-sm text-muted">
            We&apos;ll send a one-time code to <b className="text-navy">{channel === "sms" ? sms : email}</b>.
          </p>
          <button className="btn-dark w-full py-3.5" onClick={send} disabled={pending}>
            {pending ? "Sending…" : "Send code"}
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <p className="text-sm text-muted">
            We sent a code to <b className="text-navy">{channel === "sms" ? sms : email}</b>
          </p>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="my-4 w-full rounded-2xl border-2 border-line px-4 py-3 text-center font-mono text-3xl font-extrabold tracking-[0.5em] outline-none focus:border-sky"
            placeholder="••••••"
            aria-label="6-digit code"
          />
          {devCode && <p className="mb-3 rounded-lg bg-sun/30 p-2 text-sm">Dev mode code: <b>{devCode}</b></p>}
          <button className="btn-dark w-full py-3.5" disabled={pending || code.length !== 6}>
            {pending ? "Checking…" : "Verify & sign in"}
          </button>
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> Trust this device for 30 days
            </label>
            <button type="button" className="font-bold text-sky" onClick={send} disabled={pending}>
              Resend code
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-4 rounded-lg bg-coral/10 p-3 text-sm font-semibold text-coral-dark">{error}</p>}
    </div>
  );
}

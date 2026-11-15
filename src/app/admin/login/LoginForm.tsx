"use client";

import { useState, useTransition } from "react";
import { KeyRound, Mail, MessageSquareText } from "lucide-react";
import { passwordAction, sendCodeAction, sendEmailCodeAction, verifyCodeAction } from "./actions";

/** Staff sign-in: one Username field (username, phone number or email), then a code by email or text, or a password. */
export type SignInWay = "password" | "email" | "sms";
/** Remembered on this device only (never per account on this page, so the page tells a stranger nothing). */
export const SIGNIN_WAY_COOKIE = "hup_signin_way";

export default function LoginForm({ smsActive = true, emailActive = true, initialWay = "password" }: { smsActive?: boolean; emailActive?: boolean; initialWay?: SignInWay }) {
  const [phone, setPhone] = useState("");
  const [way, setWay] = useState<SignInWay>(initialWay);
  const mode: "code" | "password" = way === "password" ? "password" : "code";
  const remember = (w: SignInWay) => {
    try {
      document.cookie = `${SIGNIN_WAY_COOKIE}=${w}; path=/admin; max-age=31536000; samesite=lax`;
    } catch {
      /* no cookies: nothing to remember */
    }
  };
  const [sent, setSent] = useState(false);
  const [via, setVia] = useState<"sms" | "email">("sms");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [trust, setTrust] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (how: "sms" | "email" = "sms") =>
    start(async () => {
      setError(null);
      setVia(how);
      const r = how === "email" ? await sendEmailCodeAction(phone) : await sendCodeAction(phone);
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
          <span className="label">Username</span>
          <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} data-username />
        </label>

        {!sent && (
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="How do you want to sign in?" data-signin-choice>
            {(
              [
                ["password", "Password", KeyRound],
                ["email", "Code by email", Mail],
                ["sms", "Code by text", MessageSquareText],
              ] as const
            ).map(([w, label, Icon]) => (
              <button key={w} type="button" role="tab" aria-selected={way === w} data-way={w} onClick={() => (setWay(w), setError(null))} className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-3 text-sm font-bold sm:flex-row sm:gap-1.5 ${way === w ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-navy"}`}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden /> {label}
              </button>
            ))}
          </div>
        )}

        {mode === "code" && !sent && (
          <div className="space-y-3" data-code-ways>
            {way === "email" && (
              <button type="button" data-email-code className="btn-dark w-full py-3" onClick={() => (remember("email"), send("email"))} disabled={!emailActive || pending || phone.trim().length < 3}>
                {pending && via === "email" ? "Sending…" : "Send me a code by email"}
              </button>
            )}
            {way === "email" && !emailActive && (
              <p data-not-active="email-login" className="rounded-lg bg-[#FFF8E1] p-3 text-sm text-[#5C4600]"><b>Not active yet:</b> email codes need the email sender set up. Use your password instead.</p>
            )}
            {way === "sms" && (
              <button type="button" data-sms-code className="btn-dark w-full py-3" onClick={() => (remember("sms"), send("sms"))} disabled={!smsActive || pending || phone.trim().length < 3}>
                {pending && via === "sms" ? "Sending…" : "Send me a code by text"}
              </button>
            )}
            {way === "sms" && !smsActive && (
              <p data-not-active="sms-login" className="rounded-lg bg-[#FFF8E1] p-3 text-sm text-[#5C4600]"><b>Not active yet:</b> text codes start once Twilio approves our texting registration (A2P). Use &ldquo;By email&rdquo; or your password instead. Delivery staff sign in by text code only, so Delivery sign-in starts when text codes do.</p>
            )}
            <p className="text-xs text-muted">The code goes to the {way === "email" ? "email" : "mobile number"} saved on your staff account. It works for 10 minutes. Delivery staff: code by text only.</p>
          </div>
        )}

        {mode === "code" && sent && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                const r = await verifyCodeAction(phone, code, trust, via);
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
                remember("password");
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
            <button className="btn-dark w-full py-3" disabled={pending || !password || phone.trim().length < 3}>
              {pending ? "Checking…" : "Sign in"}
            </button>
            <p className="text-xs text-muted">No password yet? Choose &ldquo;Send me a code&rdquo;, sign in, then set one under My account (or ask the Owner to set it on the Staff page). Delivery staff sign in by text code only.</p>
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

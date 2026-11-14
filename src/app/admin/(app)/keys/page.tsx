import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { dualDateTime } from "@/lib/dual-date";
import { KEYS_COOKIE, LOCKOUT_MINUTES, UNLOCK_MINUTES, isUnlocked, keysLog, listKeys, lockedUntil, masked, pagePasswordSet, vercelKeyNames } from "@/lib/api-keys";
import { codeAction, deleteKeyAction, lockAction, passwordAction, saveKeyAction, setPasswordAction, setupCodeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "API keys · Hup Up Attractions", robots: { index: false } };

const ACTION_LABEL: Record<string, string> = {
  unlock_code_sent: "Code emailed",
  unlocked: "Opened",
  failed_password: "Wrong password",
  failed_code: "Wrong code",
  locked_out: `Locked ${LOCKOUT_MINUTES} minutes (Owner emailed)`,
  add: "Key added",
  replace: "Key replaced",
  delete: "Key deleted",
  page_password_set: "Page password set",
};

/** Owner-only API Keys page (Abraham, Nov 14, 2026). Its own password plus an emailed code; locks after 10 minutes. */
export default async function KeysPage({ searchParams }: { searchParams: Promise<{ m?: string; step?: string }> }) {
  const staff = await requireOwner();
  const { m, step } = await searchParams;
  const token = (await cookies()).get(KEYS_COOKIE)?.value;
  const [hasPw, open, locked] = await Promise.all([pagePasswordSet(), isUnlocked(token, staff.userId), lockedUntil()]);
  const when = (d: Date) => dualDateTime(d);

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-black sm:text-3xl">API keys</h1>
      {/* Draft help line for Abraham's OK */}
      <p className="mb-4 mt-1 text-muted" data-keys-help>
        This page holds the passwords our website uses to talk to other services, like payments, phone and email. Only the Owner may open it. Keys are never shown in full.
      </p>
      {m && <p className="card mb-4 p-3 text-sm font-semibold" data-keys-message>{m}</p>}
      {children}
    </div>
  );

  if (locked && !open) return shell(<p className="card p-5 font-semibold text-[#C83A2F]" data-keys-locked>Locked until {when(locked)} after too many wrong tries. You were emailed.</p>);

  if (!hasPw)
    return shell(
      <div className="card space-y-4 p-5" data-keys-setup>
        <h2 className="text-lg font-black">Set the page password</h2>
        <p className="text-sm">This password is only for this page, not your Admin sign-in. First we email you a code.</p>
        <form action={setupCodeAction}><button className="btn-ghost">Email me a code</button></form>
        {step === "setup" && (
          <form action={setPasswordAction} className="grid gap-3 sm:max-w-sm">
            <label className="block"><span className="label">Code from the email</span><input name="code" inputMode="numeric" maxLength={6} required className="input" autoComplete="one-time-code" /></label>
            <label className="block"><span className="label">Page password (at least 12 characters)</span><input name="pw" type="password" minLength={12} required className="input" autoComplete="new-password" /></label>
            <label className="block"><span className="label">Same password again</span><input name="pw2" type="password" minLength={12} required className="input" autoComplete="new-password" /></label>
            <button className="btn-dark">Save password and open</button>
          </form>
        )}
      </div>,
    );

  if (!open)
    return shell(
      <div className="card p-5 sm:max-w-md" data-keys-unlock>
        {step === "code" ? (
          <form action={codeAction} className="grid gap-3">
            <label className="block"><span className="label">6-digit code from the email</span><input name="code" inputMode="numeric" maxLength={6} required autoFocus className="input text-center text-2xl tracking-[0.4em]" autoComplete="one-time-code" /></label>
            <button className="btn-dark">Open</button>
          </form>
        ) : (
          <form action={passwordAction} className="grid gap-3">
            <label className="block"><span className="label">Page password</span><input name="pw" type="password" required autoFocus className="input" autoComplete="current-password" /></label>
            <button className="btn-dark">Continue</button>
            <p className="text-xs text-muted">Then we email you a 6-digit code. The page locks after {UNLOCK_MINUTES} minutes with no activity.</p>
          </form>
        )}
      </div>,
    );

  const [keys, log, inVercel] = await Promise.all([listKeys(), keysLog(60), vercelKeyNames()]);
  return shell(
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Open. It locks after {UNLOCK_MINUTES} minutes with no activity.</p>
        <form action={lockAction}><button className="btn-ghost">Lock now</button></form>
      </div>

      <div className="card overflow-x-auto" data-keys-list>
        <table className="w-full text-sm">
          <thead>
            <tr><th className="th">Service</th><th className="th">Name</th><th className="th">For</th><th className="th">Mode</th><th className="th">Key</th><th className="th">Added</th><th className="th">Last changed</th><th className="th">Live system</th><th className="th"></th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} data-key-row={k.name}>
                <td className="td font-semibold">{k.service}</td>
                <td className="td font-mono text-xs">{k.name}</td>
                <td className="td">{k.purpose}</td>
                <td className="td">{k.mode === "live" ? <b className="text-[#C83A2F]">Live</b> : "Test"}</td>
                <td className="td font-mono" data-key-masked>{masked(k.last4)}</td>
                <td className="td">{when(k.createdAt)}</td>
                <td className="td">{when(k.updatedAt)}</td>
                <td className="td">{k.vercelSyncedAt ? `Sent ${when(k.vercelSyncedAt)}` : <span className="text-[#C83A2F]">{k.vercelError ?? "Not sent"}</span>}</td>
                <td className="td">
                  <details>
                    <summary className="cursor-pointer text-[#C83A2F]">Delete</summary>
                    <form action={deleteKeyAction} className="mt-2 grid gap-2">
                      <input type="hidden" name="name" value={k.name} />
                      <input name="pw" type="password" required placeholder="Page password" className="input" autoComplete="current-password" />
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" /> Yes, delete {k.name}</label>
                      <button className="btn-ghost text-[#C83A2F]">Delete key</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
            {!keys.length && <tr><td className="td text-muted" colSpan={9}>No keys saved here yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <form action={saveKeyAction} className="card mt-5 grid gap-3 p-5 sm:grid-cols-2" data-key-form autoComplete="off">
        <h2 className="text-lg font-black sm:col-span-2">Add or replace a key</h2>
        <label className="block"><span className="label">Name (as in Vercel)</span><input name="name" required className="input font-mono" placeholder="STRIPE_READ_KEY" /></label>
        <label className="block"><span className="label">Service</span><input name="service" required className="input" placeholder="Stripe" /></label>
        <label className="block sm:col-span-2"><span className="label">What it is for</span><input name="purpose" className="input" placeholder="Stripe fees and payouts in Bookkeeping" /></label>
        <label className="block"><span className="label">Mode</span><select name="mode" className="input" defaultValue="test"><option value="test">Test</option><option value="live">Live</option></select></label>
        <label className="block"><span className="label">Key (paste it; it is never shown again)</span><input name="value" type="password" required className="input font-mono" autoComplete="off" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirm" /> Yes, save this key. If the name already exists, the old key is replaced.</label>
        <button className="btn-dark sm:col-span-2 sm:w-fit">Save key</button>
      </form>

      {inVercel && (
        <p className="mt-4 text-xs text-muted" data-keys-vercel>
          In Vercel now (names only): {inVercel.join(", ")}
        </p>
      )}
      {!inVercel && <p className="mt-4 text-xs text-muted">The Vercel connection isn&rsquo;t set up yet, so keys are saved here and not sent to the live system.</p>}

      <h2 className="mb-2 mt-8 text-lg font-black">Access log</h2>
      <div className="card overflow-x-auto" data-keys-log>
        <table className="w-full text-sm">
          <thead><tr><th className="th">When</th><th className="th">What</th><th className="th">Key</th><th className="th">IP</th><th className="th">Device</th></tr></thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.id}>
                <td className="td">{when(r.at)}</td>
                <td className={`td ${r.ok ? "" : "font-bold text-[#C83A2F]"}`}>{ACTION_LABEL[r.action] ?? r.action}</td>
                <td className="td font-mono text-xs">{r.keyName ?? ""}</td>
                <td className="td">{r.ip ?? ""}</td>
                <td className="td max-w-[14rem] truncate text-xs">{r.userAgent ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>,
  );
}

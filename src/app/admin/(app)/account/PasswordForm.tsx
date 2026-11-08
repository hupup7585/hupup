"use client";

import { useActionState } from "react";
import { setOwnPasswordAction } from "./actions";

export default function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState(setOwnPasswordAction, null);
  return (
    <form action={action} className="max-w-md space-y-3" data-password-form>
      {hasPassword && (
        <label className="block">
          <span className="label">Current password</span>
          <input type="password" name="current" autoComplete="current-password" className="input" required />
        </label>
      )}
      <label className="block">
        <span className="label">New password (at least 10 characters)</span>
        <input type="password" name="next" autoComplete="new-password" minLength={10} className="input" required />
      </label>
      <label className="block">
        <span className="label">New password again</span>
        <input type="password" name="confirm" autoComplete="new-password" minLength={10} className="input" required />
      </label>
      <button className="btn-dark" disabled={pending}>{pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}</button>
      {state && <p role={state.ok ? "status" : "alert"} className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</p>}
    </form>
  );
}

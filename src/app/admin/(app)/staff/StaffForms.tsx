"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/lib/db/schema";
import { createStaffAction, setActiveAction, setOwnerUsernameAction, setPasswordAction, setUsernameAction } from "./actions";

export function AddStaffForm() {
  const [f, setF] = useState({ name: "", phone: "", role: "secretary" as Role, email: "", password: "", username: "" });
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createStaffAction(f);
          setMsg(r);
          if (r.ok) setF({ name: "", phone: "", role: "secretary", email: "", password: "", username: "" });
        });
      }}
    >
      <label className="block"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="block"><span className="label">Mobile number</span><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      <label className="block">
        <span className="label">Role</span>
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role, password: e.target.value === "delivery" ? "" : f.password })}>
          <option value="secretary">Secretary</option>
          <option value="delivery">Delivery</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <label className="block"><span className="label">Email (optional)</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="block">
        <span className="label">Username (optional)</span>
        <input className="input" autoCapitalize="none" spellCheck={false} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="sara" />
        <span className="mt-1 block text-xs text-muted">They can sign in with this username, their mobile number or their email. Example: sara or moshe.k</span>
      </label>
      {f.role !== "delivery" && (
        <label className="block sm:col-span-2">
          <span className="label">Password (optional, 10+ characters)</span>
          <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <span className="mt-1 block text-xs text-muted">They can always sign in with a texted code instead.</span>
        </label>
      )}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>Add staff member</button>
        {msg && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
      </div>
    </form>
  );
}

export function StaffRowActions({ userId, role, active, username }: { userId: number; role: Role; active: boolean; username?: string | null }) {
  const [pw, setPw] = useState("");
  const [un, setUn] = useState(username ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" data-username-row>
        <input className="input max-w-[12rem]" autoCapitalize="none" spellCheck={false} placeholder="Username" value={un} onChange={(e) => setUn(e.target.value)} aria-label="Username" />
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => start(async () => setMsg(await setUsernameAction(userId, un)))}>Save username</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {role !== "delivery" && (
          <>
            <input className="input max-w-[12rem]" type="password" placeholder="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="New password" />
            <button type="button" className="btn-ghost" disabled={pending || !pw} onClick={() => start(async () => (setMsg(await setPasswordAction(userId, pw)), setPw("")))}>Set password</button>
          </>
        )}
        <button type="button" className={active ? "btn-ghost" : "btn"} disabled={pending} onClick={() => {
          if (active && !window.confirm("Deactivate this staff member? They are signed out and can't sign in until reactivated.")) return;
          start(async () => setMsg(await setActiveAction(userId, !active)));
        }}>
          {active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
    </div>
  );
}

/** The Owner's own sign-in username (Abraham, Nov 14, 2026). */
export function OwnerUsernameForm({ initial }: { initial: string }) {
  const [un, setUn] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2" data-owner-username>
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-[14rem]" autoCapitalize="none" spellCheck={false} placeholder="Your username" value={un} onChange={(e) => setUn(e.target.value)} aria-label="Your username" />
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => start(async () => setMsg(await setOwnerUsernameAction(un)))}>Save my username</button>
      </div>
      <p className="text-xs text-muted">You can sign in with this username, your mobile number or your email.</p>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
    </div>
  );
}

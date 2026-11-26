"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/lib/db/schema";
import { createStaffAction, saveStaffAction, setActiveAction, setOwnerUsernameAction, type StaffResult } from "./actions";

/**
 * The simple Staff page (Abraham, Nov 26, 2026, 4:07 PM): one row per person (name, role, phone, Edit). Edit opens one
 * form with every field and one Save button. Deactivate is separate, with an "Are you sure?" step. No button is ever
 * greyed out without a reason: a missing value is said in plain words instead.
 */
export type StaffRow = { id: number; name: string; role: Role; phone: string; phoneShown: string; username: string | null; googleEmail: string | null; active: boolean; hasPassword: boolean; isSelf: boolean };

const ROLE_NAME: Record<Role, string> = { owner: "Owner", secretary: "Secretary", delivery: "Delivery" };

function Help({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-sm text-muted">{children}</span>;
}

function Msg({ m }: { m: StaffResult | null }) {
  if (!m) return null;
  return <p role="status" className={`mt-3 rounded-xl p-3 text-base font-semibold ${m.ok ? "bg-mint/15 text-[#13895C]" : "bg-[#FFE6E4] text-[#b3261e]"}`}>{m.message}</p>;
}

type FormValues = { name: string; phone: string; role: Role; username: string; password: string; googleEmail: string };

function StaffForm({ start, onSave, onCancel, saveLabel, ownerOnly }: { start: FormValues; onSave: (v: FormValues) => Promise<StaffResult>; onCancel: () => void; saveLabel: string; ownerOnly?: boolean }) {
  const [v, setV] = useState<FormValues>(start);
  const [msg, setMsg] = useState<StaffResult | null>(null);
  const [pending, go] = useTransition();
  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      autoComplete="off"
      className="mt-3 grid gap-4 rounded-2xl border border-line bg-bg p-4 sm:grid-cols-2"
      data-staff-form
      onSubmit={(e) => {
        e.preventDefault();
        go(async () => setMsg(await onSave(v)));
      }}
    >
      {!ownerOnly && (
        <>
          <label className="block">
            <span className="label">Name</span>
            <input className="input text-base" name="staff-name" autoComplete="off" value={v.name} onChange={set("name")} />
            <Help>The person&rsquo;s name, as staff will see it in Admin.</Help>
          </label>
          <label className="block">
            <span className="label">Mobile number</span>
            <input className="input text-base" name="staff-phone" inputMode="tel" autoComplete="off" value={v.phone} onChange={set("phone")} placeholder="845-415-7585" />
            <Help>Their own cell phone. Sign-in codes are texted to this number.</Help>
          </label>
          <label className="block">
            <span className="label">Role</span>
            <select className="input text-base" name="staff-role" value={v.role} onChange={set("role")}>
              <option value="secretary">Secretary</option>
              <option value="delivery">Delivery</option>
              <option value="owner">Owner</option>
            </select>
            <Help>Secretary: bookings and customers. Delivery: only their own stops. Owner: everything.</Help>
          </label>
        </>
      )}
      <label className="block">
        <span className="label">Username</span>
        <input className="input text-base" name="staff-username" autoComplete="off" autoCapitalize="none" spellCheck={false} value={v.username} onChange={set("username")} placeholder="sara" />
        <Help>Optional. A short name to sign in with, like sara. They can also sign in with their mobile number.</Help>
      </label>
      {!ownerOnly && v.role !== "delivery" && (
        <label className="block">
          <span className="label">New password</span>
          <input className="input text-base" name="staff-new-password" type="password" autoComplete="new-password" value={v.password} onChange={set("password")} />
          <Help>Optional, at least 10 characters. Leave it empty to keep the current one. They can always sign in with a texted code instead.</Help>
        </label>
      )}
      {!ownerOnly && (
        <label className="block">
          <span className="label">Google email</span>
          <input className="input text-base" name="staff-google" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={v.googleEmail} onChange={set("googleEmail")} placeholder="name@gmail.com" />
          <Help>Optional. The Google account that may sign in as this person with the &ldquo;Sign in with Google&rdquo; button. Leave it empty for none.</Help>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn-dark min-h-12 px-6 text-base" data-staff-save>{pending ? "Saving..." : saveLabel}</button>
        <button type="button" className="btn-ghost min-h-12 px-6 text-base" onClick={onCancel}>Cancel</button>
      </div>
      <div className="sm:col-span-2"><Msg m={msg} /></div>
    </form>
  );
}

export function SimpleStaff({ rows, ownerUsername, ownerHasRow }: { rows: StaffRow[]; ownerUsername: string; ownerHasRow: boolean }) {
  const [open, setOpen] = useState<number | "new" | "owner" | null>(null);
  const [msg, setMsg] = useState<StaffResult | null>(null);
  const [pending, go] = useTransition();
  return (
    <div className="space-y-4" data-simple-staff>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-muted">Tap Edit to change a person. Accounts are never deleted: Deactivate signs them out and keeps their history.</p>
        <button type="button" className="btn-dark min-h-12 px-6 text-base" data-add-staff onClick={() => { setOpen(open === "new" ? null : "new"); setMsg(null); }}>Add staff member</button>
      </div>
      {open === "new" && (
        <StaffForm
          start={{ name: "", phone: "", role: "secretary", username: "", password: "", googleEmail: "" }}
          saveLabel="Add staff member"
          onCancel={() => setOpen(null)}
          onSave={async (v) => {
            const r = await createStaffAction({ name: v.name, phone: v.phone, role: v.role, username: v.username, password: v.password, googleEmail: v.googleEmail });
            if (r.ok) setOpen(null);
            setMsg(r);
            return r;
          }}
        />
      )}
      <Msg m={msg} />
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white" data-staff-list>
        {!ownerHasRow && (
          <li className="p-4" data-staff-row="owner">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-base"><b>You</b> · Owner{ownerUsername ? ` · username ${ownerUsername}` : ""}</div>
              <button type="button" className="btn-ghost min-h-12 px-6 text-base" data-staff-edit="owner" onClick={() => setOpen(open === "owner" ? null : "owner")}>Edit</button>
            </div>
            {open === "owner" && (
              <StaffForm
                ownerOnly
                start={{ name: "", phone: "", role: "owner", username: ownerUsername, password: "", googleEmail: "" }}
                saveLabel="Save"
                onCancel={() => setOpen(null)}
                onSave={(v) => setOwnerUsernameAction(v.username)}
              />
            )}
          </li>
        )}
        {rows.map((u) => (
          <li key={u.id} className="p-4" data-staff-row={u.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-base">
                <b>{u.name}</b>{u.isSelf ? " (you)" : ""} · {ROLE_NAME[u.role]} · {u.phoneShown}
                {!u.active && <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-sm">Deactivated</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost min-h-12 px-6 text-base" data-staff-edit={u.id} onClick={() => { setOpen(open === u.id ? null : u.id); setMsg(null); }}>Edit</button>
                {!u.isSelf && (
                  <button
                    type="button"
                    className={`min-h-12 px-6 text-base ${u.active ? "btn-ghost !text-[#b3261e]" : "btn-dark"}`}
                    data-staff-active={u.id}
                    onClick={() => {
                      if (u.active && !window.confirm(`Are you sure? ${u.name} will be signed out everywhere and cannot sign in until you reactivate them. Their history is kept.`)) return;
                      go(async () => setMsg(await setActiveAction(u.id, !u.active)));
                    }}
                  >
                    {pending ? "Working..." : u.active ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </div>
            </div>
            {open === u.id && (
              <StaffForm
                start={{ name: u.name, phone: u.phoneShown, role: u.role, username: u.username ?? "", password: "", googleEmail: u.googleEmail ?? "" }}
                saveLabel="Save"
                onCancel={() => setOpen(null)}
                onSave={(v) => saveStaffAction(u.id, v)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

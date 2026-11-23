"use client";

import { useRef, useState, useTransition } from "react";
import { addDirectoryNameAction, lookupDirectoryPhoneAction, removeDirectoryNameAction } from "./actions";

type Added = { id: number; text: string };
const SAVED = "bg-[#E3F8EF] text-[#13895C]";
const FAILED = "bg-[#ffe6e4] text-[#b3261e]";

/** Owner only (Abraham, Nov 23, 2026): Add a name, one entry at a time, into the same directory. */
export default function AddNameForm({ streets, zips, added }: { streets: string[]; zips: { zip: string; town: string }[]; added: Added[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [shared, setShared] = useState<string[] | null>(null);
  const [town, setTown] = useState(zips[0]?.town ?? "Monroe");
  const [zip, setZip] = useState(zips[0]?.zip ?? "10950");
  const [look, setLook] = useState("");
  const [found, setFound] = useState<{ ok: boolean; lines: string[]; message?: string } | null>(null);

  const save = (allowShared: boolean) => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    setResult(null);
    start(async () => {
      const r = await addDirectoryNameAction(fd, allowShared).catch(() => ({ ok: false, message: "", sharedWith: undefined }));
      if (r.sharedWith?.length) return setShared(r.sharedWith);
      setShared(null);
      if (r.ok) {
        formRef.current?.reset();
        setResult({ ok: true, text: "Saved" });
      } else setResult({ ok: false, text: r.message ? `Not saved. ${r.message}` : "Not saved. Please try again." });
    });
  };

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        className="card space-y-3 p-4"
        data-add-name-form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <h2 className="text-lg font-black">Add a name</h2>
        <p className="text-sm text-muted">One entry at a time, into the same directory. The phone lookup finds it right away.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">Last name<input name="lastName" required maxLength={80} className="input mt-1 w-full" /></label>
          <label className="text-sm font-bold">First name<input name="firstName" required maxLength={80} className="input mt-1 w-full" /></label>
          <label className="text-sm font-bold">Phone (10 digits, optional)<input name="phone" inputMode="tel" maxLength={14} placeholder="845 555 0123" className="input mt-1 w-full" /></label>
          <label className="text-sm font-bold">House number<input name="house" required maxLength={12} className="input mt-1 w-full" /></label>
          <label className="text-sm font-bold">
            Street
            <input name="street" required list="directory-streets" placeholder="Start typing, then pick" className="input mt-1 w-full" />
            <datalist id="directory-streets">{streets.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="text-sm font-bold">Unit (optional)<input name="unit" maxLength={12} className="input mt-1 w-full" /></label>
          <label className="text-sm font-bold">Town<input name="town" required value={town} onChange={(e) => setTown(e.target.value)} maxLength={60} className="input mt-1 w-full" /></label>
          <label className="text-sm font-bold">
            Zip
            <select
              name="zip"
              value={zip}
              onChange={(e) => {
                setZip(e.target.value);
                const t = zips.find((z) => z.zip === e.target.value)?.town;
                if (t) setTown(t);
              }}
              className="input mt-1 w-full"
            >
              {zips.map((z) => <option key={z.zip} value={z.zip}>{z.zip} ({z.town})</option>)}
            </select>
          </label>
        </div>
        {shared && (
          <div role="alert" className="space-y-2 rounded-lg bg-[#FFF6D6] p-3 text-sm" data-shared-warning>
            <p className="font-bold">This phone number is already in the directory:</p>
            <ul className="ml-5 list-disc">{shared.map((s) => <li key={s}>{s}</li>)}</ul>
            <p>If you save, the number becomes a shared number, and every order from it alerts you the same way as the other shared numbers.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-dark" disabled={pending} onClick={() => save(true)} data-save-shared>Save anyway</button>
              <button type="button" className="btn" onClick={() => setShared(null)}>Cancel</button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save the name"}</button>
          {result && (
            <span role="status" data-save-result={result.ok ? "saved" : "failed"} className={`rounded-lg px-2 py-1 text-sm font-bold ${result.ok ? SAVED : FAILED}`}>{result.text}</span>
          )}
        </div>
      </form>

      <div className="card space-y-3 p-4">
        <h2 className="text-lg font-black">Look up a phone number</h2>
        <p className="text-sm text-muted">The same lookup the phone line uses.</p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await lookupDirectoryPhoneAction(look).catch(() => ({ ok: false, message: "Please try again." }));
              setFound({ ok: r.ok, lines: ("found" in r && r.found) || [], message: r.message });
            });
          }}
        >
          <input value={look} onChange={(e) => setLook(e.target.value)} inputMode="tel" placeholder="845 555 0123" className="input max-w-xs" data-lookup-phone />
          <button className="btn-dark" disabled={pending}>Look up</button>
        </form>
        {found && (
          <div className="text-sm" data-lookup-result>
            {!found.ok ? <p className={`rounded-lg p-2 font-bold ${FAILED}`}>{found.message}</p> : found.lines.length ? <ul className="ml-5 list-disc">{found.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>Not in the directory.</p>}
          </div>
        )}
      </div>

      {!!added.length && (
        <div className="card space-y-2 p-4" data-added-names>
          <h2 className="text-lg font-black">Added with Add a name</h2>
          <ul className="space-y-2 text-sm">
            {added.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <span>{a.text}</span>
                <RemoveButton id={a.id} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RemoveButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<boolean | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="btn text-sm"
        disabled={pending}
        data-remove-name={id}
        onClick={() => {
          if (!window.confirm("Remove this name from the directory? Are you sure?")) return;
          start(async () => setR((await removeDirectoryNameAction(id).catch(() => ({ ok: false }))).ok));
        }}
      >
        Remove
      </button>
      {r !== null && <span role="status" data-save-result={r ? "saved" : "failed"} className={`rounded-lg px-2 py-1 text-xs font-bold ${r ? SAVED : FAILED}`}>{r ? "Saved" : "Not saved. Please try again."}</span>}
    </span>
  );
}

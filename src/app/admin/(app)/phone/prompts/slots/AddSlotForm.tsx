"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordingChunkAction, startRecordingAction } from "../actions";
import { addSlotAction, addSlotsCsvAction } from "./actions";

const CHUNK = 3 * 1024 * 1024;

type Feedback = { ok: boolean; text: string } | null;
function Result({ msg }: { msg: Feedback }) {
  if (!msg) return null;
  return (
    <span role="status" data-save-result={msg.ok ? "saved" : "failed"} className={`rounded-lg px-2 py-1 text-sm font-bold ${msg.ok ? "bg-[#E3F8EF] text-[#13895C]" : "bg-[#ffe6e4] text-[#b3261e]"}`}>
      {msg.text}
    </span>
  );
}
const failed = (message?: string) => ({ ok: false, text: message ? `Not saved. ${message}` : "Not saved. Please try again." });

/**
 * Add a new slot (Abraham, Nov 23, 2026): slot name, group, exact spoken text, lookup key and where it plays; or many
 * at once from a CSV; then many recordings at once, matched to slots by file name.
 */
export default function AddSlotForm({ groups, slots }: { groups: string[]; slots: { key: string; label: string; text: string; lookup: string | null }[] }) {
  const [open, setOpen] = useState<"" | "one" | "csv" | "audio">("");
  const [msg, setMsg] = useState<Feedback>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  const tab = (k: "one" | "csv" | "audio", label: string) => (
    <button type="button" className={open === k ? "btn-dark" : "btn-ghost"} onClick={() => (setOpen(open === k ? "" : k), setMsg(null), setLines([]))} data-slot-tab={k}>
      {label}
    </button>
  );

  async function uploadMany(files: File[]) {
    const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "");
    const out: string[] = [];
    let good = 0;
    for (const f of files) {
      const n = norm(f.name);
      const slot = slots.find((s) => [s.label, s.label.replace(/^[^-]+ - /, ""), s.text, s.lookup ?? "", s.key.replace(/^[a-z]+:/, "")].some((x) => x && norm(x) === n));
      if (!slot) {
        out.push(`${f.name}: no slot with that name`);
        continue;
      }
      setMsg({ ok: true, text: `Uploading ${f.name}...` });
      const opened = await startRecordingAction(slot.key, f.name, f.size);
      if (!opened.ok || !opened.id) {
        out.push(`${f.name}: ${opened.message || "not uploaded"}`);
        continue;
      }
      let ok = true;
      const parts = Math.ceil(f.size / CHUNK);
      for (let i = 0; i < parts && ok; i++) {
        const fd = new FormData();
        fd.set("id", String(opened.id));
        fd.set("idx", String(i));
        fd.set("last", i === parts - 1 ? "1" : "0");
        fd.set("data", f.slice(i * CHUNK, (i + 1) * CHUNK));
        const r = await recordingChunkAction(fd);
        if (!r.ok) {
          ok = false;
          out.push(`${f.name}: ${r.message}`);
        }
      }
      if (ok) {
        good++;
        out.push(`${f.name}: uploaded to ${slot.label} (waiting for Use this one)`);
      }
    }
    setLines(out);
    setMsg(good === files.length ? { ok: true, text: `Saved: ${good} recordings uploaded` } : failed(`${good} of ${files.length} uploaded. See the list below.`));
    router.refresh();
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {tab("one", "Add a new slot")}
        {tab("csv", "Add many slots (CSV)")}
        {tab("audio", "Upload many recordings")}
      </div>
      {open === "one" && (
        <form
          className="card space-y-3 p-4"
          data-add-slot-form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setMsg({ ok: true, text: "Saving..." });
            start(async () => {
              const r = await addSlotAction(fd).catch(() => ({ ok: false, message: "" }));
              setMsg(r.ok ? { ok: true, text: "Saved" } : failed(r.message));
              if (r.ok) {
                form.reset();
                router.refresh();
              }
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Slot name</span>
              <input name="name" className="input" maxLength={120} placeholder="For example: Street - D A Weider Boulevard" required />
            </label>
            <label className="block">
              <span className="label">Group</span>
              <input name="group" className="input" list="slot-groups" maxLength={60} placeholder="Pick a group or type a new one" required />
              <datalist id="slot-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="label">Lookup key</span>
              <input name="lookup" className="input" maxLength={120} placeholder="Street spoken name, zip 10930, unit 301, number 25" required />
            </label>
            <label className="block">
              <span className="label">Where it plays</span>
              <input name="plays" className="input" maxLength={200} placeholder="For example: address read-back" />
            </label>
          </div>
          <label className="block">
            <span className="label">Exact spoken text (word for word, with every comma and period)</span>
            <textarea name="text" className="input min-h-[70px]" maxLength={1200} required />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-dark" disabled={pending}>
              {pending ? "Saving..." : "Save the slot"}
            </button>
            <Result msg={msg} />
          </div>
          <p className="text-xs text-muted">A new slot never goes live by itself: after the upload, the Owner presses Use this one. A key with no live recording is said by Puck.</p>
        </form>
      )}
      {open === "csv" && (
        <form
          className="card space-y-3 p-4"
          data-add-slots-csv
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setMsg({ ok: true, text: "Saving..." });
            start(async () => {
              const r = await addSlotsCsvAction(fd).catch(() => ({ ok: false, message: "", problems: [] }));
              setMsg(r.ok ? { ok: true, text: r.message } : failed(r.message));
              setLines((r.problems ?? []).map((p) => `Line ${p.line}: ${p.message}`));
              router.refresh();
            });
          }}
        >
          <p className="text-sm text-muted">CSV with a header row and these columns: name, group, exact text, key (and, if you like, where it plays). Each row is checked; a duplicate key is not saved.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" name="file" accept=".csv,text/csv" className="text-sm" />
            <button className="btn-dark" disabled={pending}>
              {pending ? "Saving..." : "Save the slots"}
            </button>
            <Result msg={msg} />
          </div>
        </form>
      )}
      {open === "audio" && (
        <div className="card space-y-3 p-4" data-upload-many>
          <p className="text-sm text-muted">Pick many MP3 or WAV files at once. Each file goes to the slot whose name, text or lookup key matches the file name (for example &ldquo;Acres Road.mp3&rdquo;). A slot takes a recording only after its text is confirmed, and nothing plays until the Owner presses Use this one.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" multiple accept=".mp3,.wav,audio/mpeg,audio/wav" className="text-sm" onChange={(e) => e.target.files?.length && start(() => uploadMany([...e.target.files!]))} />
            <Result msg={msg} />
          </div>
        </div>
      )}
      {!!lines.length && (
        <ul className="card ml-0 list-disc space-y-1 p-4 pl-8 text-sm" data-upload-results>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

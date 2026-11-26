import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { KIND_HELP, KIND_LABEL, libraryReconciliation, recordingLibrary, type LibraryKind } from "@/lib/recording-library";

export const metadata = { title: "Recording library | Hup Up Attractions" };
export const dynamic = "force-dynamic";

/**
 * Recording library (Admin handoff Phase 3, section 7, Nov 26, 2026), Owner only: every phone line in the code, how it
 * is recorded, which screens play it, and whether anything plays it now. Recordings are uploaded and approved on
 * Hotline prompts (unchanged); this page is the map. Nothing here deletes a recording.
 */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const kind = (Object.keys(KIND_LABEL) as LibraryKind[]).find((k) => k === sp.kind);
  const r = libraryReconciliation();
  const list = recordingLibrary().filter((e) => (!kind || e.kind === kind) && (!q || `${e.key} ${e.label} ${e.text} ${e.screens.join(" ")}`.toLowerCase().includes(q)));
  return (
    <div className="w-full" data-recording-library>
      <h1 className="text-2xl font-black sm:text-3xl">Recording library</h1>
      <p className="mb-4 mt-1 text-muted">
        Every line the phone can say, how it is recorded, which screens play it, and whether anything plays it now. To upload or change a recording, or change a line&rsquo;s
        words, use Hotline prompts (the Edit link); new words still need your approval before callers hear them. Old recordings are never deleted.
      </p>
      <section className="card mb-5 p-5" data-library-counts>
        <h2 className="mb-2 text-lg font-black">The counts add up</h2>
        <p className="text-sm text-muted">
          {r.lines} lines are in the code. Hotline prompts has {r.adminSlots} recording slots: {r.lineSlots} belong to these lines (whole lines and their pieces), and {r.otherSlots} are
          the shared number, word, letter, zip code and rental type clips. Slots in Admin that belong to no line: {r.notInLibrary.length === 0 ? "none" : r.notInLibrary.join(", ")}.
        </p>
        <ul className="mt-3 grid gap-1 text-sm">
          {(Object.keys(KIND_LABEL) as LibraryKind[]).map((k) => (
            <li key={k}>
              <Link className="font-semibold text-navy underline" href={{ pathname: "/admin/phone/library", query: { kind: k } }}>{KIND_LABEL[k]}: {r.byKind[k]}</Link>
              <span className="text-muted"> — {KIND_HELP[k]}</span>
            </li>
          ))}
          <li>
            <span className="font-semibold">Not played by anything now (kept): {r.unused.length}</span>
            <span className="text-muted"> — {r.unused.join(", ") || "none"}. They stay in Admin with their recordings until you decide.</span>
          </li>
        </ul>
      </section>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q ?? ""} className="input max-w-md" placeholder="Search the words, a name or a screen" />
        {kind && <input type="hidden" name="kind" value={kind} />}
        <button className="btn-dark">Search</button>
        {(kind || q) && <Link className="self-center text-sm text-navy underline" href="/admin/phone/library">Show all</Link>}
      </form>
      <p className="mb-2 text-sm text-muted">{list.length} lines shown.</p>
      <ul className="grid gap-2">
        {list.map((e) => (
          <li key={e.key} className="rounded-xl border border-line p-3" data-library-line={e.key}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-bold">{e.label}</span>
              <span className="rounded-full bg-bg px-2 text-xs font-bold text-muted">{KIND_LABEL[e.kind]}</span>
              {e.unused && <span className="rounded-full bg-[#FFF8E1] px-2 text-xs font-bold text-[#5C4600]">Not played now</span>}
            </div>
            <p className="text-sm">&ldquo;{e.text}&rdquo;</p>
            <p className="text-xs text-muted">
              Name: {e.key} · Group: {e.group}
              {e.slotKeys.length > 1 ? ` · ${e.slotKeys.length} recording pieces` : ""}
              {e.screens.length ? " · Screens: " : " · Not on a key screen"}
              {e.screens.map((s, i) => (
                <span key={s}>
                  {i ? ", " : ""}
                  <Link className="text-navy underline" href={`/admin/phone/screens/${encodeURIComponent(s)}`}>{s}</Link>
                </span>
              ))}
            </p>
            {e.kind !== "voice" && <Link className="text-xs font-semibold text-navy underline" href={{ pathname: "/admin/phone/prompts", query: { q: e.key } }}>Edit in Hotline prompts</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

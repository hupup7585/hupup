import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { PROMPTS, loadPromptOverrides, promptArea, promptRecordable, type PromptDef, type PromptKey } from "@/lib/ivr/prompts";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { promptRecordingLink } from "@/lib/signed-link";
import { googleTtsReady, recordingsByKey } from "@/lib/prompt-recordings";
import { allVersions } from "@/lib/prompt-versions";
import { lineStatus } from "@/lib/prompt-status";
import { inboxWhen } from "@/lib/inbox-format";
import PromptEditor, { type RecordingView } from "./PromptEditor";
import VoiceSamples from "./VoiceSamples";
import { VOICE_SAMPLE_TEXT, voiceSamples } from "@/lib/voice-samples";

export const metadata = { title: "Hotline prompts · Hup Up Attractions" };
export const dynamic = "force-dynamic";

/** The order of the extension filter (anything new falls into "Other" automatically). */
const AREA_ORDER = [
  "Main menu",
  "Key 1: Bookings",
  "Key 2: Instructions",
  "Key 4: Learn about our rentals",
  "Keys 0, 3, 5, 6 and Schools: ringing staff",
  "Key 8: Catalog",
  "Voicemail (every box) and Key 9",
  "Wrong key, hold and timeouts",
  "Texts and emails",
  "Other",
];

/**
 * Every line the phone system says, and every text and email it sends (Abraham, Nov 13, 2026). Owner only. Lines come
 * straight from the prompt list, so any new line appears here automatically.
 */
export default async function PromptsPage({ searchParams }: { searchParams: Promise<{ area?: string; q?: string }> }) {
  await requireOwner();
  const { area, q } = await searchParams;
  const [rows, overrides, recs, versions, users] = await Promise.all([
    db.select().from(schema.voicePrompts),
    loadPromptOverrides(),
    recordingsByKey(),
    allVersions(),
    db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name }).from(schema.adminUsers),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const who = (id: number | null | undefined) => (id ? (users.find((u) => u.id === id)?.name ?? "Staff") : "Owner");
  const ttsReady = googleTtsReady();
  const view = (r: { id: number; source: string; fileName: string; createdAt: Date; wording: string | null }): RecordingView => ({
    id: r.id,
    source: r.source as "upload" | "google",
    fileName: r.fileName,
    createdAt: inboxWhen(r.createdAt),
    wording: r.wording,
    src: promptRecordingLink(r.id),
  });
  const term = q?.trim().toLowerCase() ?? "";
  const lines = (Object.entries(PROMPTS) as [PromptKey, PromptDef][])
    .map(([key, def]) => {
      const row = byKey.get(key);
      const live = row?.text?.trim() || def.text;
      const mine = versions.filter((v) => v.promptKey === key);
      const draft = mine.find((v) => v.status === "draft") ?? null;
      const liveV = mine.find((v) => v.status === "live");
      const changed = liveV
        ? { when: inboxWhen(liveV.approvedAt ?? liveV.createdAt), by: who(liveV.approvedBy ?? liveV.createdBy) }
        : row?.text
          ? { when: inboxWhen(row.updatedAt), by: who(row.updatedBy) }
          : null;
      return { key, def, area: promptArea(def.group), live, draft, mine, changed, st: lineStatus(key, overrides), row };
    })
    .filter((l) => (!area || l.area === area) && (!term || `${l.def.label} ${l.live} ${l.draft?.text ?? ""} ${l.key}`.toLowerCase().includes(term)));
  const areas = AREA_ORDER.filter((a) => a !== "Other" || Object.values(PROMPTS).some((d) => promptArea((d as PromptDef).group) === "Other"));
  const samples = (await voiceSamples()).map((x) => ({ voice: x.voice, fileName: x.fileName, src: x.recording ? promptRecordingLink(x.recording.id) : null }));
  const waiting = lines.filter((l) => l.draft || l.st.status === "Waiting for approval").length;
  const link = (a?: string) => `/admin/phone/prompts${a || term ? `?${new URLSearchParams({ ...(a ? { area: a } : {}), ...(term ? { q: term } : {}) })}` : ""}`;
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-black sm:text-3xl">Hotline prompts</h1>
      <p className="mb-3 mt-1 text-muted">
        Every line the phone system says, and every text and email it sends. Voice: <b className="text-navy">{config.voice().replace(/^Google\./, "")}</b>. Edit saves a
        draft waiting for your approval; the live line keeps playing until you approve it. Every version is kept.
      </p>
      <form action="/admin/phone/prompts" className="card mb-3 flex flex-wrap gap-2 p-3" data-prompt-search>
        {area && <input type="hidden" name="area" value={area} />}
        <input name="q" defaultValue={q ?? ""} className="input min-w-0 flex-1" placeholder="Search the wording" aria-label="Search the wording" />
        <button className="btn-dark">Search</button>
      </form>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter by extension" data-prompt-filter>
        <Link href={link()} className={`rounded-full border px-3 py-1 text-sm font-semibold ${!area ? "border-navy bg-navy text-white" : "border-line bg-white"}`}>
          All
        </Link>
        {areas.map((a) => (
          <Link key={a} href={link(a)} className={`rounded-full border px-3 py-1 text-sm font-semibold ${area === a ? "border-navy bg-navy text-white" : "border-line bg-white"}`}>
            {a}
          </Link>
        ))}
      </nav>
      <p className="mb-4 text-sm text-muted">
        {lines.length} line{lines.length === 1 ? "" : "s"}
        {waiting > 0 && <> · <b className="text-coral-dark">{waiting} waiting for approval</b></>}
        . Words in {"{braces}"} change on each call (names, emails, dates, totals) and always use the live Google voice.
      </p>
      {!ttsReady && (
        <p className="card mb-5 border-l-4 border-sun p-4 text-sm">
          <b>Google voice recordings: Not active yet.</b> Play buttons and new recordings on approval need Google Text-to-Speech (a Google Cloud billing account and
          GOOGLE_TTS_API_KEY). Until then the phone speaks the same Google voice live.
        </p>
      )}
      {(!area || area === "Main menu") && !term && <VoiceSamples text={VOICE_SAMPLE_TEXT} samples={samples} ttsReady={ttsReady} liveVoice={config.voice().replace(/^Google\./, "")} />}
      {areas
        .map((a) => [a, lines.filter((l) => l.area === a)] as const)
        .filter(([, ls]) => ls.length)
        .map(([a, ls]) => (
          <section key={a} className="card mb-5 p-5" data-prompt-area={a}>
            <h2 className="mb-3 text-lg font-bold">{a}</h2>
            <div className="space-y-4">
              {ls.map((l) => {
                const all = (recs.get(l.key) ?? []).map(view);
                return (
                  <PromptEditor
                    key={l.key}
                    promptKey={l.key}
                    label={l.def.label}
                    where={l.def.group}
                    defaultText={l.def.text}
                    live={l.live}
                    vars={l.def.vars ?? []}
                    message={Boolean(l.def.message)}
                    status={l.st.status}
                    reason={l.st.reason ?? null}
                    codePending={Boolean(l.def.pending && !l.row?.approvedAt)}
                    changed={l.changed}
                    draft={l.draft ? { id: l.draft.id, text: l.draft.text, when: inboxWhen(l.draft.createdAt), by: who(l.draft.createdBy) } : null}
                    versions={l.mine
                      .filter((v) => v.status !== "draft")
                      .map((v) => ({ id: v.id, text: v.text, status: v.status, when: inboxWhen(v.approvedAt ?? v.createdAt), by: v.note === "Original wording" ? "Original" : who(v.approvedBy ?? v.createdBy), note: v.note }))}
                    recordable={promptRecordable(l.key)}
                    activeId={l.row?.recordingId ?? null}
                    uploads={all.filter((r) => r.source === "upload")}
                    google={all.find((r) => r.source === "google" && r.wording === l.live) ?? null}
                    ttsReady={ttsReady}
                  />
                );
              })}
            </div>
          </section>
        ))}
      {lines.length === 0 && <p className="card p-6 text-center text-muted">No lines match.</p>}
      <section className="card mb-5 p-5 text-sm" data-prompt-elsewhere>
        <h2 className="mb-2 text-lg font-bold">Spoken from other pages</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Rental names, categories and what the phone says for &ldquo;hear description&rdquo;: <Link className="underline" href="/admin/catalog">Catalog</Link>.
          </li>
          <li>
            Key 7 hours: read from <Link className="underline" href="/admin/holidays">Business hours &amp; holidays</Link> (the same lines as the website).
          </li>
          <li>
            Extension names, and an extension&apos;s own staff announcement if you set one: <Link className="underline" href="/admin/phone/settings">Phone settings</Link>.
          </li>
        </ul>
      </section>
    </div>
  );
}

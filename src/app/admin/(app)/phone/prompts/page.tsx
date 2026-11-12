import { requireOwner } from "@/lib/auth";
import { PROMPTS, promptRecordable, type PromptDef, type PromptKey } from "@/lib/ivr/prompts";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { promptRecordingLink } from "@/lib/signed-link";
import { googleTtsReady, recordingsByKey } from "@/lib/prompt-recordings";
import PromptEditor, { type RecordingView } from "./PromptEditor";
import VoiceSamples from "./VoiceSamples";
import { VOICE_SAMPLE_TEXT, voiceSamples } from "@/lib/voice-samples";

export const metadata = { title: "Hotline prompts · Hup Up Attractions" };
export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  await requireOwner(); // Owner only (finances, catalog, hotline prompts)
  const rows = await db.select().from(schema.voicePrompts);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const recs = await recordingsByKey();
  const ttsReady = googleTtsReady();
  const samples = (await voiceSamples()).map((x) => ({ voice: x.voice, fileName: x.fileName, src: x.recording ? promptRecordingLink(x.recording.id) : null }));
  const groups = new Map<string, { key: string; def: PromptDef }[]>();
  for (const [key, def] of Object.entries(PROMPTS) as [string, PromptDef][]) {
    groups.set(def.group, [...(groups.get(def.group) ?? []), { key, def }]);
  }
  const waiting = (Object.entries(PROMPTS) as [string, PromptDef][]).filter(([k, d]) => d.pending && !byKey.get(k)?.approvedAt).length;
  const view = (r: { id: number; source: string; fileName: string; createdAt: Date; wording: string | null }): RecordingView => ({
    id: r.id,
    source: r.source as "upload" | "google",
    fileName: r.fileName,
    createdAt: r.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
    wording: r.wording,
    src: promptRecordingLink(r.id),
  });
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-black sm:text-3xl">Hotline prompts</h1>
      <p className="mb-2 mt-1 text-muted">
        Everything the phone line says. Google voice: <b className="text-navy">{config.voice().replace(/^Google\./, "")}</b>. Each line plays the Google voice until
        you upload your own recording (MP3 or WAV). Your upload replaces the Google voice on that line right away; <b>Use Google voice</b> switches back. Old
        recordings are kept, never deleted.
      </p>
      <p className="mb-6 text-sm text-muted">
        Lines with changing parts (names, emails, dates, cart totals) always stay live Google voice. Words in {"{curly braces}"} are filled in automatically.
        {waiting > 0 && (
          <>
            {" "}
            <b className="text-coral-dark">{waiting} lines are waiting for approval</b> and never play on the phone line until you approve them.
          </>
        )}
      </p>
      {!ttsReady && (
        <p className="card mb-5 border-l-4 border-sun p-4 text-sm">
          <b>Google voice recordings: Not active yet.</b> Saving a Google voice recording needs Google Text-to-Speech, which needs a Google Cloud billing
          account and key. Until then the phone line speaks the same Google voice live, and the play button here is off.
        </p>
      )}
      <VoiceSamples text={VOICE_SAMPLE_TEXT} samples={samples} ttsReady={ttsReady} liveVoice={config.voice().replace(/^Google\./, "")} />
      {[...groups.entries()].map(([group, items]) => (
        <section key={group} className="card mb-5 p-5">
          <h2 className="mb-3 text-lg font-bold">{group}</h2>
          <div className="space-y-4">
            {items.map(({ key, def }) => {
              const row = byKey.get(key);
              const all = (recs.get(key) ?? []).map(view);
              const wording = row?.text?.trim() || def.text;
              const google = all.find((r) => r.source === "google" && r.wording === wording) ?? null;
              return (
                <PromptEditor
                  key={key}
                  promptKey={key}
                  label={def.label}
                  defaultText={def.text}
                  vars={def.vars ?? []}
                  current={row?.text ?? ""}
                  recordable={promptRecordable(key as PromptKey)}
                  waiting={Boolean(def.pending && !row?.approvedAt)}
                  activeId={row?.recordingId ?? null}
                  uploads={all.filter((r) => r.source === "upload")}
                  google={google}
                  ttsReady={ttsReady}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { promptRecordingLink } from "@/lib/signed-link";
import { STATUS_WORDS, slotsWithStatus } from "@/lib/slot-status";
import SlotRow from "./SlotRow";
import AddSlotForm from "./AddSlotForm";
import { SLOT_GROUPS, customSlotList } from "@/lib/custom-slots";
import VoiceSwitches from "./VoiceSwitches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recording text list · Hup Up Attractions", robots: { index: false } };

/**
 * Every recording slot's exact text and status (Abraham, Nov 15, 2026), one page: whole lines, pieces of lines with
 * changing parts, numbers, dates, times, letters A to Z and rental names. Owner only.
 */
export default async function SlotsPage({ searchParams }: { searchParams: Promise<{ s?: string; g?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const slots = await slotsWithStatus();
  const settings = await getSettings();
  const uploads = await db
    .select({ id: schema.promptRecordings.id, key: schema.promptRecordings.promptKey })
    .from(schema.promptRecordings)
    .where(eq(schema.promptRecordings.source, "upload"))
    .orderBy(desc(schema.promptRecordings.id));
  const latest = new Map<string, number>();
  for (const u of uploads) if (!latest.has(u.key)) latest.set(u.key, u.id);
  const count = (st: string) => slots.filter((x) => x.status === st).length;
  const shown = slots.filter((x) => (!sp.s || x.status === sp.s) && (!sp.g || x.group === sp.g));
  const groups = [...new Set(slots.map((x) => x.group))];
  const custom = new Map((await customSlotList()).map((c) => [c.key, c]));
  const allUploaded = count("uploaded") === slots.length;
  return (
    <div className="w-full">
      <Link href="/admin/phone/prompts" className="text-sm font-bold text-navy underline-offset-2 hover:underline">← Hotline prompts</Link>
      <h1 className="mb-1 mt-2 text-2xl font-black sm:text-3xl">Recording text list</h1>
      <p className="mb-4 text-muted">
        Every recording on the hotline, with its exact text. Abraham confirms each text word for word, with every comma, period and exclamation mark. Hark records it in Puck only after that, then uploads it here. A line without a recording keeps playing in the live voice (Puck).
      </p>
      <div className="mb-4 flex flex-wrap gap-2 text-sm" data-slot-counts>
        <a href="?" className="btn-ghost !py-1">All {slots.length}</a>
        {(["waiting", "confirmed", "recorded", "uploaded"] as const).map((st) => (
          <a key={st} href={`?s=${st}`} className={`btn-ghost !py-1 ${sp.s === st ? "!border-navy" : ""}`}>
            {STATUS_WORDS[st]} {count(st)}
          </a>
        ))}
      </div>
      <VoiceSwitches achird={settings.achirdWholeLine} allUploaded={allUploaded} missing={slots.length - count("uploaded")} google={settings.googleLiveVoice} googleKey={Boolean(process.env.GOOGLE_TTS_API_KEY)} />
      <AddSlotForm groups={[...new Set([...SLOT_GROUPS, ...groups])]} slots={slots.map((x) => ({ key: x.key, label: x.label, text: x.text, lookup: custom.get(x.key)?.lookup ?? null }))} />
      <form className="mb-3 flex flex-wrap items-end gap-2">
        {sp.s && <input type="hidden" name="s" value={sp.s} />}
        <label className="block"><span className="label">Group</span>
          <select name="g" defaultValue={sp.g ?? ""} className="input">
            <option value="">Every group</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <button className="btn-ghost">Show</button>
        <a className="btn-ghost" href="/admin/phone/prompts/slots/download">Download the list</a>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Slot</th><th className="th">Exact text</th><th className="th">Status</th><th className="th">Next step</th></tr></thead>
          <tbody>
            {shown.map((x) => (
              <SlotRow
                key={x.key}
                slotKey={x.key}
                label={`${x.group} · ${x.label} (${x.key})`}
                text={x.text}
                status={x.status}
                statusWords={STATUS_WORDS[x.status]}
                playing={x.playing}
                liveRecordingId={x.liveRecordingId}
                latestUpload={latest.has(x.key) ? { id: latest.get(x.key)!, url: promptRecordingLink(latest.get(x.key)!) } : null}
                custom={custom.has(x.key) ? { name: x.label, plays: custom.get(x.key)!.plays } : null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

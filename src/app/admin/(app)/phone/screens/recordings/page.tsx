import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { allSlots } from "@/lib/recording-slots";
import { customSlots } from "@/lib/custom-slots";
import { catalogItems } from "@/lib/slot-status";
import { PROMPTS, promptArea } from "@/lib/ivr/prompts";
import { promptRecordingLink } from "@/lib/signed-link";

export const metadata = { title: "Every recording | Hup Up Attractions" };
export const dynamic = "force-dynamic";

/**
 * Every recording already made (Abraham, Nov 26, 2026), by extension: the slot's exact name, the exact words it says,
 * whether it plays on the line now, and a play button. Pick any of them on a screen in Phone screens.
 */
export default async function RecordingsListPage() {
  await requireOwner();
  const recs = await db.select().from(schema.promptRecordings).where(eq(schema.promptRecordings.complete, true)).orderBy(desc(schema.promptRecordings.createdAt));
  const inUse = new Map((await db.select({ key: schema.voicePrompts.key, rec: schema.voicePrompts.recordingId }).from(schema.voicePrompts)).filter((r) => r.rec).map((r) => [r.key, r.rec!]));
  const slots = new Map(allSlots(await catalogItems(), {}, await customSlots()).map((s) => [s.key, s]));
  const groups = new Map<string, typeof recs>();
  for (const r of recs) {
    const s = slots.get(r.promptKey);
    const area = r.promptKey in PROMPTS ? promptArea((PROMPTS as Record<string, { group: string }>)[r.promptKey].group) : s?.group ?? "Other";
    groups.set(area, [...(groups.get(area) ?? []), r]);
  }
  return (
    <div className="w-full" data-recordings-list>
      <p className="mb-2 text-sm"><Link className="text-navy underline" href="/admin/phone/screens">All phone screens</Link></p>
      <h1 className="text-2xl font-black sm:text-3xl">Every recording</h1>
      <p className="mb-5 mt-1 text-muted">Every recording already made, by extension, with its exact name and the exact words it says. To use one on a screen, open the screen in Phone screens and pick it from the list.</p>
      {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([area, list]) => (
        <section key={area} className="card mb-5 p-5">
          <h2 className="mb-3 text-lg font-black">{area} <span className="text-sm font-semibold text-muted">({list.length})</span></h2>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Name</th><th className="th">Exact words</th><th className="th">File</th><th className="th">On the line</th><th className="th">Listen</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const s = slots.get(r.promptKey);
                return (
                  <tr key={r.id}>
                    <td className="td font-semibold">{s?.label ?? r.promptKey}</td>
                    <td className="td">&ldquo;{r.wording ?? s?.text ?? ""}&rdquo;</td>
                    <td className="td text-xs text-muted">{r.source === "google" ? "Google voice" : r.fileName}</td>
                    <td className="td">{inUse.get(r.promptKey) === r.id ? <b className="text-[#13895C]">Playing</b> : <span className="text-muted">Saved</span>}</td>
                    <td className="td"><audio controls preload="none" src={promptRecordingLink(r.id)} className="h-8 w-48" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      {!groups.size && <p className="card p-5 text-muted">No recordings yet.</p>}
    </div>
  );
}

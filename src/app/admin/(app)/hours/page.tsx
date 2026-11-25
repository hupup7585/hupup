import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { LINE_IDS, LINE_LABEL, effectiveLine, formatDateOverrides, formatWindows, loadHours, recordedHoursWarnings, scheduleWords, type Schedule } from "@/lib/hours-schedule";
import { addGroupAction, removeFromGroupAction, saveScheduleAction } from "./actions";

export const metadata = { title: "Hours | Hup Up Attractions" };
export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday night (after Shabbes)"];

/**
 * Hours (Abraham, Nov 25, 2026, 4:54 and 4:56 PM), Owner only: every ringing line's hours and the website / office hours in
 * one place. Saving takes effect right away for calls, key 7 and the website; no code change, no deploy.
 */
export default async function HoursPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const data = loadHours(await getSettings());
  const warnings = recordedHoursWarnings(data);
  const ungrouped = LINE_IDS.filter((id) => !data.groups.some((g) => g.members.includes(id)));
  return (
    <div className="w-full" data-hours-page>
      <h1 className="text-2xl font-black sm:text-3xl">Hours</h1>
      <p className="mb-4 mt-1 text-muted">
        When each phone line rings, and the hours on the website and main menu key 7. Type hours like 11:00-14:00, 19:30-22:00 (two windows), or Closed. Friday may end at Chatzos (11:00-Chatzos), worked out every week for Monroe, NY.
        Shabbes, Yom Tov, Purim and Tisha B&rsquo;Av are always closed, and a day you close on Business hours &amp; holidays closes every line. Outside its hours a line goes to its after-hours message and voicemail.
      </p>
      {sp.ok && <p className="mb-4 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]" role="status" data-hours-saved>Saved, live now.</p>}
      {sp.err && <p className="mb-4 rounded-xl bg-[#FFE6E4] p-3 font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}
      {warnings.map((w) => (
        <p key={w} className="mb-4 rounded-xl border-2 border-[#C83A2F] bg-[#FFE6E4] p-3 font-bold text-[#C83A2F]" data-hours-warning>{w}</p>
      ))}

      {data.groups.map((g) => (
        <section key={g.id} className="card mb-5 p-5" data-hours-group={g.id}>
          <h2 className="text-xl font-black">Group: {g.name}</h2>
          <p className="mb-2 text-sm text-muted">One schedule and one on/off switch for every line in this group.</p>
          <ul className="mb-3 grid gap-1 text-sm">
            {g.members.map((m) => (
              <li key={m} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{LINE_LABEL[m]}</span>
                <form action={removeFromGroupAction}>
                  <input type="hidden" name="group" value={g.id} />
                  <input type="hidden" name="member" value={m} />
                  <button className="text-xs font-bold text-[#C83A2F] underline">Take out of the group (keeps these hours)</button>
                </form>
              </li>
            ))}
          </ul>
          <ScheduleForm schedule={g.schedule} on={g.on} group={g.id} />
        </section>
      ))}

      {ungrouped.map((id) => {
        const e = effectiveLine(data, id);
        return (
          <section key={id} className="card mb-5 p-5" data-hours-line={id}>
            <h2 className="text-xl font-black">{LINE_LABEL[id]}</h2>
            <p className="mb-3 text-sm text-muted">Now: {scheduleWords(e.schedule) || "Closed every day"}.</p>
            <ScheduleForm schedule={e.schedule} on={e.on} line={id} />
          </section>
        );
      })}

      <section className="card mb-5 p-5" data-hours-new-group>
        <h2 className="text-xl font-black">Make a group</h2>
        <p className="mb-3 text-sm text-muted">Lines in a group share one schedule and one on/off switch: change it once and every line in the group follows. A line can be in one group only. The group starts with the first chosen line&rsquo;s hours.</p>
        <form action={addGroupAction} className="grid gap-3">
          <label className="block max-w-md">
            <span className="label">Group name</span>
            <input name="name" className="input" placeholder="e.g. Rental help" required />
          </label>
          <fieldset className="grid gap-1 sm:grid-cols-2">
            {ungrouped.map((id) => (
              <label key={id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="members" value={id} className="mt-1" /> {LINE_LABEL[id]}
              </label>
            ))}
          </fieldset>
          <button className="btn-dark w-fit">Make the group</button>
        </form>
      </section>
    </div>
  );
}

function ScheduleForm({ schedule, on, line, group }: { schedule: Schedule; on: boolean; line?: string; group?: string }) {
  return (
    <form action={saveScheduleAction} className="grid gap-4">
      {line && <input type="hidden" name="line" value={line} />}
      {group && <input type="hidden" name="group" value={group} />}
      {line !== "office" && (
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" name="on" defaultChecked={on} /> On: rings during these hours (off: never rings, callers go to the after-hours message and voicemail)
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {DAYS.map((d, i) => (
          <label key={d} className="block">
            <span className="label">{d}</span>
            <input name={`day${i}`} defaultValue={formatWindows(schedule.days[String(i) as "0"].windows)} className="input" />
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["chanukah", "cholHamoed"] as const).map((k) => (
          <fieldset key={k} className="rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{k === "chanukah" ? "Chanukah (Sunday to Thursday)" : "Chol Hamoed (Sunday to Thursday)"}</legend>
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name={`${k}Same`} defaultChecked={schedule[k].same} /> Same as the weekday
            </label>
            <input name={k} defaultValue={schedule[k].same ? "" : formatWindows(schedule[k].windows)} className="input" placeholder="Own hours, e.g. 09:00-22:30" />
          </fieldset>
        ))}
      </div>
      <label className="block">
        <span className="label">Dates with their own hours, one per line (a day off, a busy week)</span>
        <textarea name="overrides" rows={3} defaultValue={formatDateOverrides(schedule.overrides)} className="input font-mono text-sm" placeholder={"2026-12-24 closed Day off\n2026-12-28 to 2026-12-30 09:00-22:00 Busy week"} />
        <span className="mt-1 block text-xs text-muted">A date or a range (2026-12-28 to 2026-12-30), then Closed or the hours, then an optional note. These win over the weekly hours.</span>
      </label>
      <button className="btn-dark w-fit">Save</button>
    </form>
  );
}

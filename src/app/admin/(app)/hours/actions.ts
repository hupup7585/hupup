"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { LINE_IDS, addGroup, loadHours, parseDateOverrides, parseWindows, removeFromGroup, setSchedule, type HoursData, type LineId, type Schedule } from "@/lib/hours-schedule";

/** The Hours page (Abraham, Nov 25, 2026, 4:54 PM): Owner only, audited; live on the next call or page view. */
const back = (q: string) => redirect(`/admin/hours?${q}`);
const isLine = (x: string): x is LineId => (LINE_IDS as readonly string[]).includes(x);

async function store(before: HoursData, after: HoursData, userId: number | null, action: string) {
  await saveSetting("hoursSchedules", JSON.stringify(after), userId);
  await db.insert(schema.auditLog).values({ userId, action, entityType: "settings", entityId: "hours", before, after });
  revalidatePath("/", "layout"); // the website hours, and every Admin page
}

export async function saveScheduleAction(fd: FormData) {
  const owner = await requireOwner();
  const data = loadHours(await getSettings());
  const line = String(fd.get("line") ?? "");
  const group = String(fd.get("group") ?? "");
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday night"];
  const days = {} as Schedule["days"];
  // Friday closing by season (Abraham, Nov 26, 2026; every department at 14:04): a Friday may end at "Season closing".
  // Every line, the website and office hours too (Abraham, Nov 26, 2026): the website shows the time in effect, not new words
  const season = fd.get("season") === "1";
  let fridaySeason: Schedule["fridaySeason"];
  if (season) {
    const t = (k: string) => parseWindows(`00:00-${String(fd.get(k) ?? "").trim()}`)?.[0]?.to ?? null;
    const winter = t("winterClose"), summer = t("summerClose");
    if (!winter || !summer) return back(`err=${encodeURIComponent("Friday closing by season: these times are not clear. Example: 15:00 or 3 PM.")}`);
    fridaySeason = { winter, summer };
  }
  for (let d = 0; d <= 6; d++) {
    const ws = parseWindows(String(fd.get(`day${d}`) ?? ""), d === 5, d === 5 && season);
    if (!ws) return back(`err=${encodeURIComponent(`${names[d]}: these hours are not clear. Example: 11:00-14:00, 19:30-22:00${d === 5 ? (season ? " (Friday may end at Season closing: 09:30-Season closing, or Chatzos)" : " (Friday may end at Chatzos: 11:00-Chatzos)") : ""}, or Closed.`)}`);
    days[String(d) as "0"] = { closed: ws.length === 0, windows: ws };
  }
  const holiday = (k: "chanukah" | "cholHamoed", label: string) => {
    const same = fd.get(`${k}Same`) === "on";
    const ws = same ? [] : parseWindows(String(fd.get(k) ?? ""));
    return ws ? { same, windows: ws } : label;
  };
  const chanukah = holiday("chanukah", "Chanukah");
  const cholHamoed = holiday("cholHamoed", "Chol Hamoed");
  if (typeof chanukah === "string" || typeof cholHamoed === "string") return back(`err=${encodeURIComponent(`${typeof chanukah === "string" ? "Chanukah" : "Chol Hamoed"}: these hours are not clear. Example: 09:00-22:30, or tick Same as weekday.`)}`);
  const o = parseDateOverrides(String(fd.get("overrides") ?? ""));
  if (o.error) return back(`err=${encodeURIComponent(o.error)}`);
  const schedule: Schedule = { days, chanukah, cholHamoed, overrides: o.list, closedShushanPurim: fd.get("closedShushanPurim") === "on", ...(fridaySeason ? { fridaySeason } : {}) };
  const on = fd.get("on") === "on" || line === "office";
  const after = setSchedule(data, group ? { group } : isLine(line) ? { line } : {}, schedule, on);
  await store(data, after, owner.userId, "settings.hours_saved");
  back("ok=1");
}

export async function addGroupAction(fd: FormData) {
  const owner = await requireOwner();
  const data = loadHours(await getSettings());
  const members = fd.getAll("members").map(String).filter(isLine);
  const r = addGroup(data, String(fd.get("name") ?? ""), members);
  if ("error" in r) return back(`err=${encodeURIComponent(r.error)}`);
  await store(data, r, owner.userId, "settings.hours_group_added");
  back("ok=1");
}

export async function removeFromGroupAction(fd: FormData) {
  const owner = await requireOwner();
  const data = loadHours(await getSettings());
  const member = String(fd.get("member") ?? "");
  if (!isLine(member)) return back("err=Unknown line.");
  await store(data, removeFromGroup(data, String(fd.get("group") ?? ""), member), owner.userId, "settings.hours_group_removed");
  back("ok=1");
}

"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { CALENDAR_KEYS } from "./calendar-keys";



/** Owner only: save the Jewish-calendar open/closed settings. Every change is audited. */
export async function saveCalendarSettingsAction(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const owner = await requireOwner();
  const before = await getSettings();
  const bad = (values.calendarOverrides ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\d{4}-\d{2}-\d{2}\s+(open|closed)\b/i.test(l));
  if (bad.length) return { ok: false, message: `Override lines must look like "2027-01-01 closed" or "2027-04-25 open". Check: ${bad[0]}` };
  const time = /^\d{1,2}:\d{2}$/;
  const span = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
  for (const [k, re] of [["hoursMonThu", span], ["hoursSunday", span], ["hoursCholHamoed", span], ["hoursChanukah", span], ["hoursFridayOpen", time], ["hoursMotzeiCloseWinter", time], ["hoursMotzeiCloseSummer", time]] as const) {
    if (k in values && !re.test(String(values[k]).trim())) return { ok: false, message: `Check the format of ${k}: use 24-hour times like 10:30 or 10:30-19:00.` };
  }
  if ("hoursMotzeiOpen" in values && !/^(tzeis(\+\d{1,3})?|\d{1,2}:\d{2})$/.test(String(values.hoursMotzeiOpen).trim())) return { ok: false, message: 'Motzei Shabbos opening: "tzeis+120" (2 hours after Shabbos), "tzeis", or a time like 20:00.' };
  const changed: Record<string, [string, string]> = {};
  for (const k of CALENDAR_KEYS) {
    if (!(k in values)) continue;
    const v = String(values[k]).trim();
    if (v !== String(before[k])) {
      await saveSetting(k, v as never, owner.userId);
      changed[k] = [String(before[k]), v];
    }
  }
  if (Object.keys(changed).length) await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.calendar_changed", entityType: "settings", after: changed });
  revalidatePath("/admin/settings");
  revalidatePath("/"); // the website's Our Hours card reads these same settings
  return { ok: true, message: Object.keys(changed).length ? "Calendar settings saved." : "No changes." };
}

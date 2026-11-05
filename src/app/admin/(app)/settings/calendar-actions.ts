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
  return { ok: true, message: Object.keys(changed).length ? "Calendar settings saved." : "No changes." };
}

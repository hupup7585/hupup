"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { CALENDAR_KEYS } from "./calendar-keys";
import { checkCalendarValues } from "@/lib/setting-rules";

/** Owner only: save the Jewish-calendar open/closed settings. Every change is audited. */
export async function saveCalendarSettingsAction(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const owner = await requireOwner();
  const before = await getSettings();
  // One set of rules with All settings (Hark's review C1, Nov 26, 2026): reopen never before nightfall, candle
  // lighting 10 to 60 minutes, the zmanim location in Orange County, Shabbes and Yom Tov closing protected
  const reason = checkCalendarValues(Object.fromEntries(Object.entries(values).filter(([k]) => (CALENDAR_KEYS as readonly string[]).includes(k)).map(([k, v]) => [k, String(v)])));
  if (reason) return { ok: false, message: `Not saved. ${reason}` };
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
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout"); // the website's Our Hours card reads these same settings (every public page)
  return { ok: true, message: Object.keys(changed).length ? "Calendar settings saved." : "No changes." };
}

"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { formatOverrides, parseOverrides, type DayOverride } from "@/lib/jewish-calendar";
import { rowFor, type HolidayRow } from "./data";
import { normalizeHours } from "./hours";

export type RowInput = { date: string; choice: "default" | "open" | "closed"; hours: string; note: string };

/** Owner: save the listed days. "Default" removes the Owner's entry; Open/Closed (with optional hours and notes) wins. */
export async function saveHolidayRowsAction(rows: RowInput[]): Promise<{ ok: boolean; message: string }> {
  const owner = await requireOwner();
  const settings = await getSettings();
  const map = parseOverrides(settings.calendarOverrides);
  for (const r of rows.slice(0, 500)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return { ok: false, message: `Check the date "${r.date}".` };
    const note = (r.note || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (r.choice === "default") {
      if (note) return { ok: false, message: `${r.date}: choose Open or Closed to keep a note.` };
      map.delete(r.date);
      continue;
    }
    let hours: string | null = null;
    if (r.choice === "open" && r.hours.trim()) {
      hours = normalizeHours(r.hours);
      if (!hours) return { ok: false, message: `${r.date}: hours should look like 10:30 AM - 10:30 PM (ending the same day).` };
    }
    const entry: DayOverride = { open: r.choice === "open", hours, note };
    map.set(r.date, entry);
  }
  const text = formatOverrides(map);
  await saveSetting("calendarOverrides", text, owner.userId);
  await db.insert(schema.auditLog).values({
    userId: owner.userId,
    action: "settings.holiday_days_updated",
    entityType: "settings",
    entityId: "calendar_overrides",
    before: { calendarOverrides: settings.calendarOverrides },
    after: { calendarOverrides: text },
  });
  revalidatePath("/admin/holidays");
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Saved. The phone system uses these right away." };
}

/** Owner: details for a day he wants to add to the list. */
export async function dayRowAction(date: string): Promise<HolidayRow | null> {
  await requireOwner();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return rowFor(date, await getSettings());
}

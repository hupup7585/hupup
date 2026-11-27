import { PROMPTS } from "@/lib/ivr/prompts";
import { getSettings } from "@/lib/settings";
import { calendarNow } from "@/lib/clock";
import { isShabbosOrYomTov, localISO } from "@/lib/jewish-calendar";

/**
 * The same-day delivery notice on the website (Abraham, Nov 27, 2026, 12:47 AM): the same words as the phone, the
 * after-hours version when customer service is closed (Admin hours). Null when no rental day is today.
 */
export async function sameDayNoticeText(eventDates: string[], at: Date = calendarNow()): Promise<string | null> {
  if (!eventDates.includes(localISO(at))) return null;
  const s = await getSettings();
  const { effectiveLine, lineOpen, loadHours } = await import("@/lib/hours-schedule");
  const hours = loadHours(s);
  const open = effectiveLine(hours, "cs").on && lineOpen(hours, "cs", at, s) && !isShabbosOrYomTov(localISO(at));
  return (open ? PROMPTS.same_day_notice_open : PROMPTS.same_day_notice_after).text;
}

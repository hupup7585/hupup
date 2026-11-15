import { bookingLock } from "@/lib/jewish-calendar";
import { getSettings } from "@/lib/settings";
import { calendarNow } from "@/lib/clock";

/**
 * The one line the public payment page shows on Shabbes or Yom Tov (Abraham, Nov 14, 2026), or null when payments are
 * open. The page never sees holiday names or zmanim, only this line.
 */
export async function paymentsClosedLine(at: Date = calendarNow()): Promise<string | null> {
  const lock = bookingLock(at, await getSettings());
  if (!lock.locked) return null;
  return lock.reason === "Yom Tov" ? "Payments open after Yom Tov." : "Payments open after Shabbes.";
}

import { bookingCutoff } from "@/lib/jewish-calendar";
import { getSettings } from "@/lib/settings";
import { calendarNow } from "@/lib/clock";

/**
 * Placeholder for the pay page's closed notice (Abraham, Nov 27, 2026: the wording is NOT approved yet; it is on
 * docs/open-decisions-for-abraham.md). Short and neutral on purpose.
 */
export const PAYMENTS_CLOSED_PLACEHOLDER = "Payments are closed at this time.";

/**
 * Payment links do not work on Shabbes and Yom Tov (Abraham, Nov 27, 2026): from the phone's Erev Shabbes / Erev Yom Tov
 * cut-off (Admin "phoneCutoffMinutes", 15 minutes before candle lighting) until the phone reopens after Shabbes / Yom
 * Tov (the same calendar and the same end time the phone uses, no extra hour). Returns the closed notice, or null when
 * payments are open. The pay page shows it instead of the card form, and the pay action refuses payment with it.
 */
export async function paymentsClosedLine(at: Date = calendarNow()): Promise<string | null> {
  const st = await getSettings();
  const cut = bookingCutoff(at, st as never, Number(st.phoneCutoffMinutes ?? 15));
  return cut.cut ? PAYMENTS_CLOSED_PLACEHOLDER : null;
}

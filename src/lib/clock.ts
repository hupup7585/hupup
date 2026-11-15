/**
 * "Now" for the Shabbos and Yom Tov lock. Always the real time on the site; the test suite pins it to a weekday
 * (tests/setup.ts) so tests never depend on the day they run.
 */
export function calendarNow(): Date {
  const pinned = process.env.HUP_CALENDAR_NOW;
  return pinned ? new Date(pinned) : new Date();
}

import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { localISO, parseOverrides } from "@/lib/jewish-calendar";
import { holidayRows } from "./data";
import HolidayTable from "./HolidayTable";

export const dynamic = "force-dynamic";

/** Owner: holidays and special days for the phone system (never shown on the public website). */
export default async function HolidaysPage() {
  await requireOwner();
  const s = await getSettings();
  const today = localISO(new Date());
  const rows = holidayRows(today, 366, s, [...parseOverrides(s.calendarOverrides).keys()]);
  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Holidays &amp; hours</h1>
      <p className="mb-5 max-w-3xl text-muted">
        Every holiday for the next 12 months, with the calendar&rsquo;s default. Choose Open or Closed, set hours, or add notes for any day; your entries
        override the calendar for the phone system (live person and hours). Booking by phone stays open 24/7. Nothing here shows on the website.
      </p>
      <HolidayTable initial={rows} />
    </div>
  );
}

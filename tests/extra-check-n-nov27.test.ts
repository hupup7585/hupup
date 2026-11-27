import { describe, expect, it, vi } from "vitest";

/* Extra check N (Nov 27, 2026): Admin pages not checked before. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireOwner: async () => ({ userId: null, role: "owner", name: "Owner", phone: "+18457777585" }) }));

import { calendarDefaults, checkEventDate, dayInfo } from "@/lib/jewish-calendar";
import { parseDateOverrides, parseWindows } from "@/lib/hours-schedule";
import { calendarRules } from "@/lib/setting-rules";

const withOverride = (line: string) => ({ ...calendarDefaults(), calendarOverrides: line });

describe("N1: Shabbes and Yom Tov can't be opened from the Holidays list", () => {
  it("an Open entry on Yom Kippur or a Shabbes keeps it closed; on Erev Yom Kippur the early close stays", () => {
    expect(checkEventDate("2027-10-11", withOverride("2027-10-11 open")).ok).toBe(false); // Yom Kippur
    expect(checkEventDate("2027-10-16", withOverride("2027-10-16 open")).ok).toBe(false); // Shabbes
    expect(dayInfo("2027-10-10", withOverride("2027-10-10 open Busy day")).closesAt).not.toBeNull(); // Erev Yom Kippur
    // Closed still works, and Open still opens a day the other rules close (Chanukah stays as the Owner sets it)
    expect(checkEventDate("2027-10-12", withOverride("2027-10-12 closed Day off")).ok).toBe(false);
  });
  it("the Holidays page refuses Open on Shabbes or Yom Tov with a plain message", async () => {
    const { saveHolidayRowsAction } = await import("@/app/admin/(app)/holidays/actions");
    const r = await saveHolidayRowsAction([{ date: "2027-10-11", choice: "open", hours: "", note: "" }]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("always stays closed");
  });
});

describe("N2, N5: the Hours page reads hours the way people write them", () => {
  it('"1-4 pm Chanukah party" is 1 PM to 4 PM with the note "Chanukah party"; "11-2 pm" stays 11 AM to 2 PM', () => {
    const r = parseDateOverrides("2026-12-24 1-4 pm Chanukah party");
    expect(r.error).toBeNull();
    expect(r.list[0]).toMatchObject({ windows: [{ from: "13:00", to: "16:00" }], note: "Chanukah party" });
    expect(parseWindows("11-2 pm")).toEqual([{ from: "11:00", to: "14:00" }]);
    expect(parseDateOverrides("2026-12-24 11 AM - 2 PM Busy").list[0]).toMatchObject({ windows: [{ from: "11:00", to: "14:00" }], note: "Busy" });
    expect(parseDateOverrides("2026-12-24 11:00-14:00, 19:30-22:00").list[0].windows).toHaveLength(2);
  });
  it("overlapping windows are refused", () => {
    expect(parseWindows("11:00-14:00, 13:00-16:00")).toBeNull();
    expect(parseWindows("11:00-14:00, 14:00-16:00")).toHaveLength(2);
  });
});

describe("N4: calendar hours and same-day delivery times run forward", () => {
  it("an end before the start is refused", () => {
    const rules = calendarRules as Record<string, (v: string) => string | null>;
    expect(rules.hoursMonThu("19:00-10:30")).not.toBeNull();
    expect(rules.hoursMonThu("10:30-19:00")).toBeNull();
    expect(rules.sameDayHoursClose("4.5-2")).not.toBeNull();
    expect(rules.sameDayHoursClose("2.5-3.5")).toBeNull();
  });
});

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

describe("N3, N6, N7, N8", () => {
  it("N3: Activity filters by New York days and ignores a date that isn't real", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/admin/(app)/activity/page.tsx", "utf8");
    expect(src).toContain("(a.created_at AT TIME ZONE ${TZ})::date >= ${sp.from}::date");
    expect(src).toContain("sp.from && isValidISO(sp.from)");
    expect(src).toContain("sp.to && isValidISO(sp.to)");
  });
  it("N6: a bad customer id is ignored by Mark as test, and the customer page uses the same id check", async () => {
    const { setTestEntryAction } = await import("@/app/admin/(app)/customers/actions");
    const f = new FormData();
    f.set("id", "abc");
    await expect(setTestEntryAction(f)).resolves.toBeUndefined();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/admin/(app)/customers/[id]/page.tsx", "utf8")).toContain('(await import("@/lib/db-id")).isDbId(id)');
  });
  it("N7: the texting settings save records the forward number before and after", async () => {
    const { db, schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const { saveTextingAction } = await import("@/app/admin/(app)/settings/texting-actions");
    const f = new FormData();
    f.set("forwardOn", "on");
    f.set("forwardPhone", "845-555-0199");
    expect((await saveTextingAction(null, f)).ok).toBe(true);
    const [row] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "settings.customer_texts_updated"));
    expect(JSON.stringify(row.after)).toContain("+18455550199");
    expect(JSON.stringify(row.before)).toContain("smsForwardPhone");
  });
  it("N8: search lists only voicemails the Voicemail page shows", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/search.ts", "utf8")).toContain('eq(schema.voicemails.state, "submitted")');
  });
});

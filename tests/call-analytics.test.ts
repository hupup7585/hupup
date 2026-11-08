import { describe, expect, it, vi } from "vitest";

/* Dashboard call analytics (Abraham's priority 7), on a throwaway in-memory database with made-up calls. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { callAnalytics } from "@/lib/call-analytics";

const NOW = new Date("2026-11-08T20:00:00Z"); // Sunday 3:00 PM in New York
const at = (iso: string) => new Date(iso);

describe("call analytics", () => {
  it("counts calls, outcomes, menu keys, length and the busiest hour (New York time)", async () => {
    const rows: (typeof schema.callSessions.$inferInsert)[] = [
      // today (Nov 8, New York)
      { callSid: "CA1", outcome: "checked_out", startedAt: at("2026-11-08T15:00:00Z"), endedAt: at("2026-11-08T15:04:00Z"), data: { menuKeys: ["1"] } },
      { callSid: "CA2", outcome: "forwarded", startedAt: at("2026-11-08T15:30:00Z"), endedAt: at("2026-11-08T15:32:00Z"), data: { menuKeys: ["8"] } },
      { callSid: "CA3", outcome: "browsing", startedAt: at("2026-11-08T19:10:00Z"), endedAt: at("2026-11-08T19:11:00Z"), data: {} }, // hung up in the menu
      // Nov 7 at 9 PM New York = Nov 8 02:00 UTC: still Nov 7 locally
      { callSid: "CA4", outcome: "voicemail", startedAt: at("2026-11-08T02:00:00Z"), endedAt: at("2026-11-08T02:02:00Z"), data: { menuKeys: ["*", "9"] } },
      { callSid: "CA5", outcome: "dropped", startedAt: at("2026-11-05T16:00:00Z"), endedAt: at("2026-11-05T16:06:00Z"), data: { menuKeys: ["1", "1"] } },
      // outside a 7-day window
      { callSid: "CA6", outcome: "checked_out", startedAt: at("2026-10-20T16:00:00Z"), endedAt: at("2026-10-20T16:01:00Z"), data: { menuKeys: ["1"] } },
    ];
    await db.insert(schema.callSessions).values(rows);

    const week = await callAnalytics(7, NOW);
    expect(week.total).toBe(5);
    expect(week.today).toBe(3);
    expect(week.outcomes).toEqual({ booked: 1, toStaff: 1, voicemail: 1, abandonedCart: 1, noChoice: 1 });
    expect(week.keys).toEqual({ "1": 2, "8": 1, "*": 1, "9": 1 }); // a key pressed twice on one call counts once
    expect(week.avgSeconds).toBe(Math.round((240 + 120 + 60 + 120 + 360) / 5));
    expect(week.busiestHour).toEqual({ hour: 10, calls: 2 }); // 15:00 and 15:30 UTC = 10 AM New York
    expect(week.byDay).toHaveLength(7);
    expect(week.byDay.at(-1)).toEqual({ day: "2026-11-08", calls: 3 });
    expect(week.byDay.find((d) => d.day === "2026-11-07")).toEqual({ day: "2026-11-07", calls: 1 });
    expect(week.byDay.find((d) => d.day === "2026-11-06")).toEqual({ day: "2026-11-06", calls: 0 });

    const month = await callAnalytics(30, NOW);
    expect(month.total).toBe(6);
    expect(month.keys["1"]).toBe(3);
  });

  it("no calls: zeros, no average, no busiest hour", async () => {
    const empty = await callAnalytics(7, new Date("2030-01-01T12:00:00Z"));
    expect(empty.total).toBe(0);
    expect(empty.avgSeconds).toBeNull();
    expect(empty.busiestHour).toBeNull();
    expect(empty.byDay.every((d) => d.calls === 0)).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

/* Pay page same-day notice: Admin's published words, the same the phone plays. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { PROMPTS } from "@/lib/ivr/prompts";
import { sameDayNoticeText } from "@/lib/same-day-notice";

// Wednesday Jan 13, 2027: 3:00 AM ET (customer service closed) and 12:00 PM ET (open by default)
const NIGHT = new Date("2027-01-13T08:00:00Z");
const NOON = new Date("2027-01-13T17:00:00Z");

describe("pay page same-day notice", () => {
  it("no rental day today: no notice", async () => {
    expect(await sameDayNoticeText(["2027-01-14"], NOON)).toBeNull();
  });
  it("uses the code's wording until Admin publishes one, by customer service hours", async () => {
    expect(await sameDayNoticeText(["2027-01-13"], NOON)).toBe(PROMPTS.same_day_notice_open.text);
    expect(await sameDayNoticeText(["2027-01-13"], NIGHT)).toBe(PROMPTS.same_day_notice_after.text);
  });
  it("follows Admin's published wording, like the phone", async () => {
    await db.insert(schema.voicePrompts).values({ key: "same_day_notice_open", text: "Published open words." });
    await db.insert(schema.voicePrompts).values({ key: "same_day_notice_after", text: "Published after-hours words." });
    expect(await sameDayNoticeText(["2027-01-13"], NOON)).toBe("Published open words.");
    expect(await sameDayNoticeText(["2027-01-13"], NIGHT)).toBe("Published after-hours words.");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/* Chanukah gets Chol Hamoed's late hours; the hotline says Abraham's approved "open late" line on those days. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async (sid: string) => ({ callSid: sid, data: {}, outcome: "browsing" }),
  getSession: async () => null,
  updateSession: async () => {},
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { hoursDefaults, lateHoursToday, officeOpenNow } from "@/lib/business-hours";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";

const S = hoursDefaults();
const at = (iso: string) => new Date(iso); // EST = UTC-5 in December
const greet = async (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  return handleVoice({ action: "incoming", query: new URLSearchParams(), body: { CallSid: "CAlate" }, callSid: "CAlate", from: "+18455550100" });
};
afterEach(() => vi.useRealTimers());

describe("Chanukah late hours (Abraham)", () => {
  it("default 10:30 AM to 10:30 PM like Chol Hamoed, editable in admin", () => {
    expect(S.hoursChanukah).toBe("10:30-22:30");
    expect(S.hoursCholHamoed).toBe("10:30-22:30");
  });
  it("weekday of Chanukah (Mon Dec 7, 2026): open until 10:30 PM", () => {
    expect(officeOpenNow(at("2026-12-08T03:00:00Z"), S)).toBe(true); // 10:00 PM
    expect(officeOpenNow(at("2026-12-08T03:31:00Z"), S)).toBe(false); // 10:31 PM
    expect(lateHoursToday(at("2026-12-08T03:00:00Z"), S)).toBe("chanukah");
  });
  it("Friday of Chanukah (Dec 11, 2026) still closes at chatzos and never says 'open late'", () => {
    expect(officeOpenNow(at("2026-12-11T18:00:00Z"), S)).toBe(false); // 1:00 PM, after chatzos
    expect(lateHoursToday(at("2026-12-11T16:00:00Z"), S)).toBeNull(); // 11:00 AM, open but early-close day
  });
  it("an ordinary Monday still closes at 7:00 PM", () => {
    expect(officeOpenNow(at("2026-11-17T00:30:00Z"), S)).toBe(false); // Mon Nov 16, 7:30 PM
    expect(lateHoursToday(at("2026-11-16T20:00:00Z"), S)).toBeNull();
  });
});

describe("hotline 'open late' lines (Abraham approved, exact)", () => {
  it("has the exact wording", () => {
    expect(PROMPTS.late_cholhamoed.text).toBe("Happy Chol Hamoed! We're open late today, and you can book anytime using this automated system.");
    expect(PROMPTS.late_chanukah.text).toBe("Happy Chanukah! We're open late today, and you can book anytime using this automated system.");
  });
  it("Chanukah weekday while open: says the Chanukah line, no closing time", async () => {
    const xml = await greet("2026-12-07T20:00:00Z"); // Mon 3:00 PM
    expect(xml).toContain("Happy Chanukah! We're open late today, and you can book anytime using this automated system.");
    expect(xml).not.toMatch(/10:30|until/);
  });
  it("Chol Hamoed while open: says the Chol Hamoed line", async () => {
    const xml = await greet("2027-04-25T18:00:00Z"); // Sun Apr 25, 2027 (Pesach IV), 2:00 PM EDT
    expect(xml).toContain("Happy Chol Hamoed! We're open late today, and you can book anytime using this automated system.");
    expect(xml).not.toContain("Happy Chanukah");
  });
  it("not on ordinary days or when closed", async () => {
    const plain = await greet("2026-11-16T20:00:00Z"); // ordinary Monday
    expect(plain).not.toMatch(/Happy Chol Hamoed|Happy Chanukah/);
    const late = await greet("2026-12-08T03:45:00Z"); // Chanukah, 10:45 PM: closed
    expect(late).not.toContain("Happy Chanukah");
    expect(late).toContain("Our office is closed right now");
  });
});

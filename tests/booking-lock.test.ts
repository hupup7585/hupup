import { describe, expect, it } from "vitest";
import { bookingLock, calendarDefaults } from "@/lib/jewish-calendar";

/* No booking on Shabbes or Yom Tov (Abraham, Nov 14, 2026): closes at candle lighting, opens at Rabbeinu Tam. */
const S = calendarDefaults();
const at = (iso: string) => new Date(iso);

describe("booking lock", () => {
  it("Friday Nov 20, 2026: open before candle lighting (sunset 4:33 PM, candles 15 minutes before), locked after", () => {
    expect(bookingLock(at("2026-11-20T21:00:00Z"), S).locked).toBe(false); // 4:00 PM
    const l = bookingLock(at("2026-11-20T21:25:00Z"), S); // 4:25 PM
    expect(l).toMatchObject({ locked: true, reason: "Shabbes" });
  });
  it("Shabbes: locked all day, open again 72 minutes after sunset", () => {
    const day = bookingLock(at("2026-11-21T17:00:00Z"), S); // Shabbes noon
    expect(day.locked).toBe(true);
    const opens = day.opensAt!;
    expect(bookingLock(new Date(opens.getTime() - 60_000), S).locked).toBe(true);
    expect(bookingLock(new Date(opens.getTime() + 60_000), S).locked).toBe(false);
  });
  it("a weekday and working holidays (Chanukah) are never locked", () => {
    expect(bookingLock(at("2026-11-17T17:00:00Z"), S).locked).toBe(false); // Tuesday
    expect(bookingLock(at("2026-12-08T17:00:00Z"), S).locked).toBe(false); // Chanukah, Tuesday
  });
  it("Yom Tov two days in a row: no opening between the days", () => {
    // Shavuos 2027: June 11 to 12 (Friday-Shabbes)
    expect(bookingLock(at("2027-06-12T02:30:00Z"), S)).toMatchObject({ locked: true }); // Friday night, between the days
  });
});

describe("the lock is used everywhere booking or paying can happen", () => {
  it("phone key 1, the payment page and its pay button, and Admin New booking (page and server)", async () => {
    const { readFileSync } = await import("node:fs");
    // Key 1 on Shabbes or Yom Tov: no separate line any more (Abraham, Nov 16, 2026); booking stays locked and the
    // caller gets the whole-hotline closed greeting (or, while it waits for approval, "not a valid selection")
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    // Abraham, Nov 26, 2026, 11:51 PM: key 1 uses the phone's booking cut-off (15 minutes before candle lighting too)
    expect(flow).toContain('const stop = await shabbesStop(ctx, vr, "key 1");');
    expect(flow).toContain("const closed = await hotlineClosed(ctx, vr, 0, { locked: true, reason: cut.reason, opensAt: cut.opensAt });");
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS).not.toHaveProperty("booking_closed_shabbos");
    expect(PROMPTS).not.toHaveProperty("booking_closed_yomtov");
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).toContain("await paymentsClosedLine()");
    expect(readFileSync("src/app/pay/[orderId]/actions.ts", "utf8")).toContain("await paymentsClosedLine()");
    const { paymentsClosedLine } = await import("@/lib/payments-closed");
    expect(await paymentsClosedLine(new Date("2026-11-21T17:00:00Z"))).toBe("Payments are closed at this time."); // placeholder (Nov 27, 2026)
    expect(await paymentsClosedLine(new Date("2026-11-17T17:00:00Z"))).toBeNull();
    expect(readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8")).toContain("Booking is closed on ${lock.reason}");
    expect(readFileSync("src/app/admin/(app)/pos/page.tsx", "utf8")).toContain("data-booking-locked");
  });
});

describe("choice A: the whole hotline is closed on Shabbes and Yom Tov (Abraham, Nov 14, 2026)", () => {
  it("closed greeting with the opening day and time, then every message to the general voicemail; live only once approved", async () => {
    const { readFileSync } = await import("node:fs");
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('return vmRecord(vr, await vmBox("9"), "closed");');
    expect(flow).toContain('if (!lock.locked || (process.env.VERCEL_ENV === "production" && promptWaiting(ctx.prompts, closedKey))) return null;');
    const { PROMPTS, fill } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.closed_shabbos_greeting.vars).toEqual(["day", "time"]);
    expect(fill(PROMPTS.closed_shabbos_greeting.text, { day: "Saturday", time: "5:51 PM" })).toContain("open again on Saturday at 5:51 PM");
  });
});

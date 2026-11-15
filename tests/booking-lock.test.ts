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
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain('sp(vr, ctx, lock.reason === "Yom Tov" ? "booking_closed_yomtov" : "booking_closed_shabbos", when);');
    const { PROMPTS, fill } = await import("@/lib/ivr/prompts");
    expect(fill(PROMPTS.booking_closed_shabbos.text, { day: "Saturday", time: "5:51 PM" })).toBe("Booking is closed on Shabbes. Please call us again after Shabbes, on Saturday at 5:51 PM.");
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).toContain("await paymentsClosedLine()");
    expect(readFileSync("src/app/pay/[orderId]/actions.ts", "utf8")).toContain("await paymentsClosedLine()");
    const { paymentsClosedLine } = await import("@/lib/payments-closed");
    expect(await paymentsClosedLine(new Date("2026-11-21T17:00:00Z"))).toBe("Payments open after Shabbes.");
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
    expect(flow).toContain('process.env.VERCEL_ENV !== "production" || !promptWaiting(ctx.prompts, closedKey)');
    const { PROMPTS, fill } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.closed_shabbos_greeting.vars).toEqual(["day", "time"]);
    expect(fill(PROMPTS.closed_shabbos_greeting.text, { day: "Saturday", time: "5:51 PM" })).toContain("open again on Saturday at 5:51 PM");
  });
});

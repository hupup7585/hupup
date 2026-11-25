import { describe, expect, it } from "vitest";
import { applyLaserPools, bookableQty, freeOnDay, lastHeldDay, type LaserPoolInfo, type UsageMap } from "@/lib/availability";

// [product, day, event, pickup, between]
function usage(entries: [number, string, number, number, number?][]): UsageMap {
  const m: UsageMap = new Map();
  for (const [pid, day, event, pickup, between] of entries) {
    const byDay = m.get(pid) ?? new Map();
    byDay.set(day, { event, pickup, between: between ?? 0, held: 0 });
    m.set(pid, byDay);
  }
  return m;
}

describe("availability (Abraham, Nov 24, 2026: the pickup day is free for a new booking)", () => {
  it("stock 1, an order on Monday: Monday 0 free, Tuesday (its pickup day) 1 free", () => {
    // Monday 11-09 event, pickup Tuesday 11-10
    const u = usage([[1, "2026-11-09", 1, 0], [1, "2026-11-10", 0, 1]]);
    expect(freeOnDay(1, u, 1, "2026-11-09")).toBe(0);
    expect(freeOnDay(1, u, 1, "2026-11-10")).toBe(1);
    expect(bookableQty(1, u, 1, "2026-11-10", "2026-11-11")).toBe(1);
    expect(bookableQty(1, u, 1, "2026-11-09", "2026-11-10")).toBe(0);
  });

  it("a one-day rental checks only its event day: a Sunday booking does not need Monday", () => {
    // something already booked Monday
    const u = usage([[1, "2026-11-09", 1, 0]]);
    expect(bookableQty(1, u, 1, "2026-11-08", "2026-11-09")).toBe(1);
  });

  it("stock 1, a Friday order picked up Sunday: Shabbes held, Sunday 1 free", () => {
    // Friday 11-13, Shabbes 11-14 (between), pickup Sunday 11-15
    const u = usage([[1, "2026-11-13", 1, 0], [1, "2026-11-14", 0, 0, 1], [1, "2026-11-15", 0, 1]]);
    expect(freeOnDay(1, u, 1, "2026-11-14")).toBe(0);
    expect(freeOnDay(1, u, 1, "2026-11-15")).toBe(1);
    expect(bookableQty(1, u, 1, "2026-11-15", "2026-11-16")).toBe(1);
    // a Thursday booking picked up Friday would not clash with the Friday order... but one picked up Sunday would
    expect(bookableQty(1, u, 1, "2026-11-12", "2026-11-13")).toBe(1);
  });

  it("Chanukah Friday rental picked up Saturday night: the unit is free for Sunday", () => {
    // Friday 12-11 event, pickup Saturday night 12-12 (the pickup day), Sunday 12-13 untouched
    const u = usage([[1, "2026-12-11", 1, 0], [1, "2026-12-12", 0, 1]]);
    expect(freeOnDay(1, u, 1, "2026-12-13")).toBe(1);
    expect(bookableQty(1, u, 1, "2026-12-13", "2026-12-14")).toBe(1);
  });

  it("two-day rental Monday and Tuesday (pickup Wednesday): Monday and Tuesday 0, Wednesday 1", () => {
    const u = usage([[1, "2026-11-09", 1, 0], [1, "2026-11-10", 0, 0, 1], [1, "2026-11-11", 0, 1]]);
    expect(freeOnDay(1, u, 1, "2026-11-09")).toBe(0);
    expect(freeOnDay(1, u, 1, "2026-11-10")).toBe(0);
    expect(freeOnDay(1, u, 1, "2026-11-11")).toBe(1);
    expect(bookableQty(1, u, 1, "2026-11-11", "2026-11-12")).toBe(1);
    expect(lastHeldDay("2026-11-09", "2026-11-11")).toBe("2026-11-10");
  });

  it("multiple units", () => {
    const u = usage([[2, "2026-11-05", 6, 0], [2, "2026-11-06", 0, 6]]);
    expect(bookableQty(8, u, 2, "2026-11-05")).toBe(2);
    expect(bookableQty(8, u, 2, "2026-11-04")).toBe(8); // its pickup day is the 5th: only the 4th is checked
    expect(bookableQty(8, u, 2, "2026-11-06")).toBe(8); // the 6th is the earlier order's pickup day
  });

  it("laser maze pool of 1: a maze rented Monday is bookable Tuesday", () => {
    const info: LaserPoolInfo = { items: new Map([[10, { quantity: 1, pools: ["maze", "six"], active: true }]]), sizes: { maze: 1, six: 6, four: 0 } };
    const u = usage([[10, "2026-11-09", 1, 0], [10, "2026-11-10", 0, 1]]);
    applyLaserPools(u, info);
    expect(bookableQty(1, u, 10, "2026-11-09", "2026-11-10")).toBe(0);
    expect(bookableQty(1, u, 10, "2026-11-10", "2026-11-11")).toBe(1);
  });

  it("never negative", () => {
    const u = usage([[3, "2026-11-05", 5, 0]]);
    expect(freeOnDay(2, u, 3, "2026-11-05")).toBe(0);
  });
});

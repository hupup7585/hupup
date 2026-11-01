import { describe, expect, it } from "vitest";
import { bookableQty, freeOnDay, type UsageMap } from "@/lib/availability";

function usage(entries: [number, string, number, number][]): UsageMap {
  const m: UsageMap = new Map();
  for (const [pid, day, event, pickup] of entries) {
    const byDay = m.get(pid) ?? new Map();
    byDay.set(day, { event, pickup, held: 0 });
    m.set(pid, byDay);
  }
  return m;
}

describe("availability", () => {
  it("unit booked on Sunday is out Sunday and Monday", () => {
    // order on 11-08 => event 11-08, pickup 11-09
    const u = usage([[1, "2026-11-08", 1, 0], [1, "2026-11-09", 0, 1]]);
    expect(freeOnDay(1, u, 1, "2026-11-08")).toBe(0);
    expect(freeOnDay(1, u, 1, "2026-11-09")).toBe(0);
    expect(freeOnDay(1, u, 1, "2026-11-10")).toBe(1);
  });

  it("booking on Saturday needs Sunday free too", () => {
    const u = usage([[1, "2026-11-08", 1, 0], [1, "2026-11-09", 0, 1]]);
    expect(bookableQty(1, u, 1, "2026-11-07")).toBe(0); // Sat event + Sun pickup clashes
    expect(bookableQty(1, u, 1, "2026-11-06")).toBe(1); // Fri event + Sat pickup is fine
    expect(bookableQty(1, u, 1, "2026-11-10")).toBe(1);
  });

  it("multiple units", () => {
    const u = usage([[2, "2026-11-05", 6, 0], [2, "2026-11-06", 0, 6]]);
    expect(bookableQty(8, u, 2, "2026-11-05")).toBe(2);
    expect(bookableQty(8, u, 2, "2026-11-04")).toBe(2);
    expect(bookableQty(8, u, 2, "2026-11-07")).toBe(8);
  });

  it("never negative", () => {
    const u = usage([[3, "2026-11-05", 5, 0]]);
    expect(freeOnDay(2, u, 3, "2026-11-05")).toBe(0);
  });
});

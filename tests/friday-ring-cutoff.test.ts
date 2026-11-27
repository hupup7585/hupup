import { describe, expect, it } from "vitest";
import { lineRingsNow } from "@/lib/ivr/routing";
import { SETTING_DEFAULTS } from "@/lib/settings";

/* Abraham, Nov 26, 2026: after-hours ringing on Friday stops at whichever comes FIRST: 3:00 PM winter / 4:00 PM
 * summer, or 90 minutes before candle lighting; never past candle lighting. */
const s = { ...SETTING_DEFAULTS, ringAfterHours6: true } as never;
const ny = (iso: string, hm: string, offset: string) => new Date(`${iso}T${hm}:00${offset}`);
const rings = (at: Date, candles: Date) => lineRingsNow("6", at, s, { officeOpen: false, shabbosOrYomTov: false, candleLighting: candles });

describe("Friday after-hours ring cut-off", () => {
  it("Nov 27, 2026 (winter): candles about 4:15 PM, so 90 minutes before (2:45 PM) comes first", () => {
    const candles = ny("2026-11-27", "16:15", "-05:00");
    expect(rings(ny("2026-11-27", "14:40", "-05:00"), candles)).toBe(true);
    expect(rings(ny("2026-11-27", "14:46", "-05:00"), candles)).toBe(false);
  });
  it("winter with late candles (5:30 PM): 3:00 PM comes first", () => {
    const candles = ny("2027-03-05", "17:30", "-05:00");
    expect(rings(ny("2027-03-05", "14:59", "-05:00"), candles)).toBe(true);
    expect(rings(ny("2027-03-05", "15:01", "-05:00"), candles)).toBe(false);
  });
  it("summer (candles about 8:10 PM): 4:00 PM comes first", () => {
    const candles = ny("2027-06-18", "20:10", "-04:00");
    expect(rings(ny("2027-06-18", "15:59", "-04:00"), candles)).toBe(true);
    expect(rings(ny("2027-06-18", "16:01", "-04:00"), candles)).toBe(false);
  });
  it("never past candle lighting", () => {
    const candles = ny("2027-06-18", "20:10", "-04:00");
    expect(rings(ny("2027-06-18", "20:11", "-04:00"), candles)).toBe(false);
  });
});

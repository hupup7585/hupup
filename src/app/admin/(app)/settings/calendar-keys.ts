import type { Settings } from "@/lib/settings";

/** Settings the Owner edits on the Jewish-calendar form. */
export const CALENDAR_KEYS = [
  "calendarEnabled",
  "erevShabbosClose",
  "erevYomTovClose",
  "candleLightingMinutes",
  "reopenAfter",
  "closeCholHamoed",
  "closeChanukah",
  "closePurim",
  "closeTishaBav",
  "closeMinorFasts",
  "closeLagBaomer",
  "calendarOverrides",
  "calendarLatitude",
  "calendarLongitude",
  "hoursMonThu",
  "hoursFridayOpen",
  "hoursSunday",
  "hoursMotzeiOpen",
  "hoursMotzeiCloseWinter",
  "hoursMotzeiCloseSummer",
  "hoursMotzeiSeason",
  "hoursCholHamoed",
  "hoursWebsiteNote",
] as const satisfies readonly (keyof Settings)[];

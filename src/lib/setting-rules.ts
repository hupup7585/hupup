/**
 * One set of checks for settings (Hark's Phase 1-2 review, Nov 26, 2026, C1 and H1): the dedicated Admin pages and
 * All settings use the same rules, so a value one page refuses can never be saved through another. Each function
 * returns a plain-English reason, or null when the value is fine.
 */
export type Rule = (v: string) => string | null;

const int = (v: string) => (/^-?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const dec = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN);

export const rules = {
  wholeBetween: (lo: number, hi: number, what = "a whole number"): Rule => (v) => {
    const n = int(v);
    return Number.isNaN(n) ? `Enter ${what}.` : n < lo || n > hi ? `Enter ${what} from ${lo} to ${hi}.` : null;
  },
  numberBetween: (lo: number, hi: number): Rule => (v) => {
    const n = dec(v);
    return Number.isNaN(n) ? "Enter a number (for example 2.9)." : n < lo || n > hi ? `Enter a number from ${lo} to ${hi}.` : null;
  },
  oneOf: (choices: readonly string[]): Rule => (v) => (choices.includes(v.trim()) ? null : `Choose one of: ${choices.join(", ")}.`),
  time: ((v) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? null : "Use a 24-hour time like 10:30 or 19:00.")) as Rule,
  timeOrBlank: ((v) => (!v.trim() || /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? null : "Use a 24-hour time like 08:00, or leave it blank.")) as Rule,
  span: ((v) => {
    const m = v.trim().match(/^(([01]?\d|2[0-3]):[0-5]\d)-(([01]?\d|2[0-3]):[0-5]\d)$/);
    if (!m) return "Use a 24-hour span like 10:30-19:00.";
    // Extra check N4: the closing time comes after the opening time (the website showed "7:00 PM to 10:30 AM")
    const mins = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
    return mins(m[3]) > mins(m[1]) ? null : "The closing time must be after the opening time, like 10:30-19:00.";
  }) as Rule,
  isoDateOrBlank: ((v) => (!v.trim() || (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(Date.parse(v.trim()))) ? null : "Use a date like 2027-01-31, or leave it blank.")) as Rule,
  centsOrBlank: ((v) => (!v.trim() || /^\d+$/.test(v.trim()) ? null : "Enter an amount in cents (for example 50000 for $500.00), or leave it blank.")) as Rule,
  centsSigned: ((v) => (/^-?\d+$/.test(v.trim()) ? null : "Enter an amount in cents (for example 1250000 for $12,500.00; a minus sign for an overdrawn account).")) as Rule,
  e164OrBlank: ((v) => (!v.trim() || /^\+1\d{10}$/.test(v.trim()) ? null : "Enter the phone number as +1 and 10 digits, for example +18454157585, or leave it blank.")) as Rule,
  e164: ((v) => (/^\+1\d{10}$/.test(v.trim()) ? null : "Enter the phone number as +1 and 10 digits, for example +18454157585.")) as Rule,
};

/* ---- Shabbes and Yom Tov (C1): never open during Shabbes or Yom Tov ---- */
export const REOPEN_MIN = 50;
export const REOPEN_MAX = 120;
export const CANDLE_MIN = 10;
export const CANDLE_MAX = 60;

export const calendarRules: Record<string, Rule> = {
  calendarEnabled: (v) => (v.trim() === "yes" ? null : "Shabbes and Yom Tov closures are protected and cannot be switched off."),
  reopenAfter: (v) => {
    const t = v.trim().toLowerCase();
    if (t === "tzeis") return null;
    const n = int(t);
    return Number.isNaN(n) || n < REOPEN_MIN || n > REOPEN_MAX ? `Reopen after Shabbes and Yom Tov: enter "tzeis" (nightfall) or whole minutes after sunset from ${REOPEN_MIN} to ${REOPEN_MAX} (72 is Rabbeinu Tam).` : null;
  },
  sameDayCutoff: (v) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? null : "Same-day bookings: a time like 15:30 (3:30 PM)."),
  sameDayCutoffErev: (v) => (v.trim().toLowerCase() === "chatzos" || /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? null : 'Same-day bookings on Friday and Erev Yom Tov: "chatzos" or a time like 11:30.'),
  // Extra check N4: the "from" hours must be fewer than the "to" hours (4.5-2 was spoken as the delivery time)
  sameDayHoursClose: (v) => (/^\d+(\.5)?-\d+(\.5)?$/.test(v.trim()) && fromBeforeTo(v) ? null : "Same-day delivery time close by: hours from-to, like 2.5-3.5 (whole or half hours, the first smaller)."),
  sameDayHoursFar: (v) => (/^\d+(\.5)?-\d+(\.5)?$/.test(v.trim()) && fromBeforeTo(v) ? null : "Same-day delivery time in the surrounding areas: hours from-to, like 3.5-4.5 (whole or half hours, the first smaller)."),
  sameDayCloseAreas: (v) => (v.length > 2000 ? "Close-by areas: keep the list under 2,000 characters." : null),
  phoneCutoffMinutes: (v) => {
    const n = int(v);
    return Number.isNaN(n) || n < 0 || n > 120 ? "Phone booking cut-off: whole minutes before candle lighting, from 0 to 120." : null;
  },
  shabbesSaveMinutes: (v) => {
    const n = int(v);
    return Number.isNaN(n) || n < 0 || n > 600 ? "Saved cart: whole minutes after Shabbes or Yom Tov ends, from 0 to 600." : null;
  },
  candleLightingMinutes: (v) => {
    const n = int(v);
    return Number.isNaN(n) || n < CANDLE_MIN || n > CANDLE_MAX ? `Candle lighting: whole minutes before sunset from ${CANDLE_MIN} to ${CANDLE_MAX}.` : null;
  },
  erevShabbosClose: rules.oneOf(["chatzos", "candles"]),
  erevYomTovClose: rules.oneOf(["chatzos", "candles"]),
  // The zmanim location stays in Orange County, New York (Monroe is 41.34, -74.17)
  calendarLatitude: (v) => (rules.numberBetween(40.9, 41.8)(v) ? "The zmanim location must stay in Orange County, New York: latitude from 40.9 to 41.8 (Monroe is 41.3407)." : null),
  calendarLongitude: (v) => (rules.numberBetween(-74.9, -73.6)(v) ? "The zmanim location must stay in Orange County, New York: longitude from -74.9 to -73.6 (Monroe is -74.1679)." : null),
  closeCholHamoed: rules.oneOf(["yes", "no"]),
  closeChanukah: rules.oneOf(["yes", "no"]),
  closePurim: rules.oneOf(["yes", "no"]),
  closeTishaBav: rules.oneOf(["yes", "no"]),
  closeMinorFasts: rules.oneOf(["yes", "no"]),
  closeLagBaomer: rules.oneOf(["yes", "no"]),
  calendarOverrides: (v) => {
    const bad = v
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^\d{4}-\d{2}-\d{2}\s+(open|closed)\b/i.test(l));
    return bad.length ? `Override lines must look like "2027-01-01 closed" or "2027-04-25 open". Check: ${bad[0]}` : null;
  },
  hoursMonThu: rules.span,
  hoursSunday: rules.span,
  hoursCholHamoed: rules.span,
  hoursChanukah: rules.span,
  hoursFridayOpen: rules.time,
  hoursMotzeiCloseWinter: rules.time,
  hoursMotzeiCloseSummer: rules.time,
  hoursMotzeiOpen: (v) => (/^(tzeis(\+\d{1,3})?|([01]?\d|2[0-3]):[0-5]\d)$/.test(v.trim()) ? null : 'Motzei Shabbes opening: "tzeis+120" (2 hours after Shabbes), "tzeis", or a time like 20:00.'),
  hoursMotzeiSeason: rules.oneOf(["dst", "winter", "summer"]),
};

/** Check every given calendar value; the first reason found, or null. */
export function checkCalendarValues(values: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(values)) {
    const r = calendarRules[k]?.(String(v));
    if (r) return r;
  }
  return null;
}

/** "2.5-3.5": the first number is smaller than the second (extra check N4). */
function fromBeforeTo(v: string): boolean {
  const [a, b] = v.trim().split("-").map(Number);
  return a < b;
}


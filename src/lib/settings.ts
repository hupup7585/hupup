import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME } from "@/lib/config";

/** Admin-editable settings with defaults. Stored in app_settings (key -> jsonb). */
export const SETTING_DEFAULTS = {
  smsForwardEnabled: true,
  smsForwardPhone: "",
  smsHelpReplyEnabled: true,
  smsHelpText: `${BUSINESS_NAME}: For help, call (845) 777-7585 or email hupupattractions@gmail.com. Msg & data rates may apply. Reply STOP to opt out.`,
  supportPhone: "",
  /* Checkout pricing (Abram's decisions; editable in admin). Lists are one place per line. */
  deliveryFeeKjCents: "1000",
  deliveryFeeAreaCents: "1500",
  /** Orange County, NY sales tax, applied to the whole order including delivery. */
  salesTaxPercent: "8.125",
  /** Kiryas Joel ($10 zone). Full list to come from Abram. */
  zoneKjPlaces: "Kiryas Joel\nKiryas Yoel\nTown of Palm Tree\nPalm Tree",
  /** Surrounding towns ($15 zone), all in Orange County. */
  zoneAreaPlaces: "Monroe\nBlooming Grove\nWoodbury\nHighland Mills\nChester\nHarriman\nMiddletown\nWashingtonville",
  /* Jewish calendar (Abraham, 2026-11-06). Diaspora; zmanim for Monroe / Kiryas Joel. Booleans as "yes"/"no". */
  calendarEnabled: "yes",
  calendarLatitude: "41.3407",
  calendarLongitude: "-74.1679",
  /** Erev Shabbos closes at: "chatzos" (halachic midday) or "candles" (candle lighting) */
  erevShabbosClose: "chatzos",
  /** Erev Yom Tov closes at: "chatzos" or "candles" (pending Abraham; default chatzos) */
  erevYomTovClose: "chatzos",
  /** Minutes before sunset for candle lighting (used only when a "candles" close is chosen) */
  candleLightingMinutes: "18",
  /** Reopen after Shabbos / Yom Tov: minutes after sunset, or "tzeis" for nightfall at 8.5 degrees */
  reopenAfter: "tzeis",
  closeCholHamoed: "no",
  closeChanukah: "no",
  closePurim: "yes",
  closeTishaBav: "yes",
  closeMinorFasts: "no",
  closeLagBaomer: "no",
  /** Owner overrides, one per line: "2027-01-01 closed" or "2027-04-25 open" (optionally followed by a note) */
  calendarOverrides: "",
  /* Office hours (walk-ins and live calls), Eastern time, "HH:MM-HH:MM" (24-hour). The automated phone system
     books 24/7 regardless. Items marked "to confirm" are Abraham's pending answers. */
  hoursMonThu: "10:30-19:00",
  /** Friday opening; closing follows the Erev Shabbos rule (chatzos) until Abraham confirms. */
  hoursFridayOpen: "10:30",
  hoursSunday: "11:30-19:00",
  /** Motzei Shabbos opening: "tzeis+120" = 2 hours after Shabbos ends (Abraham), "tzeis", or HH:MM. */
  hoursMotzeiOpen: "tzeis+120",
  hoursMotzeiCloseWinter: "23:00",
  hoursMotzeiCloseSummer: "00:00",
  /** Which Motzei Shabbos closing applies: "dst" = summer while daylight saving time is in effect (to confirm). */
  hoursMotzeiSeason: "dst",
  /** Chol Hamoed hours (opening to confirm). */
  hoursCholHamoed: "10:30-22:30",
  /** Chanukah: same late hours as Chol Hamoed (Abraham). Friday of Chanukah still closes at chatzos. */
  hoursChanukah: "10:30-22:30",
  /*
   * "Speak to someone" (hotline option 0) routing. One number per line: "Label | phone | ring seconds".
   * Empty = ring FORWARD_PHONE / ADMIN_PHONE as before. sequential = one after another; simultaneous = all at once.
   */
  operatorTargets: "",
  operatorMode: "sequential",
  /** The person answering must press 1, so a personal voicemail picking up doesn't take the call. */
  operatorAcceptPrompt: true,
  operatorAcceptText: "Call from the Hup Up Attractions hotline. To accept, press 1. To pass, press 2.",
  /*
   * Ring lists for main-menu keys 2 (equipment instructions and guidance), 4 (customer service), 5 (issues during a
   * rental), 6 (delivery and pickup) and 8 (schools, corporate events and organizations; the list key 2 had before
   * Nov 8, 2026). Same format as operatorTargets. Empty = ring the operator list (key 0).
   */
  ringTargets2: "",
  ringMode2: "sequential",
  ringAccept2: true,
  ringTargets4: "",
  ringMode4: "sequential",
  ringAccept4: true,
  ringTargets5: "",
  ringMode5: "sequential",
  ringAccept5: true,
  ringTargets6: "",
  ringMode6: "sequential",
  ringAccept6: true,
  ringTargets8: "",
  ringMode8: "sequential",
  ringAccept8: true,
  /**
   * Caller blocking (checked first on every call). One per line: pattern | note.
   * Patterns: an exact number, * for any digits (+1845*), ? for one digit (+1845555????), or "withheld".
   */
  blockedCallers: "",
  /** Stock / warehouse address: where the delivery run starts and ends (Delivery screen route links). Owner only. */
  stockAddress: "",
  /** Website note under the hours (Abraham's wording). */
  hoursWebsiteNote: "Please note that you can book at any time using our automated phone system.",
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : string };

export async function getSettings(): Promise<Settings> {
  const out = { ...SETTING_DEFAULTS } as Settings;
  try {
    const rows = await db.select().from(schema.appSettings);
    for (const r of rows) if (r.key in out) (out as Record<string, unknown>)[r.key] = r.value;
  } catch (e) {
    console.error("settings load failed, using defaults", e);
  }
  if (!out.smsForwardPhone) out.smsForwardPhone = process.env.ADMIN_PHONE || "";
  if (!out.supportPhone) out.supportPhone = process.env.TWILIO_PHONE_NUMBER || "";
  return out;
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K], userId?: number | null) {
  await db
    .insert(schema.appSettings)
    .values({ key, value, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date(), updatedBy: userId ?? null } });
}

export async function deleteSetting(key: string) {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
}

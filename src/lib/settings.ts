import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME } from "@/lib/config";
import { TIMER_DEFAULTS } from "@/lib/ivr/timers";

/** Admin-editable settings with defaults. Stored in app_settings (key -> jsonb). */
export const SETTING_DEFAULTS = {
  smsForwardEnabled: true,
  /** Voicemail text alerts also carry the MP3 as an MMS (Abraham turned it on, Nov 10, 2026; sends once Twilio texting works). */
  voicemailMms: true,
  /** Owner alerts (Abraham, Nov 9, 2026): a missed-call alert, and an email copy of every text to the hotline. */
  missedCallAlerts: true,
  incomingTextEmail: true,
  smsForwardPhone: "",
  smsHelpReplyEnabled: true,
  smsHelpText: `${BUSINESS_NAME}: For help, call (845) 777-7585 or email info@hupupattractions.com. Msg & data rates may apply. Reply STOP to opt out.`,
  supportPhone: "",
  /* Checkout pricing (Abram's decisions; editable in admin). Lists are one place per line. */
  deliveryFeeKjCents: "1000",
  /** Abraham, Nov 27, 2026, 1:06 AM: delivery is the zone price for the first item plus this for each more item */
  deliveryExtraItemCents: "500",
  /** Abraham, Nov 27, 2026, 1:20 AM: which settings and prices are spoken inside which recordings (JSON; empty = the
   *  starting list), and the slots that need a new recording because one of them changed (filled in automatically) */
  recordingLinks: "",
  recordingFlags: "[]",
  deliveryFeeAreaCents: "1500",
  /** Anywhere else in Orange County (outside every colored area on the map), Owner-editable (Abraham, Nov 17, 2026). */
  deliveryFeeOutsideCents: "2000",
  /**
   * Free delivery promo (Abraham, Nov 17, 2026), Owner only, off by default. While on (and today is within the dates,
   * Eastern time; a blank date is open-ended): Kiryas Joel free, the nearby towns $10. The $20 zone keeps its price.
   */
  deliveryPromoOn: false,
  /**
   * Laser tag: every third set half price (Abraham, Nov 25, 2026, 4:03 PM; replaces the old laser offer
   * switch). ON: every 3rd full set (maze + guns) and every 3rd extra gun set is half price, counted apart.
   */
  laserThirdSetHalfOn: true,
  /** Offers (Abraham, Nov 17, 2026), Owner on/off, all off until he switches them on. They never combine. */
  offerThuSunOn: false,
  // The Offers page intro line (Abraham, Nov 26, 2026), editable on that page
  offersIntro: "Turn each offer on or off here. Customers only get the offers that are on.",
  offerFourthSundayOn: false,
  /**
   * Catalog by text (Abraham, Nov 17, 2026): two messages, picture 1 with the catalog words, then picture 2 alone.
   * Owner uploads them in Admin, Catalog. Blank = the words only, as before.
   */
  catalogTextPicture1: "",
  // Music (Abraham, Nov 17, 2026): the songs (ids, in order) for each place; empty = no music there
  musicStaffWait: "",
  /** Abraham, Nov 27, 2026, 1:20 AM: hold music while staff are rung (staff phones then show the hotline number) */
  staffHoldMusicOn: false,
  // Email signature (Abraham, Nov 17, 2026): empty = the approved default (src/lib/email-brand.ts)
  emailSignature: "",
  // Catalog email (Abraham, Nov 17, 2026): the catalog's name (added to the subject) and attach the PDF automatically
  catalogName: "",
  // Mailing address at the bottom of promotional emails (Abraham will give it; blank until then)
  emailMailingAddress: "",
  // Catalog by text (Abraham, Nov 17, 2026, item 14): the photos in order, each with its own text (JSON list)
  catalogTextItems: "",
  // When a catalog by text was asked for but no catalog photos are in Admin (Nov 18, 2026): shown on Catalog email & text
  catalogTextMissingAt: "",
  catalogAutoAttach: true,
  // Catalog email wording, edited by the Owner (Abraham, Nov 17, 2026). Blank = the approved wording. {Catalog Name} is filled in.
  catalogEmailSubjectText: "",
  catalogEmailBodyText: "",
  musicPayConnect: "",
  /** Batch 4 (Abraham, Nov 25, 2026): two separate payment-link holds. Links sent from the phone line: 10 minutes.
   * Links staff send from Admin New booking: 25 minutes. The spoken and texted wording says these times. */
  /** Abraham, Nov 25, 2026, 12:36: household names spoken live 10 percent faster (Google speaking rate). */
  nameSpeakingRate: "1.1",
  phoneLinkHoldMinutes: "10",
  adminLinkHoldMinutes: "25",
  catalogTextPicture2: "",
  deliveryPromoStart: "",
  deliveryPromoEnd: "",
  /** Orange County, NY sales tax, applied to the whole order including delivery. */
  salesTaxPercent: "8.125",
  /** Kiryas Joel ($10 zone). Full list to come from Abram. */
  zoneKjPlaces: "Kiryas Joel\nKiryas Yoel\nTown of Palm Tree\nPalm Tree",
  /** Surrounding towns ($15 zone), all in Orange County. */
  zoneAreaPlaces: "Monroe\nBlooming Grove\nWoodbury\nHighland Mills\nChester\nHarriman\nMiddletown\nWashingtonville",
  /* Address check with two backups (Abraham, Nov 27, 2026, 2:02 AM): the rest of Orange County by town name (used only
     when no map service answers), the two free backups, and the re-check timing */
  zoneCountyPlaces:
    "Orange County\nGoshen\nNewburgh\nNew Windsor\nWarwick\nFlorida\nPort Jervis\nCornwall\nCornwall on Hudson\nMontgomery\nWalden\nMaybrook\nPine Bush\nWallkill\nGreenwood Lake\nTuxedo\nTuxedo Park\nOtisville\nWesttown\nSlate Hill\nUnionville\nPine Island\nSugar Loaf\nCampbell Hall\nCircleville\nBullville\nCuddebackville\nHuguenot\nVails Gate\nSalisbury Mills\nMountainville\nCentral Valley\nRock Tavern\nHighland Falls\nWest Point\nFort Montgomery\nSouthfields\nArden\nHamptonburgh\nCrawford\nDeerpark\nMount Hope\nMinisink\nWawayanda\nGreenville",
  geoBackupCensusOn: true,
  geoBackupOsmOn: true,
  addressRecheckEarlyMinutes: "15",
  addressRecheckEarlyForMinutes: "60",
  addressRecheckLaterMinutes: "60",
  /* Jewish calendar (Abraham, 2026-11-06). Diaspora; zmanim for Monroe / Kiryas Joel. Booleans as "yes"/"no". */
  /* Sola PhonePay (Abraham, Nov 14, 2026): card by phone through Sola's free PhonePay line. Off; Owner test first. */
  /** The Owner's sign-in username (Abraham, Nov 14, 2026); staff usernames live on their accounts */
  ownerUsername: "",
  solaPhonePayOn: true, // Abraham, Nov 18, 2026: passed the test; on for every caller
  // Card payment by phone limits (Abraham, Nov 17, 2026): tries per call, and declines per caller phone in 24 hours
  phonePayTriesPerCall: "3",
  phonePayDeclinesPerDay: "5",
  // Abraham, Nov 18, 2026: up to 5 calls with card tries per caller number in 24 hours (replaces 5 declines)
  phonePayCallsPerDay: "5",
  // Chanukah and Chol Hamoed rentals (Abraham, Nov 18, 2026, approved): one price per booking day, picked up the next
  // morning; Friday is one full day, picked up 1 hour after Shabbes; no promos, discounts or offers those weeks.
  holidayPerDayChanukah: true,
  holidayPerDayCholHamoed: true,
  holidayNoPromos: true,
  holidayPickupAfterShabbesMin: "60",
  holidayMutzeDeliveryAfterMin: "120", // Abraham, Nov 22, 2026: about two hours after Shabbes, everywhere
  holidaySundayPickup: "09:00",
  holidayFridayMutzeDays: "1.5",
  holidayMutzeAloneDays: "1",
  // After Sola shows a DECLINED charge: seconds to wait (Sola is saying the result) before hanging up the call to Sola,
  // so the caller never hears Sola cut off mid-sentence or its new-amount question (Abraham, Nov 18, 2026). Set from a test call.
  phonePayDeclineHangupSeconds: "6",
  // Sola hang-up helper (Abraham, Nov 18, 2026, option a): Twilio sends the Sola call audio to our free Cloudflare
  // helper, which hangs up about half a second after Sola stops talking once Sola's record shows the result. Off until
  // the real test call passes (then the Owner ticks it in Admin > Phone > Sola PhonePay).
  solaListenOn: false,
  // Silence check: no Sola voice, no key tones and no result for this many seconds = check Sola once more, then box 147
  phonePaySilenceSeconds: "20",
  /** Menus made of several recordings: the Owner's order (JSON, src/lib/ivr/menu-order.ts). Empty = the default order. */
  menuOrders: "",
  solaPhonePayOwnerOnly: false,
  solaPhonePayNumber: "+18334343354",
  solaPhonePayBackup: "+18444227356",
  /** Digits sent to PhonePay: w = half a second; {pin} {amount} {dollars} {order}. Matches Abraham's Nov 15 test call:
   * wait for the greeting, PIN and pound; wait for the amount question, amount in cents and pound; wait, then 1 to
   * confirm. Nothing after that: the caller types the card. */
  solaPhonePayDigits: "wwwwwwwwww{pin}#wwwwwwwwwwwwwwwwwwwwwwww{amount}#wwwwwwwwww1",
  /** Owner custom charge (owner voicemail menu, key 7): its own digits (leave {amount} out if PhonePay should let the
   * Owner type the amount) and the highest amount allowed, in cents ($5,000.00). */
  solaPhonePayCustomDigits: "wwwwwwwwww{pin}#",
  solaPhonePayCustomCapCents: "500000",
  /** Payment test list (Abraham, Nov 15, 2026): while PhonePay is "test numbers only", only these callers are offered
   * pay by card. One phone number per line. */
  paymentTestNumbers: "+18457777585\n+18457990925\n+18452135239",
  /** Which service takes card payments on the phone line (Owner only, Admin > Phone > Sola PhonePay): "sola" (Sola
   * PhonePay, the live default) or "stripe" (Twilio Pay with the Stripe connector, test numbers only until Abraham
   * approves Stripe live mode). Sola stays for the staff POS and the website either way. */
  phoneCardProvider: "sola",
  /** Delivery fees by map area (Abraham, Nov 15, 2026): the shapes from his Google map, with his names and prices
   * (JSON, filled by the live build and Admin > Delivery settings > Reload the map). Empty = the town-name rule. */
  deliveryAreas: "",
  /** Achird for the whole line (Abraham, Nov 15, 2026): Owner-only, off. When on, lines with changing parts are put
   * together from Hark's recordings (pieces, numbers, letters, rental names) whenever every part is recorded. */
  achirdWholeLine: false,
  /** Google voice for the changing parts (option B): Owner-only, off. Needs GOOGLE_TTS_API_KEY; costs money. */
  googleLiveVoice: false,
  /** Texting test window (Abraham, Nov 16, 2026). Off since Nov 25, 2026 ("You can turn on the text messages."): every
   * customer gets texts (consent rules unchanged). The Owner can switch it in Admin > Phone settings. */
  smsTestOnly: false,
  smsTestNumbers: "+18457777585\n+18457990925",
  deliveryAreasLoadedAt: "",
  /** The $10 streets (Hark's Kiryas Joel list, Nov 15, 2026), one per line. Every other address in the delivery areas
   * is $15 (Ruach Hchaim $20). Owner-editable in Admin > Delivery settings. */
  localStreets: "Acres Road\nAmsterdam Way\nAnipoli Drive\nApta Way\nAustra Parkway\nBakertown Road\nBeer Shava Street\nBerdichev Drive\nBuchanan Court\nCarter Lane\nChernobyl Court\nChevron Road\nChust Road\nCounty Route 105\nDaj Boulevard\nDavid Weider Boulevard\nDinev Road\nDriveway\nDrubige Way\nDzikov Street\nEahal Court\nFillmore Court\nForest Road\nFrankfurt Road\nG Road\nGarfield Road\nGetzil Berger Boulevard\nGorlitz Court\nHamaspik Way\nHamburg Way\nHayes Court\nHershey Friedman Way\nIron Hill Plaza\nIsrael Zupnick Drive\nKahan Drive\nKalev Way\nKarlin Boulevard\nKarlsburg Road\nKashinov Road\nKerestier Court\nKomarna Way\nKoritz Court\nKosnitz Drive\nKrakow Boulevard\nKrolla Drive\nLeipnik Way\nLemberg Court\nLipa Friedman Lane\nLiska Way\nLizensk Boulevard\nLublin Way\nMaglenitz Street\nMelitz Road\nMeron Drive\nMezabish Place\nMezabish Road\nMeziritch Street\nMinkach Way\nMordche Sher Boulevard\nMountain Road\nNadvorna Way\nNickelsburg Road\nNicklesburg Road\nNininger Road\nOrshava Court\nPaksh Place\nPilnua Road\nPrag Boulevard\nPremishlan Way\nPreshburg Boulevard\nQuickway Road\nRadamsk Way\nRatzfert Way\nRimenev Court\nRovna Court\nRuzhin Road\nS M Rosmer Road\nSanz Court\nSasev Court\nSatmar Drive\nSchunnemunk Road\nSeven Springs Mountain Road\nShinev Court\nSiget Court\nState Route 17 West\nStrelisk Court\nStropkov Court\nTaitch Court\nTarnigrad Way\nTarnopol Way\nTaylor Court\nTeverya Way\nToltchav Way\nTzfas Road\nUngvar Street\nUnnamed Street\nVan Buren Drive\nVitebsk Street\nVolova Court\nVyoel Moshe Drive\nYoel Klein Boulevard\nZenta Road\nZiditchoc Street\nZlotchev Way",
  calendarEnabled: "yes",
  calendarLatitude: "41.3407",
  calendarLongitude: "-74.1679",
  /** Erev Shabbes closes at: "chatzos" (halachic midday) or "candles" (candle lighting) */
  erevShabbosClose: "chatzos",
  /** Erev Yom Tov closes at: "chatzos" or "candles" (pending Abraham; default chatzos) */
  erevYomTovClose: "chatzos",
  /** Minutes before sunset for candle lighting (used only when a "candles" close is chosen) */
  /** Abraham, Nov 26, 2026, 11:51 PM: the phone stops new bookings and payment this many minutes before candle lighting */
  /** Abraham, Nov 27, 2026, 12:19 AM: the latest time to book for the same day (regular days, HH:MM, 24-hour) */
  sameDayCutoff: "15:30",
  /** ...and on Friday and Erev Yom Tov: "chatzos" (halachic midday) or a time HH:MM */
  sameDayCutoffErev: "chatzos",
  /** Abraham, Nov 27, 2026, 12:33 AM: same-day delivery takes about this many hours (from-to), close by ... */
  sameDayHoursClose: "2.5-3.5",
  /** ... and in the surrounding areas */
  sameDayHoursFar: "3.5-4.5",
  /** Map areas counted as close by for that notice, one per line; empty = the Kiryas Joel (local) zone only */
  sameDayCloseAreas: "",
  /** Abraham, Nov 27, 2026, 12:47 AM: failed address tries before the caller goes back to the address-method menu */
  addressTriesBeforeMenu: "5",
  phoneCutoffMinutes: "15",
  /** ...and a caller's cart at that moment is saved until this many minutes after Shabbes / Yom Tov ends */
  shabbesSaveMinutes: "60",
  candleLightingMinutes: "15", // Abraham, Nov 14, 2026: Monroe lights 15 minutes before the first shkia
  /** Reopen after Shabbes / Yom Tov: minutes after sunset, or "tzeis" for nightfall at 8.5 degrees */
  reopenAfter: "72", // Abraham, Nov 14, 2026: reopen at Rabbeinu Tam, 72 minutes after sunset
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
  /** Hours page (Abraham, Nov 25, 2026, 4:54 PM): every line's schedule, groups and date overrides, as JSON; empty = the decided defaults. */
  hoursSchedules: "",
  hoursMonThu: "10:30-19:00",
  /** Friday opening; closing follows the Erev Shabbes rule (chatzos) until Abraham confirms. */
  hoursFridayOpen: "10:30",
  hoursSunday: "11:30-19:00",
  /** Motzei Shabbes opening: "tzeis+120" = 2 hours after Shabbes ends (Abraham), "tzeis", or HH:MM. */
  hoursMotzeiOpen: "tzeis+120",
  hoursMotzeiCloseWinter: "23:00",
  hoursMotzeiCloseSummer: "00:00",
  /** Which Motzei Shabbes closing applies: "dst" = summer while daylight saving time is in effect (to confirm). */
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
  /*
   * Abraham (Phone Menu v3): each line rings its list this many times (25 seconds a ring, set per number), then
   * that line's voicemail. After hours: 0 and 5 still ring, 6 rings 8:00 AM to 10:30 PM (Friday and Erev Yom Tov
   * until 4:00 PM or an hour before candle lighting, whichever is earlier); the rest go to voicemail. Shabbes and
   * Yom Tov: nothing rings. The announcement staff hear is editable per line (empty = the standard one).
   */
  ringAttempts0: "3",
  ringAttempts2: "3",
  ringAttempts4: "3",
  ringAttempts5: "3",
  ringAttempts6: "3",
  ringAttempts8: "3",
  /* Abraham (section 17): after hours, Shabbes and Yom Tov every extension goes to voicemail; switch per line in Admin */
  ringAfterHours0: false,
  ringAfterHours2: false,
  ringAfterHours4: false,
  ringAfterHours5: false,
  ringAfterHours6: false,
  ringAfterHours8: false,
  /* After-hours window per line, editable in Phone settings (Abraham, Nov 14, 2026). Key 6 keeps the approved hours. */
  ringAfterFrom0: "", ringAfterTo0: "", ringErevTo0: "", ringErevToSummer0: "", ringErevBefore0: "0",
  ringAfterFrom2: "", ringAfterTo2: "", ringErevTo2: "", ringErevToSummer2: "", ringErevBefore2: "0",
  ringAfterFrom4: "", ringAfterTo4: "", ringErevTo4: "", ringErevToSummer4: "", ringErevBefore4: "0",
  ringAfterFrom5: "", ringAfterTo5: "", ringErevTo5: "", ringErevToSummer5: "", ringErevBefore5: "0",
  ringAfterFrom6: "08:00", ringAfterTo6: "22:30", ringErevTo6: "15:00", ringErevToSummer6: "16:00", ringErevBefore6: "90",
  ringAfterFrom8: "", ringAfterTo8: "", ringErevTo8: "", ringErevToSummer8: "", ringErevBefore8: "0",
  ringAnnounce0: "",
  ringAnnounce2: "",
  ringAnnounce4: "",
  ringAnnounce5: "",
  ringAnnounce6: "",
  ringAnnounce8: "",
  /** Extension names staff hear in the call announcement (empty = the default name for that key). */
  ringName0: "",
  ringName2: "",
  ringName4: "",
  ringName5: "",
  ringName6: "",
  ringName8: "",
  /** Key 9 (feedback and comments voicemail) name in alerts */
  ringName9: "",
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
  /**
   * Call recording (Abraham O): OFF until he approves the notice wording and turns it on himself (Owner-only switch
   * in Settings). When on, every call hears the recording notice first; recording starts only after it.
   */
  callRecording: false,
  /** Hark's review item 9 (Nov 26, 2026): a fresh code and typed words before turning on call recording, the Google
   *  voice, PhonePay or Stripe. Off until Abraham approves the screenshots. */
  sensitiveSwitchGuard: false,
  /** Admin handoff Phase 2 (Nov 27, 2026): switches that were set in code, now Owner settings, each at today's value. */
  liveRefundsOn: false,
  invoiceEmailOn: true,
  staffPromoMode: "owner_preview",
  /** Abraham, Nov 26, 2026, 8:34 PM: staff may book Mutze Shabbes every week (not the phone, not the website) */
  staffMutzeEveryWeek: true,
  /** Abraham, Nov 26, 2026: at most this many promo texts per customer per calendar year (the wording says 5) */
  promosPerYear: "5",
  /** Mutze Shabbes by staff: delivery this many minutes after Shabbes ends (150 = two and a half hours) */
  staffMutzeDeliveryAfterMin: "150",
  /** Bookkeeping (Abraham T): Sola processing rate, to estimate fees and the net deposit per payment. Owner sets them from the Sola statement. */
  solaFeePercent: "0",
  solaFeeCents: "0",
  /** Bookkeeping reminders: days before a bill, sales tax or estimated tax due date. */
  bookReminderDays: "7",
  /** Balance sheet: cash in the bank on the day the books start (Owner enters it; cents) and that date. */
  bookOpeningCashCents: "0",
  bookOpeningDate: "",
  /** General ledger (Bookkeeping spec): set by the Owner once the accountant approves. Empty = not set up yet. */
  glChartApprovedBy: "",
  glChartApprovedOn: "",
  glFiscalYearStartMonth: "",
  glAccountingMethod: "",
  glBaseCurrency: "USD",
  /** Journal entries at or above this amount (cents) need a second person to approve. Empty = always (until the Owner sets it). */
  glApprovalThresholdCents: "",
  /** Stock / warehouse address: where the delivery run starts and ends (Delivery screen route links). Owner only. */
  stockAddress: "",
  /** Website note under the hours (Abraham's wording). */
  hoursWebsiteNote: "Please note that you can book at any time using our automated phone system.",
  /** Line 8 after payment (Abraham, Nov 26, 2026; his answer is still open): skip the question for a caller who already gets promotions. */
  paidPromoSkipOptedIn: true,
  /** Disconnect ending (Abraham, Nov 26, 2026): minutes of silence with items in the cart before the disconnect check, and seconds to wait for a key. */
  /** How offers combine (Admin handoff Phase 4, Nov 26, 2026): "best" = only the biggest saving (as always); "add" = they add up. */
  offersStacking: "best",
  /** Phone timing (Admin handoff Phase 3): every wait on the phone line, defaults equal to the old built-in values. */
  ...TIMER_DEFAULTS,
  disconnectSilenceMinutes: "3",
  disconnectCheckSeconds: "3",
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : string };

/**
 * Neon free plan (Nov 26, 2026): the settings are read many times per call step and page, so one read is kept in
 * memory for 15 seconds on each server instance and cleared at once by every save here. A change made in Admin reaches
 * every instance within 15 seconds. (Tests read the database every time.)
 */
const SETTINGS_TTL_MS = 15_000;
let settingsCache: { at: number; rows: { key: string; value: unknown }[] } | null = null;
export function clearSettingsCache() {
  settingsCache = null;
}
async function settingRows(): Promise<{ key: string; value: unknown }[]> {
  if (!process.env.VITEST && settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.rows;
  const rows = await db.select({ key: schema.appSettings.key, value: schema.appSettings.value }).from(schema.appSettings);
  settingsCache = { at: Date.now(), rows };
  return rows;
}

export async function getSettings(): Promise<Settings> {
  const out = { ...SETTING_DEFAULTS } as Settings;
  try {
    const rows = await settingRows();
    for (const r of rows) {
      if (!(r.key in out)) continue;
      // The database hands back a saved "72" as the number 72; keep every value the same type as its default
      const def = (SETTING_DEFAULTS as Record<string, unknown>)[r.key];
      // (a saved list, like the delivery map areas, comes back as a list: kept as its JSON text)
      const v = typeof def === "string" && r.value !== null && typeof r.value !== "string" ? (typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value)) : r.value;
      (out as Record<string, unknown>)[r.key] = v;
    }
  } catch (e) {
    console.error("settings load failed, using defaults", e);
  }
  if (!out.smsForwardPhone) out.smsForwardPhone = process.env.ADMIN_PHONE || "";
  if (!out.supportPhone) out.supportPhone = process.env.TWILIO_PHONE_NUMBER || "";
  return out;
}

/** Values in the history are kept wrapped ({ v }) so "12" stays the text "12" (the database turns a bare "12" into 12). */
export const wrapValue = (v: unknown) => ({ v }) as never;
export const unwrapValue = (x: unknown): unknown => (x && typeof x === "object" && "v" in (x as object) ? (x as { v: unknown }).v : x);
type Tx = Pick<typeof db, "select" | "insert" | "update">;

/**
 * The value really stored for a setting (or its default), with no fallbacks filled in from the server (Hark's review
 * M6: a blank forward phone must not be recorded as the server's phone number).
 */
export async function rawSetting(key: string, tx: Tx = db): Promise<unknown> {
  const [row] = await tx.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, key)).limit(1);
  const def = (SETTING_DEFAULTS as Record<string, unknown>)[key];
  if (!row) return def;
  const v = row.value;
  return typeof def === "string" && v !== null && typeof v !== "string" ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : v;
}

const sameValue = (a: unknown, b: unknown) => (typeof a === "object" || typeof b === "object" ? JSON.stringify(a) === JSON.stringify(b) : String(a) === String(b));

/** Write the live value only (no history row): used inside a publish, which records its own version. */
export async function writeSettingValue(tx: Tx, key: string, value: unknown, userId: number | null) {
  clearSettingsCache();
  await tx
    .insert(schema.appSettings)
    .values({ key, value: value as never, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: value as never, updatedAt: new Date(), updatedBy: userId } });
}

/**
 * Save a setting from any Admin page or the system (Hark's review H3, Nov 26, 2026): the live value and a history row
 * (the value before, the new value, who, and which page) are written together, so All settings shows every change and
 * Undo always knows the real value before. A save that changes nothing writes no history.
 */
export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K], userId?: number | null, source = "Saved on its Admin page") {
  let was: unknown;
  const write = async (tx: Tx) => {
    const before = await rawSetting(key, tx);
    was = before;
    await writeSettingValue(tx, key, value, userId ?? null);
    if (sameValue(before, value)) return;
    await tx.update(schema.configVersions).set({ status: "replaced" }).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "live")));
    await tx.insert(schema.configVersions).values({ key, value: wrapValue(value), previous: wrapValue(before), status: "live", reason: source.slice(0, 300), createdBy: userId ?? null, publishedBy: userId ?? null, publishedAt: new Date() });
  };
  if (typeof db.transaction === "function") await db.transaction((tx) => write(tx as unknown as Tx));
  else await write(db);
  clearSettingsCache();
  // A value spoken inside recordings changed (Nov 27, 2026): flag those recordings (after the save, never inside it)
  if (key !== "recordingFlags" && key !== "recordingLinks" && !sameValue(was, value)) {
    const { linkedValueChanged } = await import("@/lib/recording-flags");
    await linkedValueChanged(`setting:${String(key)}`, was ?? (SETTING_DEFAULTS as Record<string, unknown>)[key as string], value, userId ?? null);
  }
}

export async function deleteSetting(key: string) {
  clearSettingsCache();
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
}

/** How long a payment link holds the rentals (Batch 4, Nov 25, 2026): "phone" (10) or "admin" New booking (25). */
export async function linkHoldMinutes(kind: "phone" | "admin"): Promise<number> {
  const s = (await getSettings()) as Record<string, unknown>;
  const n = Math.floor(Number(s[kind === "phone" ? "phoneLinkHoldMinutes" : "adminLinkHoldMinutes"]));
  return n >= 1 && n <= 240 ? n : kind === "phone" ? 10 : 25;
}

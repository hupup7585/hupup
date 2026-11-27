import { SETTING_DEFAULTS } from "@/lib/settings";
import { CONFIG_USAGE } from "@/lib/config-usage.generated";
import { CONFIG_EXPLANATIONS, type Explanation } from "@/lib/config-explanations";
import { PHONE_TIMERS } from "@/lib/ivr/timers";
import { rules, type Rule } from "@/lib/setting-rules";

/**
 * Admin handoff Phase 2 (Abraham, Nov 26, 2026), tightened after Hark's Phase 1-2 review (H1, H4, H5, H6, M1, M2, M7,
 * M8): one explicit entry for EVERY setting. A setting is edited on All settings only when this file can check the
 * value completely, with the same limits the code uses. Settings whose checks live on their own Admin page are shown
 * read-only with a link (that page checks them). Protected, paid, unused and system-filled settings are locked with
 * the reason. Nothing is guessed from the default value.
 */
export type ConfigType = "bool" | "int" | "number" | "text" | "list" | "choice" | "json";
export type ConfigMode = "edit" | "page" | "locked";
export type ConfigDef = {
  key: string;
  label: string;
  help: string;
  group: string;
  type: ConfigType;
  default: unknown;
  min?: number;
  max?: number;
  choices?: string[];
  /** Customer-facing words: publishing needs the Owner's explicit approval of the exact text. */
  wording: boolean;
  mode: ConfigMode;
  /** mode page: the Admin page that edits and checks it. */
  page?: string;
  /** mode locked: why it cannot be changed here. */
  locked?: string;
  /** mode edit: the check for a typed value (with type and limits). */
  rule?: Rule;
  usedBy: string[];
  /** Plain-English explanation: what it does, where customers meet it, what happens if changed (Nov 26, 2026). */
  explain: Explanation | null;
};

type Spec = Partial<Omit<ConfigDef, "key" | "default" | "usedBy" | "explain" | "help">> & { mode: ConfigMode; group: string };

const PROTECTED = "Shabbes and Yom Tov closures are protected and cannot be switched off from Admin.";
const NOT_IN_USE = "Not in use: nothing reads this setting now (Needs Claude to connect before it can be changed).";
const SYSTEM = "Filled in by the system; nothing to change by hand.";

const page = (path: string, group: string, extra: Partial<Spec> = {}): Spec => ({ mode: "page", page: path, group, ...extra });
const lock = (why: string, group: string, extra: Partial<Spec> = {}): Spec => ({ mode: "locked", locked: why, group, ...extra });

/** Exact settings first; families (by pattern) after. Every key in SETTING_DEFAULTS must match one (tested). */
const EXACT: Record<string, Spec> = {
  // Editable here (fully checked, same limits as the code)
  phoneLinkHoldMinutes: { mode: "edit", label: "Payment link hold, phone (minutes)", group: "Payments", type: "int", min: 1, max: 240 },
  adminLinkHoldMinutes: { mode: "edit", label: "Payment link hold, Admin New booking (minutes)", group: "Payments", type: "int", min: 1, max: 240 },
  nameSpeakingRate: { mode: "edit", label: "Speaking rate for names", group: "Phone: voice", type: "number", min: 0.5, max: 2 },
  paidPromoSkipOptedIn: { mode: "edit", label: "After payment, Line 8: skip it for callers who already get promotions", group: "Phone: after payment", type: "bool" },
  offersStacking: { mode: "edit", label: "How offers combine", group: "Offers and discounts", type: "choice", choices: ["best", "add"] },
  disconnectSilenceMinutes: { mode: "edit", label: "Disconnect check: minutes of silence with items in the cart", group: "Phone: after payment", type: "int", min: 1, max: 10 },
  // Admin handoff Phase 2 (Nov 27, 2026): switches that were set in code
  staffPromoMode: { mode: "edit", label: "Staff promo sign-up box: Preview mark", group: "Texts and promotions", type: "choice", choices: ["owner_preview", "live"] },
  liveRefundsOn: page("/admin/bookkeeping?tab=settings", "Payments", { label: "Live refunds (real money back to cards)", type: "bool" }),
  invoiceEmailOn: page("/admin/bookkeeping?tab=settings", "Payments", { label: "Email invoices to customers", type: "bool" }),
  disconnectCheckSeconds: { mode: "edit", label: "Disconnect check: seconds to wait for a key", group: "Phone: after payment", type: "int", min: 1, max: 15 },

  // Locked
  calendarEnabled: lock(PROTECTED, "Hours and calendar", { label: "Shabbes and Yom Tov closing" }),
  googleLiveVoice: lock("Switched only on Hotline prompts, slots page, and it costs money; with the safety check on it needs a fresh code there.", "Phone: voice", { label: "Google voice for the changing parts", page: "/admin/phone/prompts/slots" }),
  promosPerYear: { mode: "edit", label: "Promo texts per customer per year (most)", group: "Offers and discounts", type: "int", min: 1, max: 12 },
  recordingFlags: lock(SYSTEM, "Phone: voice", { label: "Recordings that need a new recording (automatic)" }),
  recordingLinks: page("/admin/phone/prompts/slots", "Phone: voice", { label: "Settings spoken inside recordings", type: "json" }),
  staffHoldMusicOn: { mode: "edit", label: "Hold music while staff are rung", group: "Phone: ringing", type: "bool" },
  addressTriesBeforeMenu: { mode: "edit", label: "Address tries before going back to the address menu", group: "Phone: menus", type: "int", min: 1, max: 20 },
  staffMutzeEveryWeek: { mode: "edit", label: "Allow Mutze Shabbes bookings by staff every week", group: "Bookings", type: "bool" },
  staffMutzeDeliveryAfterMin: { mode: "edit", label: "Mutze Shabbes by staff: delivery minutes after Shabbes ends", group: "Bookings", type: "int", min: 0, max: 360 },
  sensitiveSwitchGuard: { mode: "edit", label: "Safety check before turning on recording, Google voice, card payments or Stripe", group: "Sign-in", type: "bool" },
  callRecording: lock("Waits for the Owner's approval of the recording notice; switched only on Phone settings, never from this list.", "Phone: ringing", { label: "Call recording", page: "/admin/phone/settings" }),
  smsHelpText: lock(NOT_IN_USE, "Texts and emails", { label: "HELP reply words (not in use)", wording: true }),
  smsHelpReplyEnabled: lock(NOT_IN_USE, "Texts and emails", { label: "HELP reply switch (not in use)" }),
  supportPhone: lock(NOT_IN_USE, "Texts and emails", { label: "Support phone (not in use)" }),
  operatorAcceptText: lock(NOT_IN_USE, "Phone: ringing", { label: "Old staff accept words (not in use)" }),
  phonePayDeclinesPerDay: lock("Not in use: the card code reads it but it has no effect (replaced by the calls-per-day limit).", "Payments", { label: "Old declines-per-day limit (not in use)" }),
  catalogTextMissingAt: lock(SYSTEM, "Texts and emails", { label: "Last catalog text asked for with no pictures" }),
  deliveryAreasLoadedAt: lock(SYSTEM, "Delivery", { label: "Delivery map last loaded" }),
  glBaseCurrency: lock("Fixed: the books are kept in US dollars.", "Bookkeeping", { label: "Bookkeeping currency" }),

  // Edited on their own pages
  hoursSchedules: page("/admin/hours", "Hours and calendar", { label: "Every line's hours", type: "json" }),
  menuOrders: page("/admin/phone/menu-order", "Phone: menus", { label: "Menu order", type: "json" }),
  calendarOverrides: page("/admin/holidays", "Hours and calendar", { label: "Dates opened or closed by hand", type: "list" }),
  hoursWebsiteNote: page("/admin/settings", "Hours and calendar", { label: "Website note under the hours", wording: true }),
  ownerUsername: page("/admin/staff", "Sign-in", { label: "Owner sign-in username" }),
  stockAddress: page("/admin/settings", "Delivery", { label: "Warehouse address (delivery routes)" }),
  salesTaxPercent: page("/admin/settings", "Fees and tax", { label: "Sales tax (percent)", type: "number" }),
  zoneKjPlaces: page("/admin/settings", "Delivery", { label: "Kiryas Joel place names", type: "list" }),
  zoneAreaPlaces: page("/admin/settings", "Delivery", { label: "Nearby town names", type: "list" }),
  zoneCountyPlaces: page("/admin/delivery-settings", "Delivery", { label: "Rest of Orange County town names", type: "list" }),
  geoBackupCensusOn: page("/admin/delivery-settings", "Delivery", { label: "Address check backup 1: US Census Bureau", type: "bool" }),
  geoBackupOsmOn: page("/admin/delivery-settings", "Delivery", { label: "Address check backup 2: OpenStreetMap", type: "bool" }),
  addressRecheckEarlyMinutes: page("/admin/delivery-settings", "Delivery", { label: "Address re-check every (minutes) at first", type: "number" }),
  addressRecheckEarlyForMinutes: page("/admin/delivery-settings", "Delivery", { label: "Address re-check: first period (minutes)", type: "number" }),
  addressRecheckLaterMinutes: page("/admin/delivery-settings", "Delivery", { label: "Address re-check every (minutes) after that", type: "number" }),
  emailSignature: page("/admin/settings", "Texts and emails", { label: "Email signature", wording: true }),
  emailMailingAddress: page("/admin/settings", "Texts and emails", { label: "Mailing address in promotional emails", wording: true }),
  catalogName: page("/admin/catalog-send", "Texts and emails", { label: "Catalog name (in the email subject)", wording: true }),
  catalogEmailSubjectText: page("/admin/catalog-send", "Texts and emails", { label: "Catalog email subject", wording: true }),
  catalogEmailBodyText: page("/admin/catalog-send", "Texts and emails", { label: "Catalog email words", wording: true }),
  catalogTextItems: page("/admin/catalog-send", "Texts and emails", { label: "Catalog pictures for texts", type: "json" }),
  catalogAutoAttach: page("/admin/catalog-send", "Texts and emails", { label: "Attach the catalog file to the catalog email", type: "bool" }),
  catalogTextPicture1: page("/admin/catalog", "Texts and emails", { label: "Catalog text picture 1" }),
  catalogTextPicture2: page("/admin/catalog", "Texts and emails", { label: "Catalog text picture 2" }),
  achirdWholeLine: page("/admin/phone/prompts/slots", "Phone: voice", { label: "Whole lines from recorded pieces", type: "bool" }),
  offersIntro: page("/admin/offers", "Offers and discounts", { label: "Offers page: line at the top" }),
  deliveryAreas: page("/admin/delivery-settings", "Delivery", { label: "Delivery map areas", type: "json" }),
  localStreets: page("/admin/delivery-settings", "Delivery", { label: "Kiryas Joel $10 streets", type: "list" }),
  blockedCallers: page("/admin/phone/settings", "Phone: ringing", { label: "Blocked callers", type: "list" }),
  smsTestOnly: page("/admin/phone/settings", "Texts and emails", { label: "Customer texts to test numbers only", type: "bool" }),
  smsTestNumbers: page("/admin/phone/settings", "Texts and emails", { label: "Texting test numbers", type: "list" }),
  smsForwardEnabled: page("/admin/phone/settings", "Texts and emails", { label: "Copy incoming texts to the Owner", type: "bool" }),
  smsForwardPhone: page("/admin/phone/settings", "Texts and emails", { label: "Phone for copies of incoming texts" }),
  voicemailMms: page("/admin/voicemail", "Texts and emails", { label: "Voicemail sound file in the alert text", type: "bool" }),
  missedCallAlerts: page("/admin/voicemail", "Texts and emails", { label: "Missed-call alerts", type: "bool" }),
  incomingTextEmail: page("/admin/voicemail", "Texts and emails", { label: "Email copy of incoming texts", type: "bool" }),
  paymentTestNumbers: page("/admin/phone/phonepay", "Payments", { label: "Card payment test numbers", type: "list" }),
  phoneCardProvider: page("/admin/phone/phonepay", "Payments", { label: "Card payment service on the phone", type: "choice", choices: ["sola", "stripe"] }),
  solaListenOn: page("/admin/phone/phonepay", "Payments", { label: "Sola listening helper", type: "bool" }),
};

const FAMILIES: [RegExp, Spec][] = [
  [/^timer[A-Z]/, { mode: "edit", group: "Phone: timing", type: "int" }], // limits filled in from timers.ts below
  [/^(ring[A-Z][A-Za-z]*\d|operator(Targets|Mode|AcceptPrompt))$/, page("/admin/phone/settings", "Phone: ringing")],
  [/^(solaPhonePay|phonePay)/, page("/admin/phone/phonepay", "Payments")],
  [/^music[A-Z]/, page("/admin/phone/music", "Phone: music")],
  [/^(deliveryFee|deliveryPromo|deliveryExtraItem)/, page("/admin/delivery-settings", "Fees and tax")],
  [/^(solaFee|book[A-Z]|gl[A-Z])/, page("/admin/bookkeeping", "Bookkeeping")],
  [/^(laserThirdSetHalfOn|offer[A-Z]|holiday[A-Z])/, page("/admin/offers", "Offers and discounts")],
  [/^(erev|candle|reopen|phoneCutoff|shabbesSave|sameDayCutoff|sameDayHours|sameDayCloseAreas|close[A-Z]|calendar(Latitude|Longitude)|hours[A-Z])/, page("/admin/settings", "Hours and calendar")],
];

const TIMER = new Map(PHONE_TIMERS.map((t) => [t.key, t]));

export function specFor(key: string): Spec | null {
  const t = TIMER.get(key as never);
  if (t) return { mode: "edit", group: "Phone: timing", type: "int", min: t.min, max: t.max, label: t.label };
  return EXACT[key] ?? FAMILIES.find(([re]) => re.test(key))?.[1] ?? null;
}

const SECRET = /(apikey|api_key|secret|token|password|pin$|webhook)/i;

function humanize(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
const displayType = (v: unknown): ConfigType => (typeof v === "boolean" ? "bool" : "text");

function ruleFor(type: ConfigType, min?: number, max?: number, choices?: string[]): Rule | undefined {
  if (type === "int" && min !== undefined && max !== undefined) return rules.wholeBetween(min, max);
  if (type === "number" && min !== undefined && max !== undefined) return rules.numberBetween(min, max);
  if (type === "choice" && choices) return rules.oneOf(choices);
  if (type === "bool") return (v) => (["on", "off", "true", "false", ""].includes(v.trim()) ? null : "Choose on or off.");
  return undefined;
}

/** Every Admin setting with its explicit entry (secrets are never listed). */
export function configDefs(): ConfigDef[] {
  return Object.entries(SETTING_DEFAULTS as Record<string, unknown>)
    .filter(([k]) => !SECRET.test(k))
    .map(([key, def]) => {
      const s = specFor(key) ?? lock("No entry in the settings list yet (Needs Claude to connect).", "Other settings");
      const type = s.type ?? displayType(def);
      const explain = CONFIG_EXPLANATIONS[key] ?? null;
      return {
        key,
        label: s.label ?? humanize(key),
        help: explain?.what ?? "",
        group: s.group,
        type,
        default: def,
        min: s.min,
        max: s.max,
        choices: s.choices,
        wording: s.wording ?? false,
        mode: s.mode,
        page: s.page,
        locked: s.locked,
        rule: s.mode === "edit" ? (s.rule ?? ruleFor(type, s.min, s.max, s.choices)) : undefined,
        usedBy: CONFIG_USAGE[key] ?? [],
        explain,
      } satisfies ConfigDef;
    });
}

export function configDef(key: string): ConfigDef | null {
  return configDefs().find((d) => d.key === key) ?? null;
}

/** Check a typed value against its setting; returns the value to store, or a plain-English reason. */
export function validateConfig(def: ConfigDef, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (def.mode === "locked") return { ok: false, error: def.locked ?? "This setting is locked." };
  if (def.mode === "page") return { ok: false, error: `This is edited and checked on its own page: ${def.page}` };
  if (!def.rule) return { ok: false, error: "This setting has no check yet, so it cannot be changed here." };
  const t = raw.replace(/\r/g, "").trim();
  const reason = def.rule(t);
  if (reason) return { ok: false, error: reason };
  if (def.type === "bool") return { ok: true, value: t === "on" || t === "true" };
  if (def.type === "int" || def.type === "number") return { ok: true, value: String(Number(t)) };
  return { ok: true, value: t };
}

import { SETTING_DEFAULTS } from "@/lib/settings";
import { CONFIG_USAGE } from "@/lib/config-usage.generated";

/**
 * Admin handoff Phase 2 (Abraham, Nov 26, 2026): one typed registry of every Admin setting. Each entry has a plain
 * label and explanation, its type and limits, its current default, where it is used, and whether it is customer
 * wording (publishing it is the Owner's approval of the exact words). Live values stay in app_settings, so the phone
 * line, website and Admin read them exactly as before; drafts and history live in config_versions.
 */
export type ConfigType = "bool" | "int" | "number" | "text" | "list" | "choice" | "json";
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
  wording?: boolean;
  /** Edited on its own Admin page (a structured value); shown here read-only with a link. */
  page?: string;
  /** Protected: shown with the reason, never editable here. */
  locked?: string;
  usedBy: string[];
};

/** Plain-English labels, limits and groups for the settings that need more than their name. */
const META: Record<string, Partial<ConfigDef>> = {
  phoneLinkHoldMinutes: { label: "Payment link hold, phone (minutes)", help: "How long a payment link sent from the phone line holds the rentals.", group: "Payments", type: "int", min: 1, max: 240 },
  adminLinkHoldMinutes: { label: "Payment link hold, Admin New booking (minutes)", help: "How long a payment link sent from New booking holds the rentals.", group: "Payments", type: "int", min: 1, max: 240 },
  salesTaxPercent: { label: "Sales tax (percent)", help: "Applied to the whole order including delivery. Review with the accountant before changing.", group: "Fees and tax", type: "number", min: 0, max: 20 },
  deliveryFeeKjCents: { label: "Delivery fee, Kiryas Joel (cents)", help: "1000 = $10.00.", group: "Fees and tax", type: "int", min: 0, max: 100000 },
  deliveryFeeAreaCents: { label: "Delivery fee, nearby towns (cents)", help: "1500 = $15.00.", group: "Fees and tax", type: "int", min: 0, max: 100000 },
  deliveryFeeOutsideCents: { label: "Delivery fee, rest of Orange County (cents)", help: "2000 = $20.00.", group: "Fees and tax", type: "int", min: 0, max: 100000 },
  laserThirdSetHalfOn: { label: "Laser tag: every third set half price", help: "On: the set added third is half price.", group: "Offers and discounts", type: "bool" },
  offerThuSunOn: { label: "Offer: Thursday to Sunday at 1.5 times", group: "Offers and discounts", type: "bool" },
  offerFourthSundayOn: { label: "Offer: 4th Sunday free", group: "Offers and discounts", type: "bool" },
  phonePayTriesPerCall: { label: "Card tries per call", group: "Payments", type: "int", min: 1, max: 10 },
  phonePayCallsPerDay: { label: "Calls with card tries per number in 24 hours", group: "Payments", type: "int", min: 1, max: 50 },
  candleLightingMinutes: { label: "Candle lighting (minutes before sunset)", help: "Used for the Erev Shabbes and Erev Yom Tov close.", group: "Hours and calendar", type: "int", min: 0, max: 60 },
  reopenAfter: { label: "Reopen after Shabbes and Yom Tov", help: "Minutes after sunset, or tzeis.", group: "Hours and calendar", type: "text" },
  erevShabbosClose: { label: "Erev Shabbes closes at", group: "Hours and calendar", type: "choice", choices: ["chatzos", "candles"] },
  erevYomTovClose: { label: "Erev Yom Tov closes at", group: "Hours and calendar", type: "choice", choices: ["chatzos", "candles"] },
  calendarEnabled: { label: "Shabbes and Yom Tov closing", group: "Hours and calendar", type: "choice", choices: ["yes", "no"], locked: "Shabbes and Yom Tov closures are protected and cannot be switched off from Admin." },
  calendarLatitude: { label: "Zmanim location: latitude", help: "Monroe, NY. Used for chatzos, candle lighting and reopening.", group: "Hours and calendar", type: "number", min: -90, max: 90 },
  calendarLongitude: { label: "Zmanim location: longitude", group: "Hours and calendar", type: "number", min: -180, max: 180 },
  offersIntro: { label: "Offers page: line at the top", group: "Offers and discounts", type: "text", wording: false, help: "Shown to staff only." },
  nameSpeakingRate: { label: "Speaking rate for names", group: "Phone: voice", type: "number", min: 0.5, max: 2 },
  hoursSchedules: { label: "Every line's hours", page: "/admin/hours", group: "Hours and calendar", type: "json" },
  menuOrders: { label: "Menu order", page: "/admin/phone/menu-order", group: "Phone: menus", type: "json" },
  deliveryAreas: { label: "Delivery map areas", page: "/admin/delivery-settings", group: "Delivery", type: "json" },
  catalogTextItems: { label: "Catalog pictures for texts", page: "/admin/catalog-send", group: "Texts and emails", type: "json" },
  holidayFridayMutzeDays: { label: "Friday plus Mutze Shabbes: days charged", group: "Offers and discounts", type: "number", min: 1, max: 3 },
  holidayMutzeAloneDays: { label: "Mutze Shabbes alone: days charged", group: "Offers and discounts", type: "number", min: 0.5, max: 3 },
};

/** Words in a key that tell its group, when META does not. */
const GROUP_BY_WORD: [RegExp, string][] = [
  [/^(ring|operator)/i, "Phone: ringing"],
  [/^(phonePay|solaPhonePay|solaListen|phoneCard|payment)/i, "Payments"],
  [/^(music)/i, "Phone: music"],
  [/^(sms|incomingText|missedCall|voicemail)/i, "Texts and emails"],
  [/^(email|catalog)/i, "Texts and emails"],
  [/^(delivery|zone|local)/i, "Delivery"],
  [/^(hours|close|calendar|holiday)/i, "Hours and calendar"],
  [/^(offer|laser)/i, "Offers and discounts"],
];

const SECRET = /(apikey|api_key|secret|token|password|pin$|webhook)/i;
const WORDING_KEY = /(Text|Intro|Subject|Body|Signature|Greeting|Line|Wording)$/;

function humanize(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
function inferType(v: unknown): ConfigType {
  if (typeof v === "boolean") return "bool";
  const s = String(v);
  if (s === "yes" || s === "no") return "choice";
  if (/^-?\d+$/.test(s)) return "int";
  if (/^-?\d*\.\d+$/.test(s)) return "number";
  if (s.includes("\n")) return "list";
  return "text";
}

/** Every Admin setting, typed, with its defaults and where it is used (secrets are never listed). */
export function configDefs(): ConfigDef[] {
  return Object.entries(SETTING_DEFAULTS as Record<string, unknown>)
    .filter(([k]) => !SECRET.test(k))
    .map(([key, def]) => {
      const m = META[key] ?? {};
      const type = m.type ?? inferType(def);
      return {
        key,
        label: m.label ?? humanize(key),
        help: m.help ?? "",
        group: m.group ?? GROUP_BY_WORD.find(([re]) => re.test(key))?.[1] ?? "Other settings",
        type,
        default: def,
        min: m.min,
        max: m.max,
        choices: m.choices ?? (type === "choice" ? ["yes", "no"] : undefined),
        wording: m.wording ?? (type === "text" && WORDING_KEY.test(key)),
        page: m.page,
        locked: m.locked,
        usedBy: CONFIG_USAGE[key] ?? [],
      } satisfies ConfigDef;
    });
}

export function configDef(key: string): ConfigDef | null {
  return configDefs().find((d) => d.key === key) ?? null;
}

const PHONE = /^\+1\d{10}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Check a typed value against its setting; returns the value to store, or a plain-English reason. */
export function validateConfig(def: ConfigDef, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (def.locked) return { ok: false, error: def.locked };
  if (def.page) return { ok: false, error: `This is edited on its own page: ${def.page}` };
  const t = raw.trim();
  switch (def.type) {
    case "bool":
      return t === "on" || t === "true" ? { ok: true, value: true } : t === "off" || t === "false" || t === "" ? { ok: true, value: false } : { ok: false, error: "Choose on or off." };
    case "int":
    case "number": {
      if (t === "") return { ok: false, error: "Enter a number." };
      const n = Number(t);
      if (!Number.isFinite(n) || (def.type === "int" && !Number.isInteger(n))) return { ok: false, error: def.type === "int" ? "Enter a whole number." : "Enter a number." };
      if (def.min !== undefined && n < def.min) return { ok: false, error: `The lowest allowed is ${def.min}.` };
      if (def.max !== undefined && n > def.max) return { ok: false, error: `The highest allowed is ${def.max}.` };
      if (n < 0 && def.min === undefined) return { ok: false, error: "Negative numbers are not allowed here." };
      return { ok: true, value: String(n) };
    }
    case "choice":
      return def.choices?.includes(t) ? { ok: true, value: t } : { ok: false, error: `Choose one of: ${def.choices?.join(", ")}.` };
    case "list":
    case "text": {
      if (t.length > 5000) return { ok: false, error: "That is too long (5,000 characters at most)." };
      if (/Phone$/.test(def.key) && t && !PHONE.test(t)) return { ok: false, error: "Enter the phone number as +1 and 10 digits, for example +18454157585." };
      if (/Email$/.test(def.key) && t && !EMAIL.test(t)) return { ok: false, error: "Enter a full email address." };
      if (def.type === "list") {
        const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
        if (/Numbers$/.test(def.key)) {
          const bad = lines.find((l) => !PHONE.test(l));
          if (bad) return { ok: false, error: `Not a phone number: ${bad}. Use +1 and 10 digits.` };
        }
        return { ok: true, value: lines.join("\n") };
      }
      return { ok: true, value: t };
    }
    default:
      return { ok: false, error: "This setting is edited on its own page." };
  }
}

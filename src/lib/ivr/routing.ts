import { config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import type { Settings } from "@/lib/settings";

/** Who rings when a caller presses 0 ("Speak to someone"). Edited in /admin/settings. */
export type RouteTarget = { label: string; phone: string; ringSeconds: number };

export const RING_MIN = 5;
export const RING_MAX = 60;

/**
 * Numbers that lead back into the hotline: the hotline itself and the public number that is forwarded to it.
 * Ringing one of these makes the call loop into our own phone menu and end within seconds (Abraham, Nov 9, 2026),
 * so they are never rung.
 */
export function loopNumbers(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set([toE164(env.TWILIO_PHONE_NUMBER || ""), toE164(env.NEXT_PUBLIC_HOTLINE_E164 || config.hotlineE164)].filter((x): x is string => Boolean(x)));
}
export const isLoopNumber = (phone: string, env: Record<string, string | undefined> = process.env) => loopNumbers(env).has(toE164(phone) ?? phone);

/** "•••7585" */
export const last4 = (phone: string) => `•••${phone.replace(/\D/g, "").slice(-4)}`;

/** Parse "Label | phone | seconds" lines. Bad lines are reported, not silently dropped. */
export function parseTargets(text: string): { targets: RouteTarget[]; errors: string[] } {
  const targets: RouteTarget[] = [];
  const errors: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("|").map((x) => x.trim());
    const [label, phoneRaw, secRaw] = parts.length === 1 ? ["", parts[0], ""] : parts;
    const phone = toE164(phoneRaw);
    if (!phone) {
      errors.push(`Not a US or Canada phone number: "${line}"`);
      continue;
    }
    const sec = secRaw ? Number(secRaw) : 20;
    if (!Number.isInteger(sec) || sec < RING_MIN || sec > RING_MAX) {
      errors.push(`Ring time must be ${RING_MIN} to ${RING_MAX} seconds: "${line}"`);
      continue;
    }
    if (isLoopNumber(phone)) {
      errors.push(`${last4(phone)} forwards back to the hotline, so it can't ring a person. Use a staff member's own mobile number: "${line}"`);
      continue;
    }
    targets.push({ label: label || phone, phone, ringSeconds: sec });
  }
  return { targets, errors };
}

/** The numbers to ring, in order. Falls back to the single forwarding number used before routing existed. */
export function routeTargets(s: Pick<Settings, "operatorTargets">): RouteTarget[] {
  const { targets } = parseTargets(s.operatorTargets || "");
  if (targets.length) return targets;
  const fallback = toE164(config.forwardPhone());
  return fallback && !isLoopNumber(fallback) ? [{ label: "Office", phone: fallback, ringSeconds: 25 }] : [];
}

/** One-line summary for the settings page, e.g. "Rings Abraham (20s) → Office (15s) → voicemail". */
export function routeSummary(targets: RouteTarget[], mode: string) {
  if (!targets.length) return "No one to ring: callers go straight to voicemail.";
  const names = targets.map((t) => `${t.label} ${last4(t.phone)} (${t.ringSeconds}s)`);
  return mode === "simultaneous" ? `Rings ${names.join(" + ")} at the same time → voicemail` : `Rings ${names.join(" → ")} → voicemail`;
}

/**
 * Lines that ring a live employee. The id is fixed (it names the ring list, voicemail box and alerts in Admin and the
 * database); the number callers press can change (Abraham, Nov 11, 2026 menu): customer service (id 4) is main-menu
 * key 3; schools and corporate bookings (id 8) is key 9 inside the bookings menu (extension 19); 0 is the operator.
 */
export const RING_KEYS = ["2", "4", "5", "6", "8", "0"] as const;
export type RingKey = (typeof RING_KEYS)[number];

/** The extension number callers press (and staff hear) for each line, plus key 9's voicemail-only box. */
export const EXTENSION_NUMBER: Record<RingKey | "9", string> = { "2": "2", "4": "3", "5": "5", "6": "6", "8": "", "0": "0", "9": "9" };

export const RING_KEY_LABELS: Record<RingKey, string> = {
  "2": "Extension 2: Equipment instructions and guidance",
  "4": "Extension 3: Customer service",
  "5": "Extension 5: Questions or problems during a rental",
  "6": "Extension 6: Delivery and pickup information",
  "8": "Bookings menu 9: Schools and Corporate Orders (no extension number)",
  "0": "Extension 0: Operator",
};

/** Each line's name as staff hear it (Admin, Phone settings; empty uses these). */
export const RING_KEY_DEFAULT_NAMES: Record<RingKey, string> = {
  "2": "Equipment Instructions and Guidance",
  "4": "Customer Service",
  "5": "Rental Issues",
  "6": "Delivery and Pickup",
  "8": "Schools and Corporate Orders",
  "0": "Operator",
};

/** Key 9 is the general voicemail (feedback and comments greeting; no one rings). */
export const FEEDBACK_KEY_DEFAULT_NAME = "Feedback and Comments";

export function extensionName(s: Partial<Record<`ringName${RingKey | "9"}`, string>>, k: RingKey | "9"): string {
  return (s[`ringName${k}`] || "").replace(/\s+/g, " ").trim() || (k === "9" ? FEEDBACK_KEY_DEFAULT_NAME : RING_KEY_DEFAULT_NAMES[k]);
}

/** "Extension 3, Customer Service": how a line or box is shown in alerts (the name always fresh from Admin). */
export const extensionLabel = (s: Partial<Record<`ringName${RingKey | "9"}`, string>>, k: RingKey | "9") =>
  EXTENSION_NUMBER[k] ? `Extension ${EXTENSION_NUMBER[k]}, ${extensionName(s, k)}` : extensionName(s, k); // schools and corporate: no number

/**
 * What a staff member hears when they answer a forwarded call (Abraham, approved word for word; the extension number
 * and name come from Admin): "Call from Hup Up Attractions, extension 3, Customer Service. Press 1 to accept, or
 * press 2 to reject."
 */
export function staffAnnouncement(
  k: RingKey,
  name: string,
  custom?: string | null,
  // The wording from Hotline prompts (staff_whisper / staff_whisper_no_number), so it can be edited in Admin
  templates: { withNumber: string; noNumber: string } = {
    withNumber: "Call from Hup Up Attractions, extension {number}, {name}. Press 1 to accept, or press 2 to reject.",
    noNumber: "Call from Hup Up Attractions, {name} extension. Press 1 to accept, or press 2 to reject.",
  },
): string {
  if (custom?.trim()) return custom.trim(); // this extension's own announcement (Phone settings)
  const t = EXTENSION_NUMBER[k] ? templates.withNumber : templates.noNumber;
  return t.replace(/\{number\}/g, EXTENSION_NUMBER[k]).replace(/\{name\}/g, name);
}

type RingSettings = Pick<Settings, "operatorTargets" | "operatorMode" | "operatorAcceptPrompt"> &
  Partial<Record<`ringTargets${"2" | "4" | "5" | "6" | "8"}`, string>> &
  Partial<Record<`ringMode${"2" | "4" | "5" | "6" | "8"}`, string>> &
  Partial<Record<`ringAccept${"2" | "4" | "5" | "6" | "8"}`, boolean>>;

/** The list a key rings. An empty list for 2, 4, 5, 6 or 8 falls back to the operator list (0). */
export function ringListFor(s: RingSettings, key: RingKey): { targets: RouteTarget[]; mode: string; accept: boolean; usesOperatorList: boolean } {
  if (key !== "0") {
    const own = parseTargets(s[`ringTargets${key}`] || "").targets;
    if (own.length) return { targets: own, mode: s[`ringMode${key}`] || "sequential", accept: s[`ringAccept${key}`] !== false, usesOperatorList: false };
  }
  return { targets: routeTargets(s), mode: s.operatorMode, accept: s.operatorAcceptPrompt, usesOperatorList: key !== "0" };
}

/* ---------------- When a line rings (Abraham, Phone Menu v3) ---------------- */

/** How many times the list rings before voicemail (each ring = that number's ring seconds). */
export function ringAttempts(s: Partial<Record<`ringAttempts${RingKey}`, string | number>>, k: RingKey): number {
  const n = Number(s[`ringAttempts${k}`] ?? 3);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : 3;
}

/** Minutes since local midnight in New York. */
function nyMinutes(at: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).split(":").map(Number);
  return h * 60 + m;
}

/**
 * Does this line ring right now? During office hours every line rings. Shabbos and Yom Tov (and from candle lighting
 * on Erev): nothing rings. After hours only lines with the after-hours switch on ring; key 6 only 8:00 AM to 10:30 PM,
 * and on Friday and Erev Yom Tov only until 4:00 PM or an hour before candle lighting, whichever is earlier.
 */
export function lineRingsNow(
  k: RingKey,
  at: Date,
  s: Partial<Record<`ringAfterHours${RingKey}`, boolean>>,
  cal: { officeOpen: boolean; shabbosOrYomTov: boolean; candleLighting: Date | null },
): boolean {
  if (cal.shabbosOrYomTov) return false;
  if (cal.candleLighting && at >= cal.candleLighting) return false;
  if (cal.officeOpen) return true;
  if (!s[`ringAfterHours${k}`]) return false;
  if (k !== "6") return true;
  const now = nyMinutes(at);
  let end = 22 * 60 + 30;
  if (cal.candleLighting) end = Math.min(16 * 60, nyMinutes(new Date(cal.candleLighting.getTime() - 60 * 60_000)));
  return now >= 8 * 60 && now < end;
}

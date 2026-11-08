import { config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import type { Settings } from "@/lib/settings";

/** Who rings when a caller presses 0 ("Speak to someone"). Edited in /admin/settings. */
export type RouteTarget = { label: string; phone: string; ringSeconds: number };

export const RING_MIN = 5;
export const RING_MAX = 60;

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
    targets.push({ label: label || phone, phone, ringSeconds: sec });
  }
  return { targets, errors };
}

/** The numbers to ring, in order. Falls back to the single forwarding number used before routing existed. */
export function routeTargets(s: Pick<Settings, "operatorTargets">): RouteTarget[] {
  const { targets } = parseTargets(s.operatorTargets || "");
  if (targets.length) return targets;
  const fallback = toE164(config.forwardPhone());
  return fallback ? [{ label: "Office", phone: fallback, ringSeconds: 25 }] : [];
}

/** One-line summary for the settings page, e.g. "Rings Abram (20s) → Office (15s) → voicemail". */
export function routeSummary(targets: RouteTarget[], mode: string) {
  if (!targets.length) return "No one to ring: callers go straight to voicemail.";
  const names = targets.map((t) => `${t.label} (${t.ringSeconds}s)`);
  return mode === "simultaneous" ? `Rings ${names.join(" + ")} at the same time → voicemail` : `Rings ${names.join(" → ")} → voicemail`;
}

/** Main-menu keys that ring a live employee. "0" is the operator list (operatorTargets). */
export const RING_KEYS = ["2", "4", "5", "6", "8", "0"] as const;
export type RingKey = (typeof RING_KEYS)[number];
export const RING_KEY_LABELS: Record<RingKey, string> = {
  "2": "Key 2: Equipment instructions and guidance",
  "4": "Key 4: Customer service",
  "5": "Key 5: Questions or problems during a rental",
  "6": "Key 6: Delivery and pickup information",
  "8": "Key 8: Schools, corporate events and organizations",
  "0": "Key 0: Operator",
};

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

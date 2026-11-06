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

import { toE164 } from "@/lib/phone";

/** Caller blocking (plan Round 8A item 13). Checked before the greeting; blocked callers get a busy signal. */
export type BlockRule = { pattern: string; note: string };

const WITHHELD = new Set(["", "anonymous", "restricted", "unknown", "unavailable", "private", "+266696687", "+86282452253", "+8656696"]);

export function parseBlockList(text: string): BlockRule[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [pattern, ...rest] = l.split("|");
      return { pattern: normalizePattern(pattern.trim()), note: rest.join("|").trim() };
    })
    .filter((r) => r.pattern);
}

/** Exact numbers become E.164; patterns keep * and ? (digits only otherwise); "withheld" stays as is. */
export function normalizePattern(p: string): string {
  if (/^withheld$/i.test(p)) return "withheld";
  if (/[*?]/.test(p)) {
    const s = p.replace(/[^\d*?+]/g, "");
    return /^\+/.test(s) ? s : `+1${s}`;
  }
  return toE164(p) ?? "";
}

export function isWithheld(from: string | null | undefined) {
  return WITHHELD.has((from || "").trim().toLowerCase());
}

/** The first rule that matches this caller, or null. */
export function matchBlock(from: string | null | undefined, rules: BlockRule[]): BlockRule | null {
  const withheld = isWithheld(from);
  const num = withheld ? null : toE164(from || "") || (from || "").trim();
  for (const r of rules) {
    if (r.pattern === "withheld") {
      if (withheld) return r;
      continue;
    }
    if (!num) continue;
    const re = new RegExp(`^${r.pattern.replace(/[+]/g, "\\+").replace(/\*/g, "\\d*").replace(/\?/g, "\\d")}$`);
    if (re.test(num)) return r;
  }
  return null;
}

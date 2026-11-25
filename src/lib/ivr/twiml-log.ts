/**
 * Live line check (Nov 25, 2026, after Abraham heard stray numbers): one short log line per phone step, so the Vercel
 * runtime log shows exactly what a caller heard. Recordings by id (no links or signatures), spoken words as said.
 * No phone numbers or names are written: names are said through the name link (shown as "name"), and digits in
 * spoken text longer than 4 are masked.
 */
export function twimlSummary(action: string, xml: string): string {
  const parts: string[] = [];
  const re = /<Play>([^<]*)<\/Play>|<Say[^>]*>([\s\S]*?)<\/Say>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) {
      const url = m[1];
      const rec = /\/api\/voice-audio\/prompt\/(\d+)/.exec(url);
      if (rec) parts.push(`rec#${rec[1]}`);
      else if (/\/voice-audio\/name/.test(url)) parts.push("name");
      else if (/pause-500ms/.test(url)) parts.push("~");
      else if (/tone\.wav/.test(url)) parts.push("tone");
      else parts.push("play");
    } else {
      const text = m[2].replace(/<[^>]+>/g, "").replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\d{5,}/g, "#####").trim();
      if (text) parts.push(`"${text.slice(0, 80)}"`);
    }
  }
  return `[voice] ${action}: ${parts.join(" | ") || "(nothing spoken)"}`;
}

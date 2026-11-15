import { writeFileSync } from "node:fs";
import { allSlots } from "../src/lib/recording-slots";

/**
 * Writes docs/recording-slots.md: every recording slot's exact text (whole lines, pieces of lines with changing
 * parts, numbers, dates, times, letters A to Z). Rental names come from the live catalog and are on the Admin page.
 * The live status (Waiting for Abraham, Confirmed, Recorded, Uploaded) is on Admin > Hotline prompts > Recording text list.
 */
const slots = allSlots();
const groups = new Map<string, typeof slots>();
for (const s of slots) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
let out = `# Hotline recording text list\n\n${slots.length} slots, plus one per rental name (on the Admin page). Hark records a slot in Achird only after Abraham confirms its exact text, with every comma, period and exclamation mark. Live status: Admin > Phone > Hotline prompts > Recording text list.\n`;
for (const [g, list] of groups) {
  out += `\n## ${g}\n\n| Slot | Line | Exact text |\n|---|---|---|\n`;
  for (const s of list) out += `| ${s.key} | ${s.label.replace(/\|/g, "/")} | ${s.text.replace(/\|/g, "/")} |\n`;
}
writeFileSync("docs/recording-slots.md", out);
console.log(`${slots.length} slots`);

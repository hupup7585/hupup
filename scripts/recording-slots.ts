import { writeFileSync } from "node:fs";
import { PROMPTS, promptRecordable, type PromptKey } from "../src/lib/ivr/prompts";

/** Writes docs/recording-slots.md: every hotline line that takes a recording (no changing parts), by group. */
const all = Object.entries(PROMPTS) as [PromptKey, { group: string; label: string; text: string; pending?: boolean }][];
const rec = all.filter(([k]) => promptRecordable(k));
const groups = new Map<string, typeof rec>();
for (const r of rec) groups.set(r[1].group, [...(groups.get(r[1].group) ?? []), r]);
let out = `# Hotline recording slots\n\n${rec.length} lines take a recording. The other ${all.length - rec.length} lines have changing parts (names, dates, amounts) and are spoken by the system in the Achird voice.\n`;
for (const [g, list] of groups) {
  out += `\n## ${g}\n\n| Slot | Line in Admin | Status | Wording |\n|---|---|---|---|\n`;
  for (const [k, p] of list) out += `| ${k} | ${p.label} | ${p.pending ? "Draft, wait for Abraham" : "Approved"} | ${p.text.replace(/\|/g, "/")} |\n`;
}
writeFileSync("docs/recording-slots.md", out);
console.log(`${rec.length} recordable of ${all.length}`);

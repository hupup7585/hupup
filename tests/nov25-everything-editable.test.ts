import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { configDefs } from "@/lib/config-registry";
import { SETTING_DEFAULTS } from "@/lib/settings";

/* Batch 2 item 7 (Abraham, Nov 25, 2026): every setting the system uses can be changed in Admin. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
}

// Not shown in Admin on purpose: no part of the system reads them (kept so old saved values do not break)
const UNUSED = ["smsHelpReplyEnabled", "smsHelpText", "supportPhone", "phonePayDeclinesPerDay", "operatorAcceptText"];
// Saved by a name built from the key (ringName0, ringName2 ...) or from the music place
// Phone timing (Phase 3): generated from src/lib/ivr/timers.ts and edited on Phone timing and All settings
const DYNAMIC = /^(ring[A-Za-z]+\d|music[A-Z]|timer[A-Z])/;

describe("everything editable", () => {
  it("every setting has an Admin field (or is listed above with the reason)", () => {
    const admin = [...files("src/app/admin"), ...files("src/components")].map((f) => readFileSync(f, "utf8")).join("\n");
    // A setting marked editable in the registry is edited (draft first) on All settings, which lists every setting
    const editable = new Set(configDefs().filter((d) => d.mode === "edit").map((d) => d.key));
    const missing = Object.keys(SETTING_DEFAULTS).filter((k) => !UNUSED.includes(k) && !DYNAMIC.test(k) && !editable.has(k) && !new RegExp(`\\b${k}\\b`).test(admin));
    expect(missing).toEqual([]);
  });
  // (the generated where-used list and the explanations file name every setting, so they are left out)
  it("the settings listed as unused are really not read anywhere", () => {
    const lib = files("src").filter((f) => !f.endsWith("lib/settings.ts") && !/(config-usage\.generated|config-explanations|config-registry|setting-rules)\.ts$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const k of UNUSED.filter((x) => x !== "phonePayDeclinesPerDay")) expect(new RegExp(`\\b${k}\\b`).test(lib), k).toBe(false);
  });
});

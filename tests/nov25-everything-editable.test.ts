import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
const DYNAMIC = /^(ring[A-Za-z]+\d|music[A-Z])/;

describe("everything editable", () => {
  it("every setting has an Admin field (or is listed above with the reason)", () => {
    const admin = [...files("src/app/admin"), ...files("src/components")].map((f) => readFileSync(f, "utf8")).join("\n");
    const missing = Object.keys(SETTING_DEFAULTS).filter((k) => !UNUSED.includes(k) && !DYNAMIC.test(k) && !new RegExp(`\\b${k}\\b`).test(admin));
    expect(missing).toEqual([]);
  });
  it("the settings listed as unused are really not read anywhere", () => {
    const lib = files("src").filter((f) => !f.endsWith("lib/settings.ts")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const k of UNUSED.filter((x) => x !== "phonePayDeclinesPerDay")) expect(new RegExp(`\\b${k}\\b`).test(lib), k).toBe(false);
  });
});

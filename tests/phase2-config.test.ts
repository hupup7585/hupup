import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Admin handoff Phase 2 (Nov 26, 2026): one typed registry of every setting, drafts that never affect customers,
 * publish (the Owner's approval; customer words need "I approve these exact words"), discard, undo as a new version,
 * full history, validation, protected settings, secrets never listed, and no change to the phone line by itself. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SETTING_DEFAULTS, getSettings } from "@/lib/settings";
import { configDef, configDefs, validateConfig } from "@/lib/config-registry";
import { ConfigError, configHistory, currentDraft, discardDraft, publishDraft, saveDraft, undoLast, unwrap } from "@/lib/config-versions";
import { FEATURE_SWITCHES } from "@/lib/feature-switches";

const live = async (k: string) => ((await getSettings()) as Record<string, unknown>)[k];

describe("the registry", () => {
  it("lists every setting (never a secret), each with a label, group, type, default and where it is used", () => {
    const defs = configDefs();
    const keys = Object.keys(SETTING_DEFAULTS).filter((k) => !/(apikey|api_key|secret|token|password|pin$|webhook)/i.test(k));
    expect(defs.map((d) => d.key).sort()).toEqual(keys.sort());
    for (const d of defs) {
      expect(d.label.length, d.key).toBeGreaterThan(2);
      expect(d.group, d.key).toBeTruthy();
      expect(d.type, d.key).toBeTruthy();
    }
    expect(configDef("smsTestOnly")?.usedBy.length).toBeGreaterThan(0); // where it is used, shown before a change
  });
  it("checks values: numbers within limits, choices, phone numbers, protected settings", () => {
    const hold = configDef("phoneLinkHoldMinutes")!;
    expect(validateConfig(hold, "15")).toEqual({ ok: true, value: "15" });
    expect(validateConfig(hold, "0")).toMatchObject({ ok: false });
    expect(validateConfig(hold, "abc")).toMatchObject({ ok: false });
    expect(validateConfig(hold, "2.5")).toMatchObject({ ok: false, error: "Enter a whole number." });
    expect(validateConfig(configDef("erevShabbosClose")!, "noon")).toMatchObject({ ok: false });
    expect(validateConfig(configDef("calendarEnabled")!, "no")).toMatchObject({ ok: false, error: expect.stringContaining("protected") });
    expect(validateConfig(configDef("smsTestNumbers")!, "+18457777585\n123")).toMatchObject({ ok: false, error: expect.stringContaining("Not a phone number: 123") });
    expect(validateConfig(configDef("hoursSchedules")!, "{}")).toMatchObject({ ok: false, error: expect.stringContaining("own page") });
    expect(validateConfig(configDef("salesTaxPercent")!, "-1")).toMatchObject({ ok: false });
  });
});

describe("draft, publish, discard, undo", () => {
  it("a draft never changes what customers get; publishing does, with the history and the activity log", async () => {
    expect(await live("phoneLinkHoldMinutes")).toBe("10");
    await saveDraft("phoneLinkHoldMinutes", "12", 1, "busy season");
    expect(await live("phoneLinkHoldMinutes")).toBe("10"); // still live as before
    expect(unwrap((await currentDraft("phoneLinkHoldMinutes"))?.value)).toBe("12");
    await publishDraft("phoneLinkHoldMinutes", 1);
    expect(await live("phoneLinkHoldMinutes")).toBe("12");
    const h = await configHistory("phoneLinkHoldMinutes");
    expect(h[0]).toMatchObject({ status: "live", reason: "busy season", publishedBy: 1 });
    expect([unwrap(h[0].previous), unwrap(h[0].value)]).toEqual(["10", "12"]);
    const log = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, "phoneLinkHoldMinutes"));
    expect(log.map((l) => l.action)).toEqual(["config.draft_saved", "config.published"]);
  });
  it("undo makes the value from before a new draft; publishing it restores it, history kept", async () => {
    await undoLast("phoneLinkHoldMinutes", 1);
    expect(await live("phoneLinkHoldMinutes")).toBe("12");
    expect(unwrap((await currentDraft("phoneLinkHoldMinutes"))?.value)).toBe("10");
    await publishDraft("phoneLinkHoldMinutes", 1);
    expect(await live("phoneLinkHoldMinutes")).toBe("10");
    expect((await configHistory("phoneLinkHoldMinutes")).length).toBe(2); // nothing erased
  });
  it("discard drops the draft; the live value never moved", async () => {
    await saveDraft("salesTaxPercent", "9", 1);
    await discardDraft("salesTaxPercent", 1);
    expect(await currentDraft("salesTaxPercent")).toBeNull();
    expect(await live("salesTaxPercent")).toBe("8.125");
  });
  it("customer words publish only with the exact-words approval", async () => {
    await saveDraft("catalogEmailSubjectText", "Our catalog", 1);
    await expect(publishDraft("catalogEmailSubjectText", 1)).rejects.toBeInstanceOf(ConfigError);
    expect(await live("catalogEmailSubjectText")).toBe((SETTING_DEFAULTS as Record<string, unknown>).catalogEmailSubjectText);
    await discardDraft("catalogEmailSubjectText", 1);
  });
  it("a value equal to the live one is not a draft; a bad value is refused with a reason", async () => {
    await expect(saveDraft("phoneLinkHoldMinutes", "10", 1)).rejects.toThrow("already the live value");
    await expect(saveDraft("phoneLinkHoldMinutes", "999", 1)).rejects.toThrow("The highest allowed is 240.");
  });
});

describe("Admin page, permissions and switches", () => {
  it("Owner only, every action checks the Owner on the server; in the side menu", () => {
    expect(readFileSync("src/app/admin/(app)/config/page.tsx", "utf8")).toContain("await requireOwner()");
    expect(readFileSync("src/app/admin/(app)/config/actions.ts", "utf8")).toMatch(/async function run[\s\S]*await requireOwner\(\)/);
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('"/admin/config", Settings, "All settings", O]');
  });
  it("the feature switch registry lists every held feature; code-set ones say Needs Claude to connect", () => {
    const ids = FEATURE_SWITCHES.map((f) => f.id);
    for (const id of ["join_invite", "stripe_phone_pay", "live_refunds", "vm_call_out", "hebrew_dates", "directory_lookup", "pay_dates"]) expect(ids).toContain(id);
    expect(FEATURE_SWITCHES.find((f) => f.id === "join_invite")?.state).toBe("Off");
    expect(readFileSync("src/app/admin/(app)/config/page.tsx", "utf8")).toContain("Needs Claude to connect");
  });
});

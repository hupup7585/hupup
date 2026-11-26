import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Admin handoff Phase 2 (Nov 26, 2026), with Hark's Phase 1-2 review fixes (C1, H1-H6, M1, M2, M5-M8, L3, L11):
 * one explicit entry for every setting; All settings edits only what it can check completely (same limits as the
 * code); other settings are read-only with their page; protected, paid, unused and system settings are locked.
 * Drafts never affect customers; Publish makes exactly the draft on screen live, in one transaction, only when the
 * setting did not change since; every write anywhere keeps history; Undo is checked like any change. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SETTING_DEFAULTS, getSettings, rawSetting, saveSetting } from "@/lib/settings";
import { configDef, configDefs, specFor, validateConfig } from "@/lib/config-registry";
import { ConfigError, configHistory, currentDraft, discardDraft, publishDraft, saveDraft, undoLast, unwrap } from "@/lib/config-versions";
import { FEATURE_SWITCHES } from "@/lib/feature-switches";

const live = async (k: string) => ((await getSettings()) as Record<string, unknown>)[k];

describe("the registry: an explicit entry for every setting", () => {
  it("every setting (never a secret) has an explicit entry, label, group and mode; nothing is guessed", () => {
    const keys = Object.keys(SETTING_DEFAULTS).filter((k) => !/(apikey|api_key|secret|token|password|pin$|webhook)/i.test(k));
    expect(configDefs().map((d) => d.key).sort()).toEqual(keys.sort());
    for (const k of keys) expect(specFor(k), k).not.toBeNull();
    for (const d of configDefs()) {
      expect(d.label.length, d.key).toBeGreaterThan(2);
      expect(["edit", "page", "locked"]).toContain(d.mode);
      if (d.mode === "edit") expect(d.rule, d.key).toBeTruthy();
      if (d.mode === "page") expect(d.page, d.key).toMatch(/^\/admin\//);
    }
  });
  it("H1: the values the review proved were accepted are all refused now", () => {
    const bad: [string, string][] = [
      ["hoursMonThu", "banana"], ["ringAfterFrom6", "25:99"], ["operatorTargets", "call bob"], ["calendarOverrides", "next friday open"],
      ["operatorMode", "everyone"], ["phoneCardProvider", "Stripe "], ["solaPhonePayNumber", "12"], ["glApprovalThresholdCents", "five hundred"],
      ["glFiscalYearStartMonth", "13"], ["deliveryPromoStart", "tomorrow"], ["blockedCallers", "*"], ["ringAnnounce0", "hello"],
      ["musicStaffWait", "no-such-song"], ["hoursMotzeiOpen", "whenever"],
    ];
    for (const [k, v] of bad) expect(validateConfig(configDef(k)!, v).ok, `${k}=${v}`).toBe(false);
  });
  it("C1: the Shabbes and Yom Tov settings are not changed from this list (their page checks them)", () => {
    for (const k of ["reopenAfter", "candleLightingMinutes", "erevShabbosClose", "erevYomTovClose", "calendarLatitude", "calendarLongitude"]) {
      expect(configDef(k)?.mode, k).toBe("page");
      expect(validateConfig(configDef(k)!, "0").ok, k).toBe(false);
    }
    expect(validateConfig(configDef("calendarEnabled")!, "no")).toMatchObject({ ok: false, error: expect.stringContaining("protected") });
  });
  it("H5: settings that need the Owner's OK or cost money are locked here", () => {
    for (const k of ["googleLiveVoice", "callRecording"]) expect(configDef(k)?.mode, k).toBe("locked");
    for (const k of ["solaPhonePayOn", "solaPhonePayOwnerOnly", "phoneCardProvider", "smsTestOnly", "solaPhonePayDigits", "solaPhonePayNumber", "solaPhonePayBackup", "solaPhonePayCustomCapCents", "ownerUsername"])
      expect(configDef(k)?.mode, k).not.toBe("edit");
  });
  it("H6: customer words are marked explicitly (website, emails, catalog email); staff-only words are not", () => {
    for (const k of ["hoursWebsiteNote", "emailMailingAddress", "emailSignature", "catalogName", "catalogEmailSubjectText", "catalogEmailBodyText"]) expect(configDef(k)?.wording, k).toBe(true);
    for (const k of ["operatorAcceptText", "offersIntro", "ringAnnounce0"]) expect(configDef(k)?.wording, k).toBe(false);
  });
  it("M8: settings nothing reads are locked as not in use", () => {
    for (const k of ["smsHelpText", "smsHelpReplyEnabled", "supportPhone", "operatorAcceptText", "phonePayDeclinesPerDay"]) expect(configDef(k)?.locked, k).toMatch(/Not in use/);
  });
  it("editable ones: numbers checked strictly within the code's limits (L3); on/off; no stray line endings", () => {
    const hold = configDef("phoneLinkHoldMinutes")!;
    expect(validateConfig(hold, "15")).toEqual({ ok: true, value: "15" });
    for (const v of ["0", "241", "abc", "2.5", "0x10", "1e2", " "]) expect(validateConfig(hold, v).ok, v).toBe(false);
    expect(validateConfig(configDef("nameSpeakingRate")!, "1.25")).toEqual({ ok: true, value: "1.25" });
    expect(validateConfig(configDef("timerNoKey")!, "31").ok).toBe(false);
    expect(validateConfig(configDef("disconnectGoodbyeOn")!, "off")).toEqual({ ok: true, value: false });
  });
});

describe("draft, publish, discard, undo", () => {
  it("a draft never changes what customers get; publishing that exact draft does, with history and the activity log", async () => {
    expect(await live("phoneLinkHoldMinutes")).toBe("10");
    await expect(saveDraft("phoneLinkHoldMinutes", "12", 1)).rejects.toThrow("reason");
    const d = await saveDraft("phoneLinkHoldMinutes", "12", 1, "busy season");
    expect(await live("phoneLinkHoldMinutes")).toBe("10");
    expect(unwrap((await currentDraft("phoneLinkHoldMinutes"))?.value)).toBe("12");
    await publishDraft("phoneLinkHoldMinutes", d.id, 1);
    expect(await live("phoneLinkHoldMinutes")).toBe("12");
    const h = await configHistory("phoneLinkHoldMinutes");
    expect(h[0]).toMatchObject({ status: "live", reason: "busy season", publishedBy: 1 });
    expect([unwrap(h[0].previous), unwrap(h[0].value)]).toEqual(["10", "12"]);
    const log = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, "phoneLinkHoldMinutes"));
    expect(log.map((l) => l.action)).toEqual(["config.draft_saved", "config.published"]);
  });
  it("H2: publish names the draft; an older draft replaced in another tab cannot be published", async () => {
    const a = await saveDraft("adminLinkHoldMinutes", "30", 1, "tab A");
    const b = await saveDraft("adminLinkHoldMinutes", "200", 1, "tab B");
    await expect(publishDraft("adminLinkHoldMinutes", a.id, 1)).rejects.toBeInstanceOf(ConfigError);
    expect(await live("adminLinkHoldMinutes")).toBe("25");
    await publishDraft("adminLinkHoldMinutes", b.id, 1);
    expect(await live("adminLinkHoldMinutes")).toBe("200");
    await expect(publishDraft("adminLinkHoldMinutes", b.id, 1)).rejects.toThrow("no longer waiting"); // double click (L1)
  });
  it("H3: a change on another page is in the history; a draft made before it cannot overwrite it", async () => {
    const d = await saveDraft("nameSpeakingRate", "1.3", 1, "slower names");
    await saveSetting("nameSpeakingRate", "1.2", 1, "Saved on Settings");
    expect((await configHistory("nameSpeakingRate"))[0]).toMatchObject({ status: "live", reason: "Saved on Settings" });
    await expect(publishDraft("nameSpeakingRate", d.id, 1)).rejects.toThrow("changed since you made the draft");
    expect(await live("nameSpeakingRate")).toBe("1.2");
  });
  it("undo: restores the value before the last change, as a draft; refused while a draft waits (M6)", async () => {
    await undoLast("phoneLinkHoldMinutes", 1);
    await expect(undoLast("phoneLinkHoldMinutes", 1)).rejects.toThrow("draft is waiting");
    const draft = await currentDraft("phoneLinkHoldMinutes");
    expect(unwrap(draft?.value)).toBe("10");
    expect(await live("phoneLinkHoldMinutes")).toBe("12");
    await publishDraft("phoneLinkHoldMinutes", draft!.id, 1);
    expect(await live("phoneLinkHoldMinutes")).toBe("10");
    expect((await configHistory("phoneLinkHoldMinutes")).length).toBeGreaterThanOrEqual(2); // nothing erased
  });
  it("M6: undo never brings back a value outside today's limits", async () => {
    await saveSetting("disconnectSilenceMinutes", "999" as never, 1, "old bad value");
    await saveSetting("disconnectSilenceMinutes", "4" as never, 1, "fixed");
    await expect(undoLast("disconnectSilenceMinutes", 1)).rejects.toThrow("cannot be restored");
  });
  it("M6: the value before is the stored value, never a phone number filled in from the server", async () => {
    process.env.ADMIN_PHONE = "+18455550000";
    expect(await rawSetting("smsForwardPhone")).toBe("");
    expect(await live("smsForwardPhone")).toBe("+18455550000");
    delete process.env.ADMIN_PHONE;
  });
  it("discard drops exactly that draft; the live value never moved", async () => {
    const d = await saveDraft("timerNoKey", "9", 1, "testing");
    await discardDraft("timerNoKey", d.id, 1);
    expect(await currentDraft("timerNoKey")).toBeNull();
    expect(await live("timerNoKey")).toBe("5");
  });
  it("a value equal to the live one is not a draft; a bad value is refused with a reason", async () => {
    await expect(saveDraft("phoneLinkHoldMinutes", "10", 1, "same")).rejects.toThrow("already the live value");
    await expect(saveDraft("phoneLinkHoldMinutes", "999", 1, "too long")).rejects.toThrow("from 1 to 240");
  });
  it("only one draft per setting can exist (database rule)", async () => {
    await expect(db.insert(schema.configVersions).values([{ key: "x", status: "draft" }, { key: "x", status: "draft" }])).rejects.toBeTruthy();
  });
});

describe("Admin page, permissions and switches", () => {
  it("Owner only; every action checks the Owner; publish and discard send the version; success messages are codes", () => {
    const page = readFileSync("src/app/admin/(app)/config/page.tsx", "utf8");
    expect(page).toContain("await requireOwner()");
    expect(page).toContain('name="version" value={draft.id}');
    expect(page).toContain("OK_MESSAGES[");
    const actions = readFileSync("src/app/admin/(app)/config/actions.ts", "utf8");
    expect(actions).toMatch(/async function run[\s\S]*await requireOwner\(\)/);
    expect(actions).toContain('revalidatePath("/", "layout")');
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('"/admin/config", Settings, "All settings", O]');
  });
  it("the feature switch registry lists every held feature; code-set ones say Needs Claude to connect", () => {
    const ids = FEATURE_SWITCHES.map((f) => f.id);
    for (const id of ["join_invite", "stripe_phone_pay", "live_refunds", "vm_call_out", "hebrew_dates", "directory_lookup", "pay_dates"]) expect(ids).toContain(id);
    expect(FEATURE_SWITCHES.find((f) => f.id === "join_invite")?.state).toBe("Off");
    expect(readFileSync("src/app/admin/(app)/config/page.tsx", "utf8")).toContain("Needs Claude to connect");
  });
});

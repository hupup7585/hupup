import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({ ensured: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async (sid: string) => (h.ensured.push(sid), { callSid: sid, data: {}, outcome: "browsing" }),
  getSession: async () => null,
  updateSession: async () => {},
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { matchBlock, normalizePattern, parseBlockList } from "@/lib/ivr/caller-filter";
import { handleVoice } from "@/lib/ivr/flow";
import { saveSetting } from "@/lib/settings";

describe("caller blocking patterns", () => {
  const rules = parseBlockList("(845) 555-0199 | prank\n+1800* | sales\n+1914555????\nwithheld | no caller ID");
  it("normalizes numbers and patterns", () => {
    expect(rules.map((r) => r.pattern)).toEqual(["+18455550199", "+1800*", "+1914555????", "withheld"]);
    expect(normalizePattern("845-555*")).toBe("+1845555*");
    expect(normalizePattern("nonsense")).toBe("");
  });
  it("matches exact, * any digits, ? one digit, and withheld caller ID", () => {
    expect(matchBlock("+18455550199", rules)?.note).toBe("prank");
    expect(matchBlock("+18005551234", rules)?.note).toBe("sales");
    expect(matchBlock("+19145551234", rules)?.pattern).toBe("+1914555????");
    expect(matchBlock("+191455512345", rules)).toBeNull(); // ? is exactly one digit
    expect(matchBlock("Anonymous", rules)?.pattern).toBe("withheld");
    expect(matchBlock(null, rules)?.pattern).toBe("withheld");
    expect(matchBlock("+18455550100", rules)).toBeNull();
  });
});

describe("blocked callers on the hotline", () => {
  it("get a busy signal before the greeting and are never logged; others hear the greeting", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    await saveSetting("blockedCallers", "+18455550199 | prank");
    const blocked = await handleVoice({ action: "incoming", query: new URLSearchParams(), body: { CallSid: "CAblk" }, callSid: "CAblk", from: "+18455550199" });
    expect(blocked).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>');
    expect(h.ensured).not.toContain("CAblk");
    const ok = await handleVoice({ action: "incoming", query: new URLSearchParams(), body: { CallSid: "CAok" }, callSid: "CAok", from: "+18455550100" });
    expect(ok).toContain("thanks for calling Hup Up Attractions");
    expect(h.ensured).toContain("CAok");
  });
});

describe("Owner-only controls", () => {
  it("block list, Block button and Activity are Owner-only", () => {
    const a = readFileSync("src/app/admin/(app)/settings/blocking-actions.ts", "utf8");
    expect((a.match(/await requireOwner\(\)/g) || []).length).toBe(3);
    expect(readFileSync("src/app/admin/(app)/calls/page.tsx", "utf8")).toContain('staff.role === "owner" && c.from_number');
    expect(readFileSync("src/app/admin/(app)/activity/page.tsx", "utf8")).toContain("await requireOwner()");
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('["/admin/activity", History, "Activity", O]');
  });
});

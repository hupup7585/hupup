import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham, Nov 26, 2026, 14:04 ("Go ahead, fix it"): each payment link shows its real hold time on the pay page.
 * Phone-sent links hold 10 minutes, staff and Admin links 25, read from the link's own Admin setting. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { LINK_TEXT, linkHoldKindOf } from "@/lib/late-payment";
import { clearSettingsCache, linkHoldMinutes, saveSetting } from "@/lib/settings";

const shown = async (o: { linkHoldKind?: string | null; channel?: string | null }) => LINK_TEXT.cardNote(await linkHoldMinutes(linkHoldKindOf(o)));

beforeAll(() => clearSettingsCache?.());

describe("the pay page says the link's own hold", () => {
  it("a phone-sent link shows 10 minutes", async () => {
    expect(await shown({ linkHoldKind: "phone", channel: "PHONE" })).toBe("This link holds your booking for 10 minutes. Once you open it, you get 4 more minutes to pay.");
  });
  it("a staff link (Admin or New booking) shows 25 minutes, even on a phone order", async () => {
    expect(await shown({ linkHoldKind: "admin", channel: "PHONE" })).toContain("for 25 minutes.");
    expect(await shown({ channel: "POS" })).toContain("for 25 minutes.");
  });
  it("older links with no record follow the channel, as before", () => {
    expect(linkHoldKindOf({ channel: "PHONE" })).toBe("phone");
    expect(linkHoldKindOf({ channel: "WEB" })).toBe("phone");
    expect(linkHoldKindOf({ channel: "POS" })).toBe("admin");
  });
  it("changing the Admin setting changes the minutes shown", async () => {
    await saveSetting("adminLinkHoldMinutes", "30", null);
    await saveSetting("phoneLinkHoldMinutes", "12", null);
    clearSettingsCache?.();
    expect(await shown({ linkHoldKind: "admin" })).toContain("for 30 minutes.");
    expect(await shown({ linkHoldKind: "phone" })).toContain("for 12 minutes.");
  });
  it("only the number changes: the approved words stay word for word", () => {
    expect(LINK_TEXT.cardNote(10)).toBe("This link holds your booking for 10 minutes. Once you open it, you get 4 more minutes to pay.");
  });
  it("whoever sends the link records which hold it has; the page never shows a fixed number", () => {
    expect(readFileSync("src/app/admin/(app)/orders/actions.ts", "utf8")).toMatch(/linkHoldMinutes\("admin"\)\)[^}]*linkHoldKind: "admin"/);
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toMatch(/linkHoldMinutes\("phone"\)\), linkHoldKind: "phone"/);
    const page = readFileSync("src/app/pay/[orderId]/page.tsx", "utf8");
    expect(page).toContain("LINK_TEXT.cardNote(await linkHoldMinutes(linkHoldKindOf(o)))");
    expect(page.split("\n").filter((l) => !l.trim().startsWith("//") && !/\/\/.*10 minutes/.test(l)).join("\n")).not.toMatch(/\b10 minutes\b/); // shown text only (comments aside)
  });
});

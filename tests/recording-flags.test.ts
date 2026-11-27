import { describe, expect, it, vi } from "vitest";

/* "Needs a new recording" (Abraham, Nov 27, 2026, 1:20 AM): a value spoken inside recordings changes -> the linked
   slots are flagged (with a text draft), listed in the banner, the Owner is emailed once; changed back -> cleared;
   a new recording put on the line clears it too. */
const h = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async (_to: string, _subject: string, body: string) => (h.emails.push(body), { sent: true }), sendSms: async () => ({ sent: true }) }));

import { getSettings, saveSetting } from "@/lib/settings";
import { clearRecordingFlag, defaultLinks, linkedValueChanged, recordingFlags } from "@/lib/recording-flags";

const flags = async () => recordingFlags((await getSettings()) as never);

describe("needs a new recording", () => {
  it("the payment-link hold minutes: the ten-minute lines are flagged, with a draft and one email; changed back: cleared", async () => {
    const tenLines = defaultLinks().find((l) => l.source === "setting:phoneLinkHoldMinutes")!.slots;
    expect(tenLines).toContain("pay_link_sent");
    await saveSetting("phoneLinkHoldMinutes", "12");
    const f = await flags();
    expect(f.map((x) => x.slot).sort()).toEqual([...tenLines].sort());
    expect(f[0]).toMatchObject({ from: "10", to: "12" });
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]).toContain("pay_link_sent: Needs a new recording: the setting Payment link hold on the phone (minutes) changed from 10 to 12.");
    const { db, schema } = await import("@/lib/db");
    const drafts = await db.select().from(schema.promptVersions);
    expect(drafts.some((d) => d.promptKey === "pay_link_sent" && /twelve minutes/.test(d.text ?? ""))).toBe(true);
    await saveSetting("phoneLinkHoldMinutes", "10");
    expect(await flags()).toEqual([]);
  });
  it("the ocean ball price: the ocean ball slots are flagged; a new recording put on the line clears its flag", async () => {
    h.emails.length = 0;
    await linkedValueChanged("product:Ocean balls:1", 1000, 1200);
    expect((await flags()).map((x) => x.slot)).toEqual(["ocean_200", "ocean_balls", "whole_ocean_200"]);
    expect((await flags())[0]).toMatchObject({ from: "$10.00", to: "$12.00" });
    expect(h.emails).toHaveLength(1);
    await clearRecordingFlag("ocean_200");
    expect((await flags()).map((x) => x.slot)).toEqual(["ocean_balls", "whole_ocean_200"]);
    await linkedValueChanged("product:Ocean balls:1", 1200, 1000); // back to the old price
    // the two still-flagged slots clear; ocean_200 got a new $12 recording, so going back to $10 needs one again
    expect((await flags()).map((x) => [x.slot, x.from, x.to])).toEqual([["ocean_200", "$12.00", "$10.00"]]);
  });
});

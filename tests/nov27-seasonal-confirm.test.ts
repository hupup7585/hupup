import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Abraham, Nov 27, 2026 (item 3): the seasonal offers sign-up confirmation, approved word for word and switched on.
 * Sent once, right away, when a number joins (Line 8 press 1, a JOIN text reply, the website box confirmed with YES),
 * also on Shabbes. Already signed up = no second text. Editable in Admin with a plain-English explanation.
 */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string }) => (h.sent.push({ to: p.to, body: p.body }), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms-inbound";
import { PROMPTS } from "@/lib/ivr/prompts";
import { SEASONAL_JOIN_CONFIRM_TEXT, sendSeasonalJoinConfirm } from "@/lib/seasonal-confirm";

const EXACT = "Hup Up Attractions: You have joined our seasonal offers. You will never miss a deal, special, or new rentals, with up to 5 messages a year. Message and data rates may apply. Reply STOP to stop, or HELP for help.";
const gotCatalog = (to: string) => db.insert(schema.messages).values({ direction: "out", toNumber: to, contactPhone: to, body: "catalog", kind: "system", event: "catalog_reply", status: "sent" });
const text = (from: string, body: string, sid: string) => handleInboundSms({ From: from, To: "+18454157585", Body: body, MessageSid: sid });
const to = (n: string) => h.sent.filter((m) => m.to === n).map((m) => m.body);
const pinned = process.env.HUP_CALENDAR_NOW;
process.env.TWILIO_PHONE_NUMBER = "+18454157585";
afterEach(() => {
  process.env.HUP_CALENDAR_NOW = pinned;
});

describe("seasonal offers sign-up confirmation text", () => {
  it("is the exact approved text, and an editable Admin template with a plain-English explanation", () => {
    expect(SEASONAL_JOIN_CONFIRM_TEXT).toBe(EXACT);
    expect(PROMPTS.msg_seasonal_join_confirm).toMatchObject({ group: "Texts and emails", message: true, text: EXACT });
    expect(PROMPTS.msg_seasonal_join_confirm.label).toMatch(/Texted once, right away, when a number joins/);
    expect(PROMPTS.msg_seasonal_join_confirm.label).toMatch(/never gets it a second time/);
  });

  it("JOIN reply: exactly this text once; a second JOIN sends nothing more", async () => {
    await gotCatalog("+18455550401");
    await text("+18455550401", "JOIN", "SMs1");
    expect(to("+18455550401")).toEqual([EXACT]);
    await text("+18455550401", "join", "SMs2");
    expect(to("+18455550401")).toEqual([EXACT]);
  });

  it("Line 8 press 1 (the phone join): sends this text once; already signed up = no text", async () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    const join = flow.slice(flow.indexOf("async function promoJoin"), flow.indexOf("function txPurpose"));
    expect(join).toContain("const alreadySignedUp = Boolean((await customerByPhone(to))?.marketingOptIn);");
    expect(join).toContain("await sendSeasonalJoinConfirm(to, { customerId: (await customerByPhone(to))?.id ?? null, callSid: ctx.callSid, alreadySignedUp });");
    expect(await sendSeasonalJoinConfirm("+18455550402", { callSid: "CA1" })).toBe(true);
    expect(await sendSeasonalJoinConfirm("+18455550402", { callSid: "CA2" })).toBe(false); // never a second one
    expect(to("+18455550402")).toEqual([EXACT]);
    expect(await sendSeasonalJoinConfirm("+18455550403", { alreadySignedUp: true })).toBe(false);
    expect(to("+18455550403")).toEqual([]);
  });

  it("goes out during Shabbes too (the customer asked for it)", async () => {
    process.env.HUP_CALENDAR_NOW = "2026-11-21T17:00:00Z"; // Shabbes noon
    await gotCatalog("+18455550404");
    await text("+18455550404", "JOIN", "SMs3");
    expect(to("+18455550404")).toEqual([EXACT]);
  });

  it("the Owner's edited wording in Admin is what goes out", async () => {
    await db.insert(schema.voicePrompts).values({ key: "msg_seasonal_join_confirm", text: "Hup Up Attractions: edited by the Owner. Reply STOP to stop, or HELP for help." });
    await sendSeasonalJoinConfirm("+18455550405");
    expect(to("+18455550405")).toEqual(["Hup Up Attractions: edited by the Owner. Reply STOP to stop, or HELP for help."]);
    await db.delete(schema.voicePrompts);
  });
});

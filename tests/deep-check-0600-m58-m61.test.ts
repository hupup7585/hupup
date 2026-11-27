import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Deep check 0600 M58 (a held promo sent twice after a cut-off run) and M61 (PhonePay digits checked with long values). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleSmsStatus } from "@/lib/sms-inbound";
import { digitsTemplateError } from "@/lib/sola-phonepay";

describe("M58: Twilio's status notice ties its id to our row", () => {
  it("a text whose run was cut off after Twilio accepted it gets Twilio's id, so it is never held and sent again", async () => {
    const [m] = await db
      .insert(schema.messages)
      .values({ direction: "out", toNumber: "+18455550901", contactPhone: "+18455550901", body: "Promo", kind: "marketing", status: "sending", sendAfter: new Date(Date.now() - 20 * 60_000) })
      .returning();
    await handleSmsStatus({ MessageSid: "SMm58", MessageStatus: "sent" }, m.id);
    const [after] = await db.select().from(schema.messages).where(eq(schema.messages.id, m.id));
    expect(after.twilioSid).toBe("SMm58");
    expect(after.status).toBe("sent");
    const { processHeldPromotions } = await import("@/lib/sms");
    expect((await processHeldPromotions()).sent).toBe(0);
    const [still] = await db.select().from(schema.messages).where(eq(schema.messages.id, m.id));
    expect(still.status).toBe("sent"); // not put back to "held"
  });
  it("never replaces an id already saved", async () => {
    const [m] = await db.insert(schema.messages).values({ direction: "out", toNumber: "+18455550902", contactPhone: "+18455550902", body: "Hi", kind: "transactional", status: "queued", twilioSid: "SMfirst" }).returning();
    await handleSmsStatus({ MessageSid: "SMother", MessageStatus: "sent" }, m.id);
    const [after] = await db.select().from(schema.messages).where(eq(schema.messages.id, m.id));
    expect(after.twilioSid).toBe("SMfirst");
  });
  it("the status address carries our message number, and the route passes it on", () => {
    expect(readFileSync("src/lib/sms.ts", "utf8")).toContain("/api/sms/status${messageId ? `?m=${messageId}` : \"\"}");
    expect(readFileSync("src/app/api/sms/status/route.ts", "utf8")).toContain('handleSmsStatus(body, Number(query.get("m")) || null)');
  });
});

describe("M61: PhonePay digits are checked with the longest real values", () => {
  it("a template that fits only short sample values is refused when saved", () => {
    const tight = `{pin}#${"w".repeat(100)}{amount}#`; // 6 + 100 + 6 = 112 with the samples; 12 + 1 + 100 + 7 + 1 = 121 for real
    expect(digitsTemplateError(tight)).toMatch(/too long/);
    expect(digitsTemplateError("{pin}#{amount}#1")).toBeNull();
    expect(digitsTemplateError("{pin}#{amount}#x")).toMatch(/only numbers/);
  });
});

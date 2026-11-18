import { beforeAll, describe, expect, it, vi } from "vitest";

/* "MORE 123" texted from the Owner's cell sends the full info@ email (Abraham, Nov 18, 2026). In-memory database. */
const h = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendSms: async (to: string, body: string) => (h.texts.push({ to, body }), { sent: true }),
  sendEmail: async () => ({ sent: true }),
}));

import { db, schema } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms-inbound";

let longId = 0;
beforeAll(async () => {
  const [a] = await db.insert(schema.inboxEmails).values({ fromAddress: "sara@example.com", fromName: "Sara", subject: "Big party", textBody: "word ".repeat(700) }).returning();
  longId = a.id;
});

describe("MORE code", () => {
  it("MORE <id> from 845-777-7585 sends the full email in parts; nothing goes to the customer flow", async () => {
    h.texts.length = 0;
    const r = await handleInboundSms({ From: "+18457777585", To: "+18454157585", Body: `more ${longId}`, MessageSid: "SMmore1" });
    expect(r.reply).toBeNull();
    expect(h.texts.length).toBe(3);
    expect(h.texts.every((t) => t.to === "+18457777585")).toBe(true);
    expect(h.texts[0].body.startsWith(`Email ${longId}, part 1 of 3\nFrom: Sara <sara@example.com>\nSubject: Big party`)).toBe(true);
  });
  it("MORE alone sends the newest email; an unknown number says so", async () => {
    h.texts.length = 0;
    await handleInboundSms({ From: "+18457777585", Body: "MORE", MessageSid: "SMmore2" });
    expect(h.texts[0].body).toContain(`Email ${longId}, part 1`);
    h.texts.length = 0;
    await handleInboundSms({ From: "+18457777585", Body: "MORE 99999", MessageSid: "SMmore3" });
    expect(h.texts).toEqual([{ to: "+18457777585", body: "No email 99999 was found in the Admin inbox." }]);
  });
  it("from any other phone, MORE is an ordinary incoming text (no email is sent)", async () => {
    h.texts.length = 0;
    await handleInboundSms({ From: "+18455550144", Body: `MORE ${longId}`, MessageSid: "SMmore4" });
    expect(h.texts.some((t) => t.body.includes("Big party"))).toBe(false);
  });
});

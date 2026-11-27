import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* M64 (Abraham, Nov 27, 2026, 10:36 AM ET): the Owner's personal voicemail box is Owner only. The Secretary can not
   see, play, download, mark or delete its messages anywhere in Admin (list, search, customer page, order page, audio
   and download links) and gets none of its alerts. She keeps the Main box, the extension boxes and her own box. */
const h = vi.hoisted(() => ({ staff: { userId: 2, role: "secretary" as "owner" | "secretary" }, emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  currentStaff: async () => h.staff,
  requireStaff: async () => h.staff,
  requireAdmin: async () => h.staff,
  requireOwner: async () => ({ userId: 1, role: "owner" }),
}));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async (to: string) => (h.emails.push(to), { sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canSeeVoicemail, hiddenBoxIds, ownerOnlyRecipients } from "@/lib/vm-privacy";

let ownerBox = 0, secBox = 0, mainBoxId = 0, ownerMsg = 0, secMsg = 0, mainMsg = 0, orderId = 0;
const owner = { role: "owner" };
const secretary = { role: "secretary" };
beforeAll(async () => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  const [o, s] = await db.insert(schema.adminUsers).values([{ name: "Abraham", phone: "+18455550601", email: "abe@example.com", role: "owner" }, { name: "Sara", phone: "+18455550602", email: "sara@example.com", role: "secretary" }]).returning();
  const boxes = await db
    .insert(schema.voicemailBoxes)
    .values([
      { name: "Main", isMain: true, notifyEmail: ["owner@example.com"] },
      { name: "Abraham personal", ownerUserId: o.id, boxNumber: "1", notifyEmail: ["abe@example.com", "sara@example.com"] },
      { name: "Sara personal", ownerUserId: s.id, boxNumber: "2", notifyEmail: ["sara@example.com"] },
    ])
    .returning();
  [mainBoxId, ownerBox, secBox] = boxes.map((b) => b.id);
  const [ord] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2027-01-10", pickupDate: "2027-01-11", subtotalCents: 1 }).returning();
  orderId = ord.id;
  const msgs = await db
    .insert(schema.voicemails)
    .values([
      { boxId: ownerBox, recordingSid: "RE_owner", recordingUrl: "https://api.twilio.com/x/RE_owner", fromNumber: "+18455550777", transcription: "private family matter", state: "submitted", orderId },
      { boxId: secBox, recordingSid: "RE_sec", recordingUrl: "https://api.twilio.com/x/RE_sec", fromNumber: "+18455550777", transcription: "for sara", state: "submitted" },
      { boxId: mainBoxId, recordingSid: "RE_main", recordingUrl: "https://api.twilio.com/x/RE_main", fromNumber: "+18455550777", transcription: "booking question", state: "submitted", orderId },
    ])
    .returning();
  [ownerMsg, secMsg, mainMsg] = msgs.map((m) => m.id);
});

describe("M64: the Owner's personal box is Owner only", () => {
  it("the rule: hidden from the Secretary, open to the Owner", async () => {
    expect(await hiddenBoxIds(secretary)).toEqual([ownerBox]);
    expect(await hiddenBoxIds(owner)).toEqual([]);
    expect(await canSeeVoicemail(secretary, { boxId: ownerBox })).toBe(false);
    expect(await canSeeVoicemail(secretary, { boxId: secBox })).toBe(true);
    expect(await canSeeVoicemail(secretary, { boxId: mainBoxId })).toBe(true);
    expect(await canSeeVoicemail(owner, { boxId: ownerBox })).toBe(true);
  });

  it("play and download link: 404 for the Secretary, allowed for the Owner", async () => {
    const { GET } = await import("@/app/api/admin/voicemail/[id]/audio/route");
    const call = async (id: number, download = false) => GET(new Request(`https://x/api/admin/voicemail/${id}/audio${download ? "?download=1" : ""}`), { params: Promise.resolve({ id: String(id) }) });
    h.staff = { userId: 2, role: "secretary" };
    expect((await call(ownerMsg)).status).toBe(404);
    expect((await call(ownerMsg, true)).status).toBe(404);
    expect((await call(mainMsg)).status).not.toBe(404); // the Main box plays (502 here: no Twilio in tests)
    expect((await call(secMsg, true)).status).not.toBe(404);
    h.staff = { userId: 1, role: "owner" };
    expect((await call(ownerMsg)).status).not.toBe(404);
  });

  it("Mark heard, Urgent and Delete: the Secretary can't change an Owner-box message", async () => {
    const A = await import("@/app/admin/(app)/voicemail/actions");
    h.staff = { userId: 2, role: "secretary" };
    await A.setHeardAction(ownerMsg, true);
    await A.setUrgentAction(ownerMsg, true);
    await A.deleteVoicemailAction(ownerMsg);
    const [v] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, ownerMsg));
    expect([v.heardAt, v.urgent, v.deletedAt]).toEqual([null, false, null]);
    await A.setHeardAction(mainMsg, true); // the Main box still works for her
    expect((await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, mainMsg)))[0].heardAt).not.toBeNull();
  });

  it("search: the Owner box's messages never show for the Secretary", async () => {
    const { searchEverything } = await import("@/lib/search");
    const sec = await searchEverything("private family", { owner: false });
    expect(JSON.stringify(sec)).not.toContain("private family matter");
    const own = await searchEverything("private family", { owner: true });
    expect(JSON.stringify(own)).toContain("private family matter");
    const byPhone = await searchEverything("845-555-0777", { owner: false });
    expect(JSON.stringify(byPhone)).not.toContain("private family matter");
  });

  it("order page delivery messages: the Owner box is left out for the Secretary", async () => {
    const { deliveryInstructionsFor } = await import("@/lib/voicemail");
    expect((await deliveryInstructionsFor(orderId, secretary)).map((m) => m.id)).toEqual([mainMsg]);
    expect((await deliveryInstructionsFor(orderId, owner)).map((m) => m.id).sort()).toEqual([ownerMsg, mainMsg].sort());
  });

  it("alerts for the Owner box go only to the Owner, even if another address was added to it", async () => {
    const r = await ownerOnlyRecipients(ownerBox, ["abe@example.com", "sara@example.com", "owner@example.com"], ["+18455550602", "+18455550601"]);
    expect(r).toEqual({ emails: ["abe@example.com", "owner@example.com"], phones: ["+18455550601"] });
    expect(await ownerOnlyRecipients(secBox, ["sara@example.com"], [])).toEqual({ emails: ["sara@example.com"], phones: [] }); // other boxes unchanged
    h.emails.length = 0;
    const { notifyVoicemail } = await import("@/lib/voicemail");
    await notifyVoicemail(ownerMsg);
    expect(h.emails).toEqual(["abe@example.com"]);
  });

  it("every Admin page that shows voicemails uses the rule; the page explains it in plain English", () => {
    const page = readFileSync("src/app/admin/(app)/voicemail/page.tsx", "utf8");
    expect(page).toContain("hiddenBoxIds(staff)");
    expect(page).toContain("OWNER_BOX_PRIVATE_NOTE");
    expect(readFileSync("src/app/admin/(app)/customers/[id]/page.tsx", "utf8")).toContain("visibleBoxSql(schema.voicemails.boxId, staff)");
    expect(readFileSync("src/app/admin/(app)/orders/[id]/page.tsx", "utf8")).toContain("deliveryInstructionsFor(o.id, staff)");
    expect(readFileSync("src/lib/search.ts", "utf8")).toContain("visibleBoxSql(schema.voicemails.boxId");
    expect(readFileSync("src/app/api/admin/voicemail/[id]/audio/route.ts", "utf8")).toContain("canSeeVoicemail(staff, v)");
  });
});

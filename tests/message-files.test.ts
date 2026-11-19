import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/*
 * Files with texts (Abraham, Nov 16, 2026): photos (JPG, PNG, GIF) and PDFs, sent as a picture text through the
 * Messaging Service; customers' pictures saved to the conversation, the customer and their booking. In-memory
 * database; R2 and Twilio are stand-ins, nothing is sent.
 */
const h = vi.hoisted(() => ({ stored: new Map<string, Uint8Array>(), sent: [] as Record<string, unknown>[], n: 0 }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/r2", async (orig) => ({ ...(await orig<typeof import("@/lib/r2")>()), r2Put: async (key: string, data: Uint8Array) => void h.stored.set(key, data) }));
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: Object.assign(() => ({ update: async () => ({}) }), { create: async (p: Record<string, unknown>) => (h.sent.push(p), { sid: `SMfile${++h.n}`, status: "queued" }) }) }),
}));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireOwner: async () => ({ userId: 1, role: "owner", name: "Owner", phone: "+18457777585" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/owner-alerts", async (orig) => ({ ...(await orig<typeof import("@/lib/owner-alerts")>()), emailIncomingText: async () => ({ sent: 0 }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { MMS_MAX_TOTAL_BYTES, checkOutgoingFiles, fileKind, saveIncomingMedia, serveHeaders } from "@/lib/message-files";
import { messageFileLink, verifyMessageFileLink } from "@/lib/signed-link";
import { sendReplyAction, uploadTextFileAction } from "@/app/admin/(app)/messages/actions";
import { handleInboundSms } from "@/lib/sms-inbound";
import { saveSetting } from "@/lib/settings";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(300).fill(7)]);
const pdf = new TextEncoder().encode("%PDF-1.7 a small pdf");
const gif = new TextEncoder().encode("GIF89a....");
const PHONE = "+18457990925";
let orderId = 0;
let customerId = 0;

const upload = async (data: Uint8Array, name: string, phone = PHONE) => {
  const fd = new FormData();
  fd.set("phone", phone);
  fd.set("file", new File([new Uint8Array(data)], name));
  return uploadTextFileAction(fd);
};
const send = async (body: string, ids: number[], phone = PHONE) => {
  const fd = new FormData();
  fd.set("phone", phone);
  fd.set("body", body);
  fd.set("fileIds", ids.join(","));
  return sendReplyAction(null, fd);
};

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-123";
  process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  process.env.SMS_TERMS_V2 = "1";
  const [c] = await db.insert(schema.customers).values({ phone: PHONE, name: "Test" }).returning();
  customerId = c.id;
  await db.insert(schema.smsConsents).values({ customerId: c.id, phone: PHONE, scope: "transactional", action: "opt_in", source: "web", method: "checkbox", wording: "order texts" });
  const [o] = await db.insert(schema.orders).values({ channel: "POS", customerId: c.id, eventDate: "2026-12-01", pickupDate: "2026-12-02", status: "CONFIRMED" }).returning();
  orderId = o.id;
});
beforeEach(() => {
  h.sent.length = 0;
});

describe("checking files before they go", () => {
  it("photos (JPG, PNG, GIF) and PDF only, by what the file really is", () => {
    expect(fileKind(jpeg)).toBe("image/jpeg");
    expect(fileKind(gif)).toBe("image/gif");
    expect(fileKind(pdf)).toBe("application/pdf");
    expect(fileKind(new TextEncoder().encode("<html><script>"))).toBeNull();
    const bad = checkOutgoingFiles([{ name: "page.html", data: new TextEncoder().encode("<html>") }]);
    expect(bad).toEqual({ ok: false, error: '"page.html" can\'t be sent. Attach a photo (JPG, PNG or GIF), a PDF, or a voice note (MP3 or WAV).' });
  });
  it("Twilio's limits: up to 10 files, 5 MB in all; a plain reason when not", () => {
    expect(checkOutgoingFiles(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.jpg`, data: jpeg }))).ok).toBe(false);
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(jpeg.subarray(0, 4));
    const two = checkOutgoingFiles([{ name: "a.jpg", data: big }, { name: "b.jpg", data: big }]);
    expect(two.ok).toBe(false);
    expect(!two.ok && two.error).toContain("5 MB in all");
    expect(MMS_MAX_TOTAL_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("sending", () => {
  it("a photo and a PDF go as one picture text through the Messaging Service, saved with the message, customer and booking", async () => {
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGtest";
    const a = await upload(jpeg, "castle.jpg");
    const b = await upload(pdf, "invoice.pdf");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(await send("Here are the photos", [a.id, b.id])).toEqual({ ok: true });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].messagingServiceSid).toBe("MGtest");
    const urls = h.sent[0].mediaUrl as string[];
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(new RegExp(`^https://hupup\\.vercel\\.app/api/media/message-file/${a.id}\\?exp=\\d+&sig=`));
    const files = await db.select().from(schema.messageFiles).where(eq(schema.messageFiles.contactPhone, PHONE));
    const sentFiles = files.filter((f) => f.id === a.id || f.id === b.id);
    expect(sentFiles.every((f) => f.messageId && f.customerId === customerId && f.orderId === orderId && f.direction === "out")).toBe(true);
    expect(h.stored.get(sentFiles[0].storageKey)).toEqual(jpeg);
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  });
  it("text only stays a plain text (no media)", async () => {
    expect(await send("Just words", [])).toEqual({ ok: true });
    expect(h.sent[0].mediaUrl).toBeUndefined();
  });
  it("a wrong type or a file over 4 MB is refused before anything is sent", async () => {
    const html = await upload(new TextEncoder().encode("<html>"), "x.html");
    expect(html).toEqual({ ok: false, error: '"x.html" can\'t be sent. Attach a photo (JPG, PNG or GIF), a PDF, or a voice note (MP3 or WAV).' });
    const big = new Uint8Array(4 * 1024 * 1024 + 10);
    big.set(jpeg.subarray(0, 4));
    const r = await upload(big, "huge.jpg");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("up to 4 MB");
    expect(h.sent).toHaveLength(0);
  });
  it("a file uploaded for one number can't be sent to another, and a sent file can't be sent twice", async () => {
    const a = await upload(jpeg, "one.jpg");
    if (!a.ok) throw new Error("upload failed");
    expect((await send("x", [a.id], "+18457777585")).error).toContain("could not be found");
    expect(await send("x", [a.id])).toEqual({ ok: true });
    expect((await send("again", [a.id])).error).toContain("could not be found");
  });
  it("the test window still holds texts to anyone but the two test numbers; the files stay with the held message", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGtest";
    await saveSetting("smsTestOnly", true);
    const other = "+18455550177";
    const a = await upload(jpeg, "p.jpg", other);
    if (!a.ok) throw new Error("upload failed");
    const r = await send("hi", [a.id], other);
    expect(r.error).toBeTruthy();
    expect(h.sent).toHaveLength(0);
    const [f] = await db.select().from(schema.messageFiles).where(eq(schema.messageFiles.id, a.id));
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.id, f.messageId!));
    expect(m.status).toBe("blocked");
    delete process.env.VERCEL_ENV;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  });
  it("Delivery staff are unchanged: the free reply (and attaching) is Owner only; the delivery photo step is separate", () => {
    const a = readFileSync("src/app/admin/(app)/messages/actions.ts", "utf8");
    expect(a.match(/await requireOwner\(\)/g)?.length).toBe(2);
    expect(readFileSync("src/app/admin/(app)/messages/page.tsx", "utf8")).toContain('staff.role === "owner" ? (\n                <ReplyForm');
  });
});

describe("receiving", () => {
  it("a customer's picture is copied from Twilio into R2, saved with the message, the customer and their booking", async () => {
    let asked = "";
    const fake = (async (u: string, init: RequestInit) => ((asked = String((init.headers as Record<string, string>).authorization ?? "")), void u, new Response(jpeg, { headers: { "content-type": "image/jpeg" } }))) as unknown as typeof fetch;
    const n = await saveIncomingMedia({ messageId: 999, from: PHONE, customerId, media: [{ url: "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1", contentType: "image/jpeg" }] }, { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok" }, fake);
    expect(n).toBe(1);
    expect(asked).toMatch(/^Basic /);
    const [f] = await db.select().from(schema.messageFiles).where(eq(schema.messageFiles.messageId, 999));
    expect(f).toMatchObject({ direction: "in", customerId, orderId, contentType: "image/jpeg", contactPhone: PHONE });
  });
  it("only Twilio's own media links are fetched; a failed file never stops the text", async () => {
    const fake = (async () => new Response("x")) as unknown as typeof fetch;
    expect(await saveIncomingMedia({ messageId: 998, from: PHONE, customerId, media: [{ url: "https://evil.example/x.jpg" }] }, {}, fake)).toBe(0);
    const r = await handleInboundSms({ From: PHONE, To: "+18454157585", Body: "photo of the yard", NumMedia: "1", MediaUrl0: "https://evil.example/a.jpg", MessageSid: "SMin1" });
    expect(r.messageId).toBeGreaterThan(0);
  });
  it("files are shown safely: pictures and PDFs open in the browser, anything else only downloads", () => {
    expect(serveHeaders({ id: 1, contentType: "image/png", fileName: "a.png" })["Content-Disposition"]).toMatch(/^inline/);
    const other = serveHeaders({ id: 2, contentType: "text/vcard", fileName: "card.vcf" });
    expect(other["Content-Type"]).toBe("application/octet-stream");
    expect(other["Content-Disposition"]).toMatch(/^attachment/);
    expect(other["X-Content-Type-Options"]).toBe("nosniff");
  });
  it("Twilio's link to a sent file is signed and expires after a day", () => {
    const now = Date.now();
    const u = new URL(messageFileLink(5, now));
    expect(verifyMessageFileLink(5, Number(u.searchParams.get("exp")), u.searchParams.get("sig"), now)).toBe(true);
    expect(verifyMessageFileLink(6, Number(u.searchParams.get("exp")), u.searchParams.get("sig"), now)).toBe(false);
    expect(verifyMessageFileLink(5, Number(u.searchParams.get("exp")), u.searchParams.get("sig"), now + 25 * 3600_000)).toBe(false);
  });
  it("the conversation, the customer page and the order page show the files", () => {
    expect(readFileSync("src/app/admin/(app)/messages/page.tsx", "utf8")).toContain("<MessageFiles");
    expect(readFileSync("src/app/admin/(app)/customers/[id]/page.tsx", "utf8")).toContain("data-customer-text-files");
    expect(readFileSync("src/app/admin/(app)/orders/[id]/page.tsx", "utf8")).toContain("data-order-text-files");
    const form = readFileSync("src/app/admin/(app)/messages/ReplyForm.tsx", "utf8");
    expect(form).toContain("data-attach");
    expect(form).toContain("data-remove-file");
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";

/* info@ Inbox (Abraham, Nov 12, 2026). In-memory database; nothing is sent for real. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string; attachments: unknown[]; opts?: { headers?: Record<string, string> } }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string, text: string, attachments: unknown[] = [], opts?: { headers?: Record<string, string> }) => (h.emails.push({ to, subject, text, attachments, opts }), { sent: true }),
  sendSms: async () => ({ sent: false }),
}));

import { db, schema } from "@/lib/db";
import { fileBytes, getInboxEmail, inboxUnreadCount, listInbox, receiveRawPiece, saveReplyFileChunk, sendReply, setRead, startReplyFile } from "@/lib/inbox";
import { POST as inbound } from "@/app/api/email/inbound-raw/route";

const pdf = Buffer.from("%PDF-1.4 sample price list").toString("base64");
const MAIL = [
  "From: Sara Klein <Sara@Example.com>",
  "To: info@hupupattractions.com",
  "Subject: Question about the castle",
  "Message-ID: <abc123@example.com>",
  "Date: Thu, 12 Nov 2026 15:05:00 -0500",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi, is the royal castle free on December 20? Thanks, Sara",
  "--b1",
  'Content-Type: application/pdf; name="list.pdf"',
  'Content-Disposition: attachment; filename="list.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  pdf,
  "--b1--",
  "",
].join("\r\n");

beforeAll(async () => {
  process.env.ADMIN_EMAIL = "hupupattractions@gmail.com";
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.INBOUND_EMAIL_SECRET = "worker-secret";
  await db.insert(schema.customers).values({ name: "Sara Klein", phone: "+18455550144", email: "sara@example.com" });
});

describe("mail in (from the Cloudflare Email Worker, in pieces)", () => {
  it("refuses a request without the shared secret", async () => {
    const res = await inbound(new Request("https://hupup.example/api/email/inbound-raw?id=aaaaaaaa1&i=0&n=1", { method: "POST", body: "x" }));
    expect(res.status).toBe(403);
  });
  it("puts the pieces together, keeps the email and its attachment, links the contact, and emails Abraham", async () => {
    const bytes = Buffer.from(MAIL);
    const half = Math.floor(bytes.length / 2);
    const post = (i: number, body: Buffer) =>
      inbound(new Request(`https://hupup.example/api/email/inbound-raw?id=upload-0001&i=${i}&n=2`, { method: "POST", body: new Uint8Array(body), headers: { "x-inbound-secret": "worker-secret" } }));
    expect(await (await post(1, bytes.subarray(half))).json()).toEqual({ complete: false });
    const done = await (await post(0, bytes.subarray(0, half))).json();
    expect(done.complete).toBe(true);
    const found = (await getInboxEmail(done.emailId))!;
    expect(found.email.fromAddress).toBe("sara@example.com");
    expect(found.email.subject).toBe("Question about the castle");
    expect(found.email.textBody).toContain("royal castle");
    expect(found.email.readAt).toBeNull();
    expect(found.contact?.name).toBe("Sara Klein");
    expect(found.files.map((f) => f.fileName)).toEqual(["list.pdf"]);
    expect((await fileBytes(found.files[0].id))!.data.toString()).toContain("%PDF");
    const alert = h.emails.find((e) => e.to === "hupupattractions@gmail.com");
    expect(alert?.subject).toBe("New email to info@: Question about the castle");
    expect(alert?.text).toContain("/admin/inbox/");
  });
  it("the same email twice is kept once", async () => {
    await receiveRawPiece("upload-0002", 0, 1, Buffer.from(MAIL));
    expect(await listInbox()).toHaveLength(1);
  });
});

describe("Inbox", () => {
  it("unread count, mark read and unread, search by sender, subject or text", async () => {
    expect(await inboxUnreadCount()).toBe(1);
    const [e] = await listInbox();
    await setRead(e.id, true);
    expect(await inboxUnreadCount()).toBe(0);
    await setRead(e.id, false);
    expect(await inboxUnreadCount()).toBe(1);
    expect(await listInbox("sara")).toHaveLength(1);
    expect(await listInbox("castle")).toHaveLength(1);
    expect(await listInbox("december 20")).toHaveLength(1);
    expect(await listInbox("nothing like this")).toHaveLength(0);
  });
  it("reply from info@, signed Hup Up Attractions, threaded, with an attachment; kept with the email", async () => {
    const [e] = await listInbox();
    const f = await startReplyFile("price.pdf", "application/pdf", 9, null);
    await saveReplyFileChunk(f.id, 0, Buffer.from("%PDF-1.4x"), true);
    h.emails.length = 0;
    const r = await sendReply({ emailId: e.id, body: "Yes, it's free that day!", fileIds: [f.id], userId: null });
    expect(r.sent).toBe(true);
    const sent = h.emails[0];
    expect(sent.to).toBe("sara@example.com");
    expect(sent.subject).toBe("Re: Question about the castle");
    expect(sent.text).toBe("Yes, it's free that day!\n\nHup Up Attractions");
    expect(sent.attachments).toHaveLength(1);
    expect(sent.opts?.headers?.["In-Reply-To"]).toBe("<abc123@example.com>");
    const after = (await getInboxEmail(e.id))!;
    expect(after.replies).toHaveLength(1);
    expect(after.replyFiles.map((x) => x.fileName)).toEqual(["price.pdf"]);
  });
  it("attachments over 10 MB are refused for replies", async () => {
    await expect(startReplyFile("big.zip", "application/zip", 11 * 1024 * 1024, null)).rejects.toThrow("10 MB");
  });
  it("never deletes: no delete anywhere in the Inbox code", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/lib/inbox.ts", "src/app/admin/(app)/inbox/actions.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/\.delete\(/);
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";

/* Large files by link (Abraham, Nov 18, 2026): over 18 MB, up to 100 MB, sent as a 30-day download link. In-memory database; R2 is a stand-in. */
const h = vi.hoisted(() => ({ stored: new Map<string, Uint8Array>(), emails: [] as { text: string; attachments: unknown[] }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/r2", async (orig) => ({
  ...(await orig<typeof import("@/lib/r2")>()),
  r2Ready: () => true,
  r2Used: async () => 0,
  r2Put: async (key: string, data: Uint8Array) => void h.stored.set(key, new Uint8Array(data)),
  r2Get: async (key: string) => (h.stored.has(key) ? new Response(new Uint8Array(h.stored.get(key)!)) : new Response("no", { status: 404 })),
}));
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (_to: string, _s: string, text: string, attachments: unknown[] = []) => (h.emails.push({ text, attachments }), { sent: true }),
  sendSms: async () => ({ sent: true }),
}));

import { INBOX_CHUNK_BYTES, saveReplyFileChunk, sendNewEmail, startReplyFile } from "@/lib/inbox";
import { LINK_FILE_MAX_BYTES, fileLink, verifyFileLink } from "@/lib/file-links";
import { GET as download } from "@/app/api/files/[id]/route";

beforeAll(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret-files";
});

describe("large files by link", () => {
  it("over 100 MB is refused", async () => {
    await expect(startReplyFile("huge.mov", "video/quicktime", LINK_FILE_MAX_BYTES + 1, null)).rejects.toThrow("100 MB");
  });
  it("a 20 MB file goes to R2 in pieces, the email carries the approved line with a link, and the link downloads the whole file", async () => {
    const size = 20 * 1024 * 1024;
    const f = await startReplyFile("party video.mp4", "video/mp4", size, null);
    expect(f.inR2).toBe(true);
    const data = new Uint8Array(size).map((_, i) => i % 251);
    const pieces = Math.ceil(size / INBOX_CHUNK_BYTES);
    let done = false;
    for (let i = 0; i < pieces; i++) done = await saveReplyFileChunk(f.id, i, Buffer.from(data.subarray(i * INBOX_CHUNK_BYTES, (i + 1) * INBOX_CHUNK_BYTES)), i === pieces - 1);
    expect(done).toBe(true);
    h.emails.length = 0;
    await sendNewEmail({ to: "dovid@example.com", subject: "The video", body: "Here it is.", fileIds: [f.id], userId: null });
    expect(h.emails[0].attachments).toEqual([]);
    const m = h.emails[0].text.match(/This file was too big to attach\. Download it here: (\S+)$/);
    expect(h.emails[0].text.startsWith("Here it is.\n\nThis file was too big to attach. Download it here: https://hupup.example/api/files/")).toBe(true);
    const url = new URL(m![1]);
    const r = await download(new Request(url), { params: Promise.resolve({ id: String(f.id) }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain('filename="party video.mp4"');
    const got = new Uint8Array(await r.arrayBuffer());
    expect(got.length).toBe(size);
    expect(got[size - 1]).toBe(data[size - 1]);
  });
  it("the link works for 30 days, then not; a changed link never works", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const u = new URL(fileLink(7, now));
    const e = u.searchParams.get("e");
    const s = u.searchParams.get("s");
    expect(verifyFileLink(7, e, s, new Date("2026-12-17T12:00:00Z"))).toBe(true);
    expect(verifyFileLink(7, e, s, new Date("2026-12-18T12:00:01Z"))).toBe(false);
    expect(verifyFileLink(8, e, s, now)).toBe(false);
  });
});

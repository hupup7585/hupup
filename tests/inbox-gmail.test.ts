import { describe, expect, it, vi } from "vitest";

/* Gmail-style Inbox (Abraham, Nov 15, 2026): folders, stars, labels, archive, trash (hidden only), drafts, forward. */

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import * as F from "@/lib/inbox-folders";
import { inboxUnreadCount } from "@/lib/inbox";

const mail = async (subject: string, extra: Record<string, unknown> = {}) =>
  (await db.insert(schema.inboxEmails).values({ fromAddress: "sender@example.com", subject, textBody: `Body of ${subject}`, ...extra }).returning())[0].id;
const subjects = async (folder: F.Folder, label?: string) => (await F.listEmails({ folder, label })).rows.map((r) => r.subject);

describe("Gmail-style Inbox", () => {
  it("folders: archive moves out of the Inbox, trash hides (never deletes), restore and move back", async () => {
    const a = await mail("Party on Sunday");
    const b = await mail("Invoice question");
    await F.bulkEmails([a], "archive");
    expect(await subjects("inbox")).toEqual(["Invoice question"]);
    expect(await subjects("archive")).toEqual(["Party on Sunday"]);
    await F.bulkEmails([b], "trash");
    expect(await subjects("inbox")).toEqual([]);
    expect(await subjects("trash")).toEqual(["Invoice question"]);
    expect(await subjects("all")).toEqual(["Party on Sunday"]);
    expect((await db.select().from(schema.inboxEmails)).length).toBe(2); // nothing deleted
    await F.bulkEmails([b], "restore");
    await F.bulkEmails([a], "inbox");
    expect((await subjects("inbox")).sort()).toEqual(["Invoice question", "Party on Sunday"]);
  });
  it("stars, read and unread; the unread count is the Inbox only", async () => {
    const c = await mail("Bounce house size");
    await F.bulkEmails([c], "star");
    expect(await subjects("starred")).toContain("Bounce house size");
    const before = await inboxUnreadCount();
    await F.bulkEmails([c], "read");
    expect(await inboxUnreadCount()).toBe(before - 1);
    await F.bulkEmails([c], "unread");
    await F.bulkEmails([c], "archive");
    expect(await inboxUnreadCount()).toBe(before - 1);
    expect((await F.folderCounts()).inbox).toBe(before - 1);
  });
  it("labels: add to many, filter by label, remove from one, delete the label (the emails stay)", async () => {
    await F.createLabel("Schools");
    const d = await mail("Field day order");
    const e = await mail("PTA question");
    await F.bulkEmails([d, e], "label", "Schools");
    await F.bulkEmails([d], "label", "Schools"); // no duplicate
    expect((await subjects("all", "Schools")).sort()).toEqual(["Field day order", "PTA question"]);
    const [row] = (await F.listEmails({ folder: "all", label: "Schools" })).rows.filter((r) => r.id === d);
    expect(row.labels).toEqual(["Schools"]);
    await F.bulkEmails([e], "unlabel", "Schools");
    expect(await subjects("all", "Schools")).toEqual(["Field day order"]);
    await F.removeLabel("Schools");
    expect(await F.listLabels()).toEqual([]);
    expect(await subjects("all", "Schools")).toEqual([]);
  });
  it("drafts save, update, show in Drafts, and leave Drafts when sent or discarded", async () => {
    const id = await F.saveDraft({ to: "a@example.com", subject: "Hi", body: "First", userId: null });
    expect(await F.saveDraft({ id, to: "a@example.com", subject: "Hi", body: "Second", userId: null })).toBe(id);
    expect((await F.listDrafts()).map((d) => d.body)).toEqual(["Second"]);
    expect((await F.folderCounts()).drafts).toBe(1);
    await F.discardDraft(id);
    expect(await F.listDrafts()).toEqual([]);
    const id2 = await F.saveDraft({ to: "", subject: "", body: "x", userId: null });
    await F.draftSent(id2, 99);
    expect(await F.listDrafts()).toEqual([]);
  });
  it("forward: Fwd subject and the quoted original", () => {
    const fw = F.forwardText({ fromName: "Sara", fromAddress: "sara@example.com", subject: "Tent", receivedAt: new Date("2026-11-15T15:00:00Z"), textBody: "Do you have tents?", toAddress: "info@hupupattractions.com" });
    expect(fw.subject).toBe("Fwd: Tent");
    expect(fw.body).toContain("---------- Forwarded message ----------");
    expect(fw.body).toContain("Do you have tents?");
  });
  it("screens: folder column, compose, search, check boxes with a toolbar, reading view with reply and forward; Owner only", () => {
    const shell = readFileSync("src/app/admin/(app)/inbox/MailShell.tsx", "utf8");
    for (const t of ["data-compose", "data-folder", "data-labels", "data-mail-search"]) expect(shell).toContain(t);
    const list = readFileSync("src/app/admin/(app)/inbox/MailList.tsx", "utf8");
    expect(list).toContain('aria-label="Select all"');
    expect(list).toContain("data-mail-toolbar");
    const view = readFileSync("src/app/admin/(app)/inbox/[id]/page.tsx", "utf8");
    expect(view).toContain("data-email-toolbar");
    expect(view).toContain("data-forward");
    for (const p of ["src/app/admin/(app)/inbox/page.tsx", "src/app/admin/(app)/inbox/[id]/page.tsx", "src/app/admin/(app)/inbox/new/page.tsx"]) expect(readFileSync(p, "utf8")).toContain("await requireOwner()");
    expect(readFileSync("src/app/admin/(app)/inbox/actions.ts", "utf8").match(/await requireOwner\(\)/g)!.length).toBeGreaterThanOrEqual(10);
  });
});

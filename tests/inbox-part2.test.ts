import { beforeAll, describe, expect, it, vi } from "vitest";

/* Gmail-style Inbox, part 2 (Abraham, Nov 19, 2026): conversations, the formatting bar, the phone layout. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { listThreads, threadEmails, threadKey } from "@/lib/inbox-folders";
import { cleanEmailHtml } from "@/lib/email-format";
import { brandedEmail } from "@/lib/email-brand";

beforeAll(async () => {
  const t = (m: number) => new Date(Date.UTC(2026, 10, 19, 12, m));
  const [a] = await db.insert(schema.inboxEmails).values({ fromAddress: "help@temu.com", subject: "After-sales Issue", textBody: "first", receivedAt: t(1) }).returning();
  await db.insert(schema.inboxEmails).values({ fromAddress: "help@temu.com", subject: "Re: After-sales Issue", textBody: "second", receivedAt: t(5) });
  await db.insert(schema.inboxEmails).values({ fromAddress: "sara@example.com", subject: "Sunday", textBody: "hi", receivedAt: t(3), readAt: t(4) });
  await db.insert(schema.inboxReplies).values({ emailId: a.id, toAddress: "help@temu.com", subject: "Re: After-sales Issue", body: "ok", sent: true });
  await db.insert(schema.inboxDrafts).values({ replyToEmailId: a.id, toAddress: "help@temu.com", body: "draft" });
});

describe("conversations", () => {
  it("one row per conversation, newest first, with the count (emails and our replies), me and Draft", async () => {
    const r = await listThreads({ folder: "inbox" });
    expect(r.total).toBe(2);
    const temu = r.rows[0];
    expect(temu.textBody).toBe("second");
    expect(temu.count).toBe(3);
    expect(temu.sentByUs).toBe(true);
    expect(temu.hasDraft).toBe(true);
    expect(temu.unreadAny).toBe(true);
    expect(temu.ids).toHaveLength(2);
    expect(threadKey({ subject: "Fwd: RE: After-sales Issue", fromAddress: "HELP@temu.com" })).toBe(threadKey({ subject: "After-sales Issue", fromAddress: "help@temu.com" }));
    expect((await threadEmails(temu)).map((x) => x.textBody)).toEqual(["first", "second"]);
  });
  it("the email page shows the whole conversation; a picked conversation acts on every email in it", () => {
    expect(readFileSync("src/app/admin/(app)/inbox/[id]/page.tsx", "utf8")).toContain("emails in this conversation");
    expect(readFileSync("src/app/admin/(app)/inbox/MailList.tsx", "utf8")).toContain("flatMap((r) => r.ids ?? [r.id])");
  });
});

describe("formatting bar", () => {
  it("keeps bold, italic, underline, lists, colors and links; removes anything that can run", () => {
    const html = cleanEmailHtml('<b>Hi</b> <i>there</i> <u>u</u><ul><li>one</li></ul><span style="color: #123D73; font-size: 40px" onclick="x()">blue</span><font color="red">red</font><a href="https://hupupattractions.com" onmouseover="x()">site</a><a href="javascript:alert(1)">bad</a><script>alert(1)</script><img src=x onerror=alert(1)><style>p{}</style>');
    expect(html).toBe('<b>Hi</b> <i>there</i> <u>u</u><ul><li>one</li></ul><span style="color:#123D73">blue</span><span style="color:red">red</span><a href="https://hupupattractions.com">site</a><a>bad</a>');
  });
  it("the email goes out with the formatting inside our branded layout", () => {
    const e = brandedEmail("Hi there", { baseUrl: "https://hupupattractions.com", bodyHtml: "<b>Hi</b> there" });
    expect(e.html).toContain("<b>Hi</b> there");
    expect(e.text).toContain("Hi there");
  });
  it("Compose uses the formatting bar; the phone has a folders menu and a round Compose button", () => {
    expect(readFileSync("src/app/admin/(app)/inbox/[id]/ReplyForm.tsx", "utf8")).toContain("<RichEditor");
    const shell = readFileSync("src/app/admin/(app)/inbox/MailShell.tsx", "utf8");
    expect(shell).toContain("data-mail-menu");
    expect(shell).toContain("data-compose-phone");
  });
});

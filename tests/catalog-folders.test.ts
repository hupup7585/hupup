import { beforeAll, describe, expect, it, vi } from "vitest";

/* Catalog requests on their own (Abraham, Nov 19, 2026): emails and texts that only ask for the catalog are kept apart;
 * the Inbox and the text conversations show only real messages. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { folderCounts, listEmails } from "@/lib/inbox-folders";
import { listThreads, unreadTexts } from "@/lib/messages";

beforeAll(async () => {
  await db.insert(schema.inboxEmails).values([
    { fromAddress: "a@example.com", subject: "Catalog", textBody: "" },
    { fromAddress: "b@example.com", subject: "Re: catalogue!", textBody: "" },
    { fromAddress: "c@example.com", subject: "Question about the catalog", textBody: "Is the castle free Sunday?" },
  ]);
  await db.insert(schema.messages).values([
    { direction: "in", fromNumber: "+18455550101", toNumber: "+18454157585", contactPhone: "+18455550101", body: "Catalog" },
    { direction: "out", fromNumber: "+18454157585", toNumber: "+18455550101", contactPhone: "+18455550101", body: "Hup Up Attractions: Here is our catalog!", kind: "system", event: "catalog_reply" },
    { direction: "in", fromNumber: "+18455550102", toNumber: "+18454157585", contactPhone: "+18455550102", body: "Do you have a slide for Sunday?" },
    { direction: "in", fromNumber: "+18455550103", toNumber: "+18454157585", contactPhone: "+18455550103", body: "catalog" },
    { direction: "in", fromNumber: "+18455550103", toNumber: "+18454157585", contactPhone: "+18455550103", body: "Thanks, how much is the castle?" },
  ]);
});

describe("emails", () => {
  it("catalog-only emails go to Catalog requests, never the Inbox; a real question stays in the Inbox", async () => {
    const inbox = await listEmails({ folder: "inbox" });
    expect(inbox.rows.map((r) => r.fromAddress)).toEqual(["c@example.com"]);
    const cat = await listEmails({ folder: "catalog" });
    expect(cat.rows.map((r) => r.fromAddress).sort()).toEqual(["a@example.com", "b@example.com"]);
    const n = await folderCounts();
    expect(n.inbox).toBe(1);
    expect(n.catalog).toBe(2);
  });
});

describe("texts", () => {
  it("numbers that only texted CATALOG are on the Catalog requests tab; anyone who wrote anything else is a conversation", async () => {
    expect((await listThreads(undefined, 200, "catalog")).map((t) => t.contact_phone)).toEqual(["+18455550101"]);
    expect((await listThreads(undefined, 200, "conversations")).map((t) => t.contact_phone).sort()).toEqual(["+18455550102", "+18455550103"]);
    expect((await listThreads(undefined, 200, "all")).length).toBe(3);
    expect(await unreadTexts()).toBe(2); // the two real texts; the CATALOG texts are not counted
  });
});

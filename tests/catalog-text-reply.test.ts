import { describe, expect, it, vi } from "vitest";

/* Texting CATALOG no longer sends the catalog (Abraham, Nov 24, 2026); the catalog text itself still works. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms-inbound";
import { saveSetting } from "@/lib/settings";
import { beforeAll } from "vitest";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await saveSetting("catalogTextItems", JSON.stringify([{ photo: "/api/catalog-photo/catalog/text/a.jpg", text: "" }]));
});

describe("CATALOG by text", () => {
  it("Abraham, Nov 24, 2026: texting CATALOG sends nothing; it is a normal message in the staff inbox", async () => {
    await handleInboundSms({ From: "+18455550111", To: "+18454157585", Body: "Catalog", MessageSid: "SMcat1" });
    const all = await db.select().from(schema.messages);
    expect(all.filter((m) => m.direction === "out" && m.toNumber === "+18455550111")).toHaveLength(0);
    expect(all.some((m) => m.direction === "in" && m.fromNumber === "+18455550111" && m.body === "Catalog")).toBe(true);
    const { listThreads } = await import("@/lib/messages");
    expect((await listThreads(undefined, 200, "conversations")).map((t) => t.contact_phone)).toContain("+18455550111");
  });
  it("the catalog by text still goes out from the phone menu, the website and Admin (the same sender), first text with the approved wording", async () => {
    const { replyToCatalogText } = await import("@/lib/catalog-send");
    const { sendMessage } = await import("@/lib/sms");
    const r = await replyToCatalogText("+18455550114", { optedOut: false, send: (to, b, media) => sendMessage({ to, body: b, ...(media?.length ? { mediaUrls: media } : {}), kind: "system", event: "catalog_reply" }) });
    expect(r.replied).toBe(true);
    const out = (await db.select().from(schema.messages)).filter((m) => m.direction === "out" && m.toNumber === "+18455550114");
    expect(out).toHaveLength(2); // the first text, then the photo
    // Nov 27, 2026 (item 5): the first text this number ever gets ends with the STOP/HELP sentence; the photo after it does not
    expect(out[0].body).toBe("Hup Up Attractions: Here is our catalog! You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1. Reply STOP to stop, or HELP for help.");
    expect(out[1].body ?? "").not.toContain("Reply STOP to stop, or HELP for help.");
  });
  it("never after STOP", async () => {
    const { replyToCatalogText } = await import("@/lib/catalog-send");
    const r = await replyToCatalogText("+18455550112", { optedOut: true, send: async () => ({ sent: true }) });
    expect(r).toMatchObject({ replied: false, reason: "opted_out" });
  });
  it("a requested catalog is not held by the texting test window; other customer texts still are", async () => {
    const { testWindowBlocks } = await import("@/lib/sms");
    const was = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    await saveSetting("smsTestOnly", true); // the window is off since Nov 25, 2026; switched on here to test it
    try {
      expect(await testWindowBlocks("+18453955264", "catalog_request")).toBe(false);
      expect(await testWindowBlocks("+18453955264", "catalog_reply")).toBe(false);
      expect(await testWindowBlocks("+18453955264", "order_confirmation")).toBe(true);
    } finally {
      process.env.VERCEL_ENV = was;
      await saveSetting("smsTestOnly", false);
    }
  });
  it("Nov 25, 2026: customer texts are on for everyone by default (the test window is off)", async () => {
    const { testWindowBlocks } = await import("@/lib/sms");
    const was = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      expect(await testWindowBlocks("+18453955264", "order_confirmation")).toBe(false);
    } finally {
      process.env.VERCEL_ENV = was;
    }
  });
  it("the owner alert shows the time once", async () => {
    const { friendlyStamp } = await import("@/lib/catalog-send");
    expect(friendlyStamp(new Date("2026-11-18T03:58:37Z"))).toBe("Tuesday, November 17, 2026 at 10:58 PM");
  });
});


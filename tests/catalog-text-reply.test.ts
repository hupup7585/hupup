import { describe, expect, it, vi } from "vitest";

/* Texting CATALOG gets the catalog (Abraham, Nov 18, 2026: "It's not sending catalog texts by request"). In-memory database. */
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
  it("a new number with no booking-text consent still gets the catalog reply (it asked for it), first text with the approved wording", async () => {
    await handleInboundSms({ From: "+18455550111", To: "+18454157585", Body: "Catalog", MessageSid: "SMcat1" });
    const out = (await db.select().from(schema.messages)).filter((m) => m.direction === "out" && m.event === "catalog_reply");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.status !== "blocked")).toBe(true);
    expect(out[0].kind).toBe("system");
    expect(out).toHaveLength(2); // the first text, then the photo
    expect(out[1].mediaUrls).toEqual(["https://hupup.example/api/catalog-photo/catalog/text/a.jpg"]);
    expect(out[0].body).toBe("Hup Up Attractions: Here is our catalog! You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1.");
  });
  it("never after STOP", async () => {
    await db.insert(schema.customers).values({ phone: "+18455550112", smsOptOut: true });
    await handleInboundSms({ From: "+18455550112", To: "+18454157585", Body: "CATALOG", MessageSid: "SMcat2" });
    const out = (await db.select().from(schema.messages)).filter((m) => m.direction === "out" && m.toNumber === "+18455550112" && m.status !== "blocked");
    expect(out).toHaveLength(0);
  });
  it("no catalog photos at all: nothing is sent, the Owner sees a warning in Admin", async () => {
    await saveSetting("catalogTextItems", "");
    await handleInboundSms({ From: "+18455550113", To: "+18454157585", Body: "catalog", MessageSid: "SMcat3" });
    const out = (await db.select().from(schema.messages)).filter((m) => m.direction === "out" && m.toNumber === "+18455550113");
    expect(out).toHaveLength(0);
    const { getSettings } = await import("@/lib/settings");
    expect(String((await getSettings()).catalogTextMissingAt)).not.toBe("");
  });
  it("a requested catalog is not held by the texting test window; other customer texts still are", async () => {
    const { testWindowBlocks } = await import("@/lib/sms");
    const was = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      expect(await testWindowBlocks("+18453955264", "catalog_request")).toBe(false);
      expect(await testWindowBlocks("+18453955264", "catalog_reply")).toBe(false);
      expect(await testWindowBlocks("+18453955264", "order_confirmation")).toBe(true);
    } finally {
      process.env.VERCEL_ENV = was;
    }
  });
  it("the owner alert shows the time once", async () => {
    const { friendlyStamp } = await import("@/lib/catalog-send");
    expect(friendlyStamp(new Date("2026-11-18T03:58:37Z"))).toBe("Tuesday, November 17, 2026 at 10:58 PM");
  });
});


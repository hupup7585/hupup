import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Promo text length, two pictures, preview, cost (Abraham, all-in-one section 7). In-memory database. */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string; mediaUrl?: string[] }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string; mediaUrl?: string[] }) => (h.sent.push(p), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PROMO_MAX_CHARS, offerWithLink, promoCostEstimate, promoTextV2, rentalsUrl } from "@/lib/promo-text";
import { originalOf, saveOriginalChunk, savePromoPicture } from "@/lib/promo-pictures";
import { approveCampaign, campaignMessage, createCampaign, sendCampaign } from "@/lib/campaigns";
import { GET as publicPicture } from "@/app/api/media/promo/[token]/route";

const NOON = new Date("2026-11-10T17:00:00Z");
const jpg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4, 7)]);

beforeAll(async () => {
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
  const [c] = await db.insert(schema.customers).values({ name: "Promo fan", phone: "+18455550901", marketingOptIn: true, marketingOptInAt: NOON, timeZone: "America/New_York" }).returning();
  await db.insert(schema.smsConsents).values({ customerId: c.id, phone: c.phone!, scope: "marketing", action: "opt_in", source: "sms_reply", method: "sms_reply", wording: "x" });
});

describe("length: up to 1,600 characters, counting the required start and ending", () => {
  it("the count includes 'Hup Up Attractions:' and the NOPROMO/STOP ending", () => {
    const t = promoTextV2("Big sale");
    expect(t).toBe("Hup Up Attractions: Big sale Reply NOPROMO to stop promos, STOP to stop all texts.");
    expect(PROMO_MAX_CHARS).toBe(1600);
  });
  it("saving blocks anything over 1,600 with a clear message; 1,600 exactly is fine", async () => {
    const room = PROMO_MAX_CHARS - promoTextV2("x").length + 1;
    await expect(createCampaign({ name: "Long", body: "a".repeat(room + 1) }, 1)).rejects.toThrow(/Too long: 1601 characters .* most is 1600/);
    const ok = await createCampaign({ name: "Exact", body: "a".repeat(room) }, 1);
    expect((await campaignMessage(ok)).text.length).toBe(1600);
  });
  it("the optional Rentals page link is added to the offer and counted", () => {
    expect(offerWithLink("Summer deal!", true, "https://hupup.vercel.app")).toBe("Summer deal! https://hupup.vercel.app/#rentals");
    expect(rentalsUrl("https://hupup.vercel.app/")).toBe("https://hupup.vercel.app/#rentals");
  });
});

describe("pictures", () => {
  it("accepts phone-ready JPGs up to about 500 KB, rejects non-JPG and oversize; full-size originals are welcome", async () => {
    await expect(savePromoPicture({ jpg: Buffer.from("PNG..."), width: 1080, height: 720, source: "catalog", userId: 1 })).rejects.toThrow(/JPG/);
    await expect(savePromoPicture({ jpg: jpg(700_000), width: 1080, height: 720, source: "catalog", userId: 1 })).rejects.toThrow(/too big/);
    await expect(savePromoPicture({ jpg: jpg(400_000), width: 1080, height: 720, source: "upload", originalType: "image/gif", originalBytes: 100, userId: 1 })).rejects.toThrow(/JPG, JPEG or PNG/);
    const big = await savePromoPicture({ jpg: jpg(480_000), width: 1080, height: 1440, source: "upload", originalType: "image/jpeg", originalBytes: 12 * 1024 * 1024, fileName: "IMG_1234.JPG", userId: 1 });
    expect(big.jpgBytes).toBe(480_000);
  });
  it("keeps the full-size original, sent in pieces, and puts it back together", async () => {
    const original = Buffer.alloc(7 * 1024 * 1024, 3);
    const p = await savePromoPicture({ jpg: jpg(300_000), width: 1080, height: 810, source: "upload", originalType: "image/png", originalBytes: original.length, userId: 1 });
    const C = 3 * 1024 * 1024;
    expect((await saveOriginalChunk(p.id, 0, original.subarray(0, C), false)).complete).toBe(false);
    await saveOriginalChunk(p.id, 1, original.subarray(C, 2 * C), false);
    expect((await saveOriginalChunk(p.id, 2, original.subarray(2 * C), true)).complete).toBe(true);
    const back = await originalOf(p.id);
    expect(back?.type).toBe("image/png");
    expect(back?.data.equals(original)).toBe(true);
  });
  it("the public picture link serves the JPG by its unguessable token only", async () => {
    const p = await savePromoPicture({ jpg: jpg(1000), width: 10, height: 10, source: "catalog", productId: 3, userId: 1 });
    const r = await publicPicture(new Request("https://x"), { params: Promise.resolve({ token: `${p.token}.jpg` }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect((await publicPicture(new Request("https://x"), { params: Promise.resolve({ token: "nope" }) })).status).toBe(404);
  });
  it("at most two pictures per promo text", async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await savePromoPicture({ jpg: jpg(1000), width: 10, height: 10, source: "catalog", userId: 1 })).id);
    await expect(createCampaign({ name: "Three", body: "Three pictures deal", pictureIds: ids }, 1)).rejects.toThrow(/At most 2 pictures/);
  });
});

describe("sending: MMS with pictures, SMS without, from (845) 415-7585, records kept", () => {
  it("a campaign with two pictures goes out as MMS with both picture links and the link to Rentals", async () => {
    const a = await savePromoPicture({ jpg: jpg(450_000), width: 1080, height: 720, source: "catalog", productId: 1, userId: 1 });
    const b = await savePromoPicture({ jpg: jpg(420_000), width: 1080, height: 1080, source: "catalog", productId: 2, userId: 1 });
    const c = await createCampaign({ name: "Winter", body: "Winter deal: 10% off bounce houses.", pictureIds: [a.id, b.id], rentalsLink: true }, 1);
    await approveCampaign(c.id, 1);
    h.sent.length = 0;
    await sendCampaign(c.id, 1, NOON);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].body).toBe("Hup Up Attractions: Winter deal: 10% off bounce houses. https://hupup.vercel.app/#rentals Reply NOPROMO to stop promos, STOP to stop all texts.");
    expect(h.sent[0].mediaUrl).toEqual([`https://hupup.vercel.app/api/media/promo/${a.token}.jpg`, `https://hupup.vercel.app/api/media/promo/${b.token}.jpg`]);
    const [row] = await db.select().from(schema.messages).where(eq(schema.messages.event, `campaign:${c.id}`));
    expect(row.mediaUrls).toHaveLength(2); // which pictures were sent is on record
  });
  it("cost estimate: MMS per message with pictures, SMS per segment without", () => {
    const mms = promoCostEstimate(promoTextV2("Deal"), 2, 100);
    expect(mms.kind).toBe("MMS");
    expect(mms.total).toBeCloseTo(mms.perCustomer * 100);
    const sms = promoCostEstimate(promoTextV2("a".repeat(300)), 0, 10);
    expect(sms.kind).toBe("SMS");
    expect(sms.perCustomer).toBeCloseTo(3 * (0.0083 + 0.003));
  });
  it("the screen converts every picture in the browser to a JPG about 1080 px wide at most about 500 KB, and previews it", () => {
    const shrink = readFileSync("src/lib/picture-shrink.ts", "utf8");
    expect(shrink).toContain('"image/jpeg"');
    expect(shrink).toContain("PICTURE_WIDTH");
    expect(shrink).toContain('imageOrientation: "from-image"');
    const ui = readFileSync("src/app/admin/(app)/campaigns/CampaignComposer.tsx", "utf8");
    for (const s of ["data-char-counter", "data-picture-slot", "data-promo-preview", "data-cost", "data-rentals-link", "Pick a catalog photo", "Upload JPG or PNG", 'accept="image/jpeg,image/png"']) expect(ui).toContain(s);
  });
});

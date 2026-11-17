import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Catalog and answers (Abraham, Nov 17, 2026). In-memory database; R2 and texts are stand-ins. */
const h = vi.hoisted(() => ({ stored: new Map<string, Uint8Array>() }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/r2", async (orig) => ({
  ...(await orig<typeof import("@/lib/r2")>()),
  r2Put: async (key: string, data: Uint8Array) => void h.stored.set(key, data),
  r2Get: async (key: string) => (h.stored.has(key) ? new Response(new Uint8Array(h.stored.get(key)!)) : new Response("no", { status: 404 })),
}));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireOwner: async () => ({ userId: 1, role: "owner", name: "Owner", phone: "+18457777585" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { deliveryPromoActive, zoneFee } from "@/lib/delivery-areas";
import { trashProductAction, uploadCatalogPhotoAction } from "@/app/admin/(app)/catalog/actions";
import { GET as catalogPhoto } from "@/app/api/catalog-photo/[...key]/route";
import { catalogTextMessages } from "@/lib/catalog-send";
import { saveSetting } from "@/lib/settings";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(3)]);
let productId = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 15000, quantity: 1, active: true }).returning();
  productId = p.id;
});

describe("free delivery promo counts by the delivery date", () => {
  it("a delivery inside the dates gets it, even if booked before; one after the end does not", () => {
    const on = { deliveryPromoOn: true, deliveryPromoStart: "2026-12-01", deliveryPromoEnd: "2026-12-10" };
    expect(deliveryPromoActive(on, "2026-12-05")).toBe(true);
    expect(zoneFee("local", on, "2026-12-05")).toBe(0);
    expect(zoneFee("local", on, "2026-12-11")).toBe(1000);
    expect(zoneFee("area", on, "2026-11-30")).toBe(1500);
    expect(readFileSync("src/lib/order-pricing.ts", "utf8")).toContain("priceOrder(fresh.subtotalCents, o.deliveryAddress, s, undefined, o.eventDate)");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain("deliveryFeeFor(quote.kind, settings, o.order.eventDate, o.order.offerNote)");
  });
});

describe("item added: book another day", () => {
  it("the line is there, after keep shopping", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.another_day.text).toBe("To book another day, press 2.");
    expect(PROMPTS.ocean_balls.text.endsWith("To skip, press pound.")).toBe(true);
  });
});

describe("catalog photos and Garbage", () => {
  it("a photo upload is kept in R2 and shown on the website through a public catalog route", async () => {
    const fd = new FormData();
    fd.set("kind", "product");
    fd.set("id", String(productId));
    fd.set("photo", new File([jpeg], "hop.jpg", { type: "image/jpeg" }));
    expect(await uploadCatalogPhotoAction(fd)).toEqual({ ok: true, message: "Photo saved." });
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(p.imageUrl).toMatch(/^\/api\/catalog-photo\/catalog\/products\/\d+-[0-9a-f-]+\.jpg$/);
    const key = p.imageUrl!.replace("/api/catalog-photo/", "").split("/");
    const r = await catalogPhoto(new Request("https://x"), { params: Promise.resolve({ key }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    // only catalog pictures: never a delivery photo or a text file
    expect((await catalogPhoto(new Request("https://x"), { params: Promise.resolve({ key: ["orders", "1", "delivery", "a.jpg"] }) })).status).toBe(404);
    const bad = new FormData();
    bad.set("kind", "product");
    bad.set("id", String(productId));
    bad.set("photo", new File([new TextEncoder().encode("%PDF-1.7")], "x.pdf"));
    expect((await uploadCatalogPhotoAction(bad)).ok).toBe(false);
  });
  it("Garbage takes the item off everything; Restore brings it back", async () => {
    const fd = new FormData();
    fd.set("id", String(productId));
    await expect(trashProductAction(fd)).rejects.toThrow(/REDIRECT/);
    let [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(p.trashedAt).not.toBeNull();
    expect(p.active).toBe(false);
    fd.set("restore", "1");
    await expect(trashProductAction(fd)).rejects.toThrow(/REDIRECT/);
    [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(p.trashedAt).toBeNull();
    expect(p.active).toBe(true);
    const page = readFileSync("src/app/admin/(app)/catalog/page.tsx", "utf8");
    expect(page).toContain("data-garbage");
    expect(page).toContain("Put in Garbage");
  });
  it("catalog PDF and text pictures are on their own page (Catalog email & text); Catalog keeps categories and items", () => {
    const side = readFileSync("src/components/Sidebar.tsx", "utf8");
    expect(side).toContain('"/admin/catalog-send", FileText, "Catalog email & text", O]');
    const send = readFileSync("src/app/admin/(app)/catalog-send/page.tsx", "utf8");
    expect(send).toContain("await requireOwner()");
    expect(send).toContain("<CatalogPdf");
    expect(send).toContain("data-catalog-text-pictures");
    const cat = readFileSync("src/app/admin/(app)/catalog/page.tsx", "utf8");
    expect(cat).not.toContain("<CatalogPdf");
    expect(cat).not.toContain("data-catalog-text-pictures");
  });
  it("Offers is its own Owner page in the side menu, under Catalog", () => {
    const side = readFileSync("src/components/Sidebar.tsx", "utf8");
    expect(side.indexOf('"/admin/offers", Percent, "Offers", O]')).toBeGreaterThan(side.indexOf('"/admin/catalog", Package, "Catalog", O]'));
    const page = readFileSync("src/app/admin/(app)/offers/page.tsx", "utf8");
    expect(page).toContain("await requireOwner()");
    expect(page).toContain("data-offers");
    expect(readFileSync("src/app/admin/(app)/catalog/page.tsx", "utf8")).not.toContain("data-offers");
    expect(readFileSync("src/app/admin/(app)/offers/actions.ts", "utf8")).toContain("settings.offers_updated");
  });
  it("a mini garbage can next to Active in every item's edit form, asking first", () => {
    const page = readFileSync("src/app/admin/(app)/catalog/page.tsx", "utf8");
    const form = page.slice(page.indexOf("function ProductForm"), page.indexOf("export default async function CatalogPage"));
    expect(form).toContain("formAction={trashProductAction}");
    expect(form).toContain("data-trash-in-form");
    expect(form).toContain("Put \"${p.name}\" in Garbage?");
    expect(form.indexOf("Active</label>")).toBeLessThan(form.indexOf("<Trash2"));
    const btn = readFileSync("src/components/ConfirmSubmit.tsx", "utf8");
    expect(btn).toContain("window.confirm(message)");
    expect(btn).toContain("formAction={formAction}");
  });
});

describe("catalog by text: two messages", () => {
  it("without pictures: the words only (as before)", async () => {
    expect(await catalogTextMessages("Words")).toEqual([{ body: "Words", mediaUrls: [] }]);
  });
  it("picture 1 with the words, then picture 2 alone, in that order", async () => {
    const one = new FormData();
    one.set("kind", "text");
    one.set("id", "1");
    one.set("photo", new File([jpeg], "p1.jpg"));
    expect((await uploadCatalogPhotoAction(one)).ok).toBe(true);
    const two = new FormData();
    two.set("kind", "text");
    two.set("id", "2");
    two.set("photo", new File([jpeg], "p2.jpg"));
    expect((await uploadCatalogPhotoAction(two)).ok).toBe(true);
    const msgs = await catalogTextMessages("Hup Up Attractions: Here is our catalog");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].body).toBe("Hup Up Attractions: Here is our catalog");
    expect(msgs[0].mediaUrls[0]).toMatch(/^https:\/\/hupup\.example\/api\/catalog-photo\/catalog\/text\/1-/);
    expect(msgs[1]).toMatchObject({ body: "" });
    expect(msgs[1].mediaUrls[0]).toMatch(/\/catalog\/text\/2-/);
    await saveSetting("catalogTextPicture2", "");
    expect(await catalogTextMessages("W")).toHaveLength(1);
  });
});

describe("item dimensions (Abraham, Nov 17, 2026)", () => {
  it("each catalog item has a Dimensions field in Admin, saved with the item", async () => {
    const page = readFileSync("src/app/admin/(app)/catalog/page.tsx", "utf8");
    expect(page).toContain('name="dimensions"');
    expect(readFileSync("src/app/admin/(app)/catalog/actions.ts", "utf8")).toContain('dimensions: s(fd, "dimensions")');
    await db.update(schema.products).set({ dimensions: "15 by 15 feet" }).where(eq(schema.products.id, productId));
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(p.dimensions).toBe("15 by 15 feet");
  });
});

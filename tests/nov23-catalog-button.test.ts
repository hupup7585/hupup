import { beforeAll, describe, expect, it, vi } from "vitest";

/* Catalog email (Abraham, Nov 23, 2026): "View the catalog" button inside the box, opening the PDF on the website; the PDF stays attached. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; files: string[]; button: unknown; record?: boolean }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string, _t: string, files: { filename: string }[] = [], o: { button?: unknown } = {}) => (h.emails.push({ to, subject, files: files.map((f) => f.filename), button: o.button ?? null }), { sent: true }),
}));

import { brandedEmail } from "@/lib/email-brand";
import { CATALOG_BUTTON_LABEL, catalogPdfUrl, saveCatalogChunk, startCatalogUpload } from "@/lib/catalog-pdf";
import { GET } from "@/app/catalog/[file]/route";

const PDF = Buffer.from("%PDF-1.4\n% Hup Up test catalog\n%%EOF\n");
let fileId = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupupattractions.com";
  const f = await startCatalogUpload("Chanukah Catalog 2026.pdf", PDF.length, null);
  await saveCatalogChunk(f.id, 0, PDF, true);
  fileId = f.id;
  const { saveSetting } = await import("@/lib/settings");
  await saveSetting("catalogName", "Chanukah Catalog 2026", null);
});

describe("View the catalog button", () => {
  it("sits inside the box (between the message and the signature), exact text, a public link", () => {
    expect(CATALOG_BUTTON_LABEL).toBe("View our catalog");
    const url = catalogPdfUrl("https://hupupattractions.com/", 7);
    expect(url).toBe("https://hupupattractions.com/catalog/7.pdf");
    const e = brandedEmail("Dear valued customer,\n\nFind our catalog attached.", { baseUrl: "https://hupupattractions.com", button: { label: CATALOG_BUTTON_LABEL, url } });
    const body = e.html.indexOf("Find our catalog attached.");
    const button = e.html.indexOf(`href="${url}"`);
    const signature = e.html.indexOf("border-top:1px solid");
    expect(body).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(body);
    expect(signature).toBeGreaterThan(button);
    expect(e.html).toMatch(/<a href="https:\/\/hupupattractions\.com\/catalog\/7\.pdf" target="_blank"[^>]*>View our catalog<\/a>/);
    expect(e.html.indexOf("</table>\n</td></tr></table>")).toBeGreaterThan(button); // inside the card
    expect(e.html).toMatch(/align="center"[^>]*><table role="presentation" align="center"/); // centered
    expect(e.html).toContain("border-radius:12px"); // round corners
    expect(e.html).toContain('bgcolor="#8CCBFF"'); // the website's light blue
    expect(e.html).toMatch(/color:#123D73;text-decoration:none[^>]*>View our catalog/); // deep blue text, never white on sky
    expect(e.text).toContain("View our catalog: https://hupupattractions.com/catalog/7.pdf");
    expect(brandedEmail("Hello", { baseUrl: "https://x" }).html).not.toContain("View our catalog"); // other emails: no button
  });

  it("the PDF opens in the browser with no sign-in; unknown files are not found", async () => {
    const r = await GET(new Request("https://hupupattractions.com/catalog/x"), { params: Promise.resolve({ file: `${fileId}.pdf` }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="Chanukah Catalog 2026.pdf"');
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    expect((await GET(new Request("https://x"), { params: Promise.resolve({ file: "999.pdf" }) })).status).toBe(404);
    expect((await GET(new Request("https://x"), { params: Promise.resolve({ file: "../etc" }) })).status).toBe(404);
  });

  it("the automatic catalog email and Compose > Add our catalog both carry the button and the attachment", async () => {
    const { sendCatalogEmail } = await import("@/lib/catalog-send");
    await sendCatalogEmail("hupupattractions@gmail.com");
    expect(h.emails[0]).toMatchObject({ to: "hupupattractions@gmail.com", subject: "Chanukah Catalog 2026 - Hup Up Attractions", files: ["Chanukah Catalog 2026.pdf"], button: { label: "View our catalog", url: `https://hupupattractions.com/catalog/${fileId}.pdf` } });
    const { sendNewEmail } = await import("@/lib/inbox");
    await sendNewEmail({ to: "hupupattractions@gmail.com", subject: "Chanukah Catalog 2026", body: "Here it is.", fileIds: [], userId: null, attachCatalog: true });
    expect(h.emails[1]).toMatchObject({ files: ["Chanukah Catalog 2026.pdf"], button: { label: "View our catalog" } });
    await sendNewEmail({ to: "hupupattractions@gmail.com", subject: "Hello", body: "No catalog.", fileIds: [], userId: null });
    expect(h.emails[2].button).toBeNull();
  });
});

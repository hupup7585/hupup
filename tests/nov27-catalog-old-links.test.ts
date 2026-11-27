import { describe, expect, it, vi } from "vitest";

/* Abraham, Nov 27, 2026 (item 1): every old catalog link opens the CURRENT catalog right away; old files stay in Admin. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { catalogHistory, currentCatalog, saveCatalogChunk, startCatalogUpload } from "@/lib/catalog-pdf";
import { GET } from "@/app/catalog/[file]/route";

const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`);
async function upload(name: string, label: string) {
  const f = await startCatalogUpload(name, pdf(label).length, null);
  await saveCatalogChunk(f.id, 0, pdf(label), true);
  return f.id;
}
const open = async (file: string) => {
  const r = await GET(new Request(`https://hupupattractions.com/catalog/${file}`), { params: Promise.resolve({ file }) });
  return { status: r.status, body: r.status === 200 ? Buffer.from(await r.arrayBuffer()).toString() : "", cache: r.headers.get("cache-control"), name: r.headers.get("content-disposition") };
};

describe("old catalog links open the current catalog", () => {
  it("upload a new catalog -> the old link opens the new one, right away; Admin still lists the old file", async () => {
    const oldId = await upload("Summer 2026.pdf", "OLD SUMMER");
    expect((await open(`${oldId}.pdf`)).body).toContain("OLD SUMMER");
    const newId = await upload("Chanukah 2026.pdf", "NEW CHANUKAH");
    expect((await currentCatalog())?.id).toBe(newId);

    const viaOld = await open(`${oldId}.pdf`);
    expect(viaOld.status).toBe(200);
    expect(viaOld.body).toContain("NEW CHANUKAH");
    expect(viaOld.body).not.toContain("OLD SUMMER");
    expect(viaOld.name).toBe('inline; filename="Chanukah 2026.pdf"');
    expect(viaOld.cache).toMatch(/no-store/); // never cached, so the switch is immediate
    // any other old catalog URL shape also opens the current one
    for (const f of [`${newId}.pdf`, "12345.pdf", "catalog.pdf", "Summer%202026.pdf", "current"]) expect((await open(f)).body).toContain("NEW CHANUKAH");

    const history = await catalogHistory();
    expect(history.map((h) => h.id)).toEqual(expect.arrayContaining([oldId, newId]));
    expect(history.find((h) => h.id === oldId)?.fileName).toBe("Summer 2026.pdf");
  });

  it("the Admin page passes the old files to the history list (Owner only download link)", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync("src/app/admin/(app)/catalog-send/page.tsx", "utf8");
    const comp = fs.readFileSync("src/app/admin/(app)/catalog/CatalogPdf.tsx", "utf8");
    expect(page).toContain("catalogHistory()");
    expect(comp).toContain("data-catalog-history");
    expect(comp).toContain("/api/admin/catalog-pdf/${h.id}");
  });
});

import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Abraham's catalog PDF (Phone Menu v3, section 9). Up to about 10 MB; sent in 3 MB pieces. */
export const CATALOG_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const CATALOG_PDF_CHUNK_BYTES = 3 * 1024 * 1024;

export async function startCatalogUpload(fileName: string, sizeBytes: number, userId: number | null) {
  if (!/\.pdf$/i.test(fileName)) throw new Error("Upload a PDF file.");
  if (sizeBytes <= 0 || sizeBytes > CATALOG_PDF_MAX_BYTES) throw new Error("Keep the catalog PDF under 10 MB.");
  const [f] = await db.insert(schema.catalogFiles).values({ fileName: fileName.slice(0, 200), sizeBytes, uploadedBy: userId }).returning();
  return f;
}

/** One piece; the last piece checks the size and makes this the current catalog (the old one is kept, not current). */
export async function saveCatalogChunk(fileId: number, idx: number, data: Buffer, last: boolean) {
  if (data.length === 0 || data.length > CATALOG_PDF_CHUNK_BYTES) throw new Error("That piece of the file didn't arrive.");
  await db.insert(schema.catalogFileChunks).values({ fileId, idx, data }).onConflictDoNothing();
  if (!last) return { complete: false };
  const [f] = await db.select().from(schema.catalogFiles).where(eq(schema.catalogFiles.id, fileId)).limit(1);
  const chunks = await db.select({ data: schema.catalogFileChunks.data }).from(schema.catalogFileChunks).where(eq(schema.catalogFileChunks.fileId, fileId));
  const total = chunks.reduce((n, c) => n + c.data.length, 0);
  if (!f || total !== f.sizeBytes) return { complete: false };
  const first = (await db.select().from(schema.catalogFileChunks).where(and(eq(schema.catalogFileChunks.fileId, fileId), eq(schema.catalogFileChunks.idx, 0))).limit(1))[0];
  if (!first || first.data.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("That file isn't a PDF.");
  await db.update(schema.catalogFiles).set({ current: false }).where(eq(schema.catalogFiles.current, true));
  await db.update(schema.catalogFiles).set({ complete: true, current: true }).where(eq(schema.catalogFiles.id, fileId));
  return { complete: true };
}

export async function currentCatalog() {
  const [f] = await db.select().from(schema.catalogFiles).where(eq(schema.catalogFiles.current, true)).limit(1);
  return f ?? null;
}

export async function catalogPdfBytes(fileId: number): Promise<Buffer | null> {
  const chunks = await db.select().from(schema.catalogFileChunks).where(eq(schema.catalogFileChunks.fileId, fileId)).orderBy(asc(schema.catalogFileChunks.idx));
  return chunks.length ? Buffer.concat(chunks.map((c) => c.data)) : null;
}

/** The current catalog as an email attachment, or null when none is uploaded. */
export async function catalogPdfAttachment() {
  const f = await currentCatalog();
  if (!f) return null;
  const data = await catalogPdfBytes(f.id);
  if (!data) return null;
  return { filename: f.fileName, content: data.toString("base64") };
}

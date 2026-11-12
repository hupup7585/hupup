"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { saveCatalogChunk, startCatalogUpload } from "@/lib/catalog-pdf";

type R = { ok: boolean; message: string; id?: number };

/** Abraham (Phone Menu v3, section 9): upload or replace the catalog PDF, in 3 MB pieces. The old file is kept. */
export async function startCatalogPdfAction(fileName: string, size: number): Promise<R> {
  const s = await requireOwner();
  try {
    const f = await startCatalogUpload(fileName, size, s.userId);
    return { ok: true, message: "", id: f.id };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function catalogPdfChunkAction(form: FormData): Promise<R> {
  const s = await requireOwner();
  try {
    const id = Number(form.get("id"));
    const blob = form.get("data") as Blob | null;
    if (!blob) return { ok: false, message: "That piece of the file didn't arrive." };
    const r = await saveCatalogChunk(id, Number(form.get("idx")), Buffer.from(await blob.arrayBuffer()), form.get("last") === "1");
    if (!r.complete) return { ok: true, message: "" };
    await db.insert(schema.auditLog).values({ userId: s.userId, action: "catalog.pdf_uploaded", entityType: "catalog_file", entityId: String(id), after: {} });
    revalidatePath("/admin/catalog");
    return { ok: true, message: "Uploaded. Catalog emails now send this PDF." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

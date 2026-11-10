"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createCampaign } from "@/lib/campaigns";
import { ORIGINAL_CHUNK_BYTES, pictureUrl, saveOriginalChunk, savePromoPicture } from "@/lib/promo-pictures";

export type PictureResult = { ok: true; id: number; url: string; jpgBytes: number } | { ok: false; message: string };

/** Owner: save a phone-ready promo picture (already converted to JPG in the browser). */
export async function uploadPromoPictureAction(form: FormData): Promise<PictureResult> {
  const s = await requireOwner();
  try {
    const file = form.get("jpg");
    if (!(file instanceof Blob)) return { ok: false, message: "No picture arrived." };
    const p = await savePromoPicture({
      jpg: Buffer.from(await file.arrayBuffer()),
      width: Number(form.get("width")),
      height: Number(form.get("height")),
      source: form.get("source") === "catalog" ? "catalog" : "upload",
      productId: form.get("productId") ? Number(form.get("productId")) : null,
      fileName: String(form.get("fileName") ?? "") || null,
      originalType: String(form.get("originalType") ?? "") || null,
      originalBytes: form.get("originalBytes") ? Number(form.get("originalBytes")) : null,
      userId: s.userId,
    });
    return { ok: true, id: p.id, url: pictureUrl(p.token), jpgBytes: p.jpgBytes };
  } catch (e) {
    return { ok: false, message: (e as Error).message || "The picture couldn't be saved." };
  }
}

/** Owner: one piece of the full-size original (kept for the website and Rentals page). */
export async function uploadOriginalChunkAction(form: FormData): Promise<{ ok: boolean; complete?: boolean; message?: string }> {
  await requireOwner();
  try {
    const data = form.get("data");
    if (!(data instanceof Blob) || data.size > ORIGINAL_CHUNK_BYTES) return { ok: false, message: "That piece of the photo didn't arrive." };
    const r = await saveOriginalChunk(Number(form.get("id")), Number(form.get("idx")), Buffer.from(await data.arrayBuffer()), form.get("last") === "1");
    return { ok: true, complete: r.complete };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Owner: save the campaign draft with its pictures and the optional Rentals page link. */
export async function saveCampaignDraftAction(input: { name: string; body: string; pictureIds: number[]; rentalsLink: boolean }): Promise<{ ok: boolean; message: string }> {
  const s = await requireOwner();
  try {
    await createCampaign(input, s.userId);
  } catch (e) {
    return { ok: false, message: (e as Error).message || "Something went wrong." };
  }
  revalidatePath("/admin/campaigns");
  return { ok: true, message: "Draft saved. Approve the wording when it's ready." };
}

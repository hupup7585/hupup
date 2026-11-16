"use client";

import { useState, useTransition } from "react";
import { uploadCatalogPhotoAction } from "./actions";

/** Shrink a big photo to at most 1600 pixels as a JPEG (like the delivery photos). */
async function shrink(file: File): Promise<Blob> {
  if (file.size <= 1024 * 1024) return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    return b ?? file;
  } catch {
    return file;
  }
}

/** Upload a photo for an item or a category (Owner). Shows the current photo. */
export default function PhotoUpload({ kind, id, current }: { kind: "product" | "category" | "text"; id: number; current: string | null }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(current);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3" data-photo-upload>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="h-20 w-20 rounded-lg border border-line object-cover" />
      ) : (
        <span className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">No photo</span>
      )}
      <label className="btn-ghost cursor-pointer">
        {pending ? "Uploading..." : preview ? "Change photo" : "Upload photo"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            start(async () => {
              const blob = await shrink(f);
              const fd = new FormData();
              fd.set("kind", kind);
              fd.set("id", String(id));
              fd.set("photo", new File([blob], f.name, { type: blob.type || f.type }));
              const r = await uploadCatalogPhotoAction(fd);
              setMsg(r);
              if (r.ok) setPreview(URL.createObjectURL(blob));
            });
          }}
        />
      </label>
      {msg && <span className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral"}`}>{msg.message}</span>}
    </div>
  );
}

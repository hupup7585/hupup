"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { sendReplyAction, uploadTextFileAction } from "./actions";

/** Twilio's picture-text limits: up to 10 files, 5 MB in all. Each file goes up on its own (up to 4 MB). */
const MAX_FILES = 10;
const MAX_TOTAL = 5 * 1024 * 1024;
const MAX_ONE = 4 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/gif", "application/pdf"];
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

type Picked = { key: string; file: File | Blob; name: string; type: string; size: number; preview: string | null };

/** A big phone photo (JPG or PNG over 1 MB) is shrunk to 1600 pixels as a JPEG, like the delivery photos. GIF and PDF stay as they are. */
async function shrink(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  if (!(file.type === "image/jpeg" || file.type === "image/png") || file.size <= 1024 * 1024) return { blob: file, type: file.type, name: file.name };
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    if (blob && blob.size < file.size) return { blob, type: "image/jpeg", name: file.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg" };
  } catch {
    /* keep the original */
  }
  return { blob: file, type: file.type, name: file.name };
}

/** Reply box under a conversation (Owner). Attach photos (JPG, PNG, GIF) or PDFs; shows why a text was blocked. */
export default function ReplyForm({ phone }: { phone: string }) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const total = files.reduce((t, f) => t + f.size, 0);

  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [files]);

  async function pick(list: FileList | null) {
    setError(null);
    setSent(false);
    if (!list?.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!OK_TYPES.includes(f.type)) return setError(`"${f.name}" can't be sent. Attach a photo (JPG, PNG or GIF) or a PDF.`);
      if (next.length >= MAX_FILES) return setError(`You can attach up to ${MAX_FILES} files to one text.`);
      const s = await shrink(f);
      if (s.blob.size > MAX_ONE) return setError(`"${f.name}" is ${mb(s.blob.size)}. Each file can be up to 4 MB.`);
      if (next.reduce((t, x) => t + x.size, 0) + s.blob.size > MAX_TOTAL) return setError(`That would be more than 5 MB in one text. Send the rest in another text.`);
      next.push({ key: `${Date.now()}-${next.length}`, file: s.blob, name: s.name, type: s.type, size: s.blob.size, preview: s.type.startsWith("image/") ? URL.createObjectURL(s.blob) : null });
    }
    setFiles(next);
    if (input.current) input.current.value = "";
  }

  function send() {
    setError(null);
    setSent(false);
    start(async () => {
      const ids: number[] = [];
      for (const f of files) {
        const fd = new FormData();
        fd.set("phone", phone);
        fd.set("file", f.file instanceof File ? f.file : new File([f.file], f.name, { type: f.type }));
        const r = await uploadTextFileAction(fd);
        if (!r.ok) return setError(r.error);
        ids.push(r.id);
      }
      const fd = new FormData();
      fd.set("phone", phone);
      fd.set("body", body);
      fd.set("fileIds", ids.join(","));
      const r = await sendReplyAction(null, fd);
      if (r?.error) return setError(r.error);
      setBody("");
      setFiles([]);
      setSent(true);
    });
  }

  return (
    <form
      className="mt-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea name="body" rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} className="input" placeholder="Type a reply..." />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-attachments>
          {files.map((f) => (
            <li key={f.key} className="relative h-20 w-20 overflow-hidden rounded-lg border border-line bg-bg" title={`${f.name} (${mb(f.size)})`}>
              {f.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview} alt={f.name} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] font-semibold text-navy">
                  <FileText className="h-6 w-6" aria-hidden />
                  <span className="line-clamp-2 break-all">{f.name}</span>
                </span>
              )}
              <button type="button" aria-label={`Remove ${f.name}`} data-remove-file className="absolute right-0.5 top-0.5 grid h-6 w-6 place-items-center rounded-full bg-navy text-white" onClick={() => setFiles(files.filter((x) => x.key !== f.key))}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/gif,application/pdf" className="hidden" onChange={(e) => pick(e.target.files)} data-file-input />
        <button type="button" className="btn-ghost" disabled={pending || files.length >= MAX_FILES} onClick={() => input.current?.click()} data-attach>
          <Paperclip className="mr-1 inline h-4 w-4" aria-hidden /> Attach
        </button>
        <button className="btn-dark" disabled={pending || (!body.trim() && !files.length)}>{pending ? "Sending..." : "Send text"}</button>
        {files.length > 0 && <span className="text-xs text-muted">{files.length} file{files.length > 1 ? "s" : ""}, {mb(total)} of 5 MB</span>}
        {sent && <span className="text-sm font-semibold text-[#13895C]">Sent.</span>}
        {error && <span role="alert" className="text-sm font-semibold text-[#C83A2F]">{error}</span>}
      </div>
      <p className="text-xs text-muted">Sent from the hotline number. Photos (JPG, PNG, GIF) and PDFs go as a picture text, up to 10 files and 5 MB. Customers who replied STOP, or never agreed to order texts, won&rsquo;t receive it.</p>
    </form>
  );
}

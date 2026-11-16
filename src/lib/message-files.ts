import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db";
import { R2_STOP_BYTES, r2Put, r2Used } from "@/lib/r2";

/**
 * Files with texts (Abraham, Nov 16, 2026). Staff attach photos (JPG, PNG, GIF) or a PDF to a text; customers' pictures
 * and files come in the same way. Every file is kept in Cloudflare R2 (the same free bucket as the delivery photos)
 * and saved with its message, the customer and their booking.
 *
 * Twilio's picture-text (MMS) limits: up to 10 files, 5 MB in all.
 */
export const MMS_MAX_FILES = 10;
export const MMS_MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export type OutgoingKind = "image/jpeg" | "image/png" | "image/gif" | "application/pdf";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf" };
/** Types we show in the browser; anything else a customer sends is offered as a download only. */
export const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

/** What the file really is, from its first bytes (never from its name or what the browser says). */
export function fileKind(head: Uint8Array): OutgoingKind | "image/webp" | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (String.fromCharCode(...head.slice(0, 4)) === "GIF8") return "image/gif";
  if (String.fromCharCode(...head.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (head.length >= 12 && String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Staff attachments: photos (JPG, PNG, GIF) or PDF, up to 10 files and 5 MB in all. A plain reason when not. */
export function checkOutgoingFiles(files: { name: string; data: Uint8Array }[]): { ok: true; kinds: OutgoingKind[] } | { ok: false; error: string } {
  if (files.length > MMS_MAX_FILES) return { ok: false, error: `You can attach up to ${MMS_MAX_FILES} files to one text.` };
  const kinds: OutgoingKind[] = [];
  let total = 0;
  for (const f of files) {
    if (!f.data.length) return { ok: false, error: `"${f.name}" is empty.` };
    const k = fileKind(f.data.subarray(0, 16));
    if (!k || k === "image/webp") return { ok: false, error: `"${f.name}" can't be sent. Attach a photo (JPG, PNG or GIF) or a PDF.` };
    if (f.data.length > MMS_MAX_TOTAL_BYTES) return { ok: false, error: `"${f.name}" is ${mb(f.data.length)}. Each text can carry 5 MB in all.` };
    total += f.data.length;
    kinds.push(k);
  }
  if (total > MMS_MAX_TOTAL_BYTES) return { ok: false, error: `These files are ${mb(total)} together. One text can carry 5 MB in all: remove a file or send it in another text.` };
  return { ok: true, kinds };
}

/** The booking a file belongs with: the customer's newest booking that is not cancelled. */
export async function bookingFor(customerId: number | null | undefined): Promise<number | null> {
  if (!customerId) return null;
  const [o] = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.customerId, customerId), ne(schema.orders.status, "CANCELLED")))
    .orderBy(desc(schema.orders.createdAt))
    .limit(1);
  return o?.id ?? null;
}

export async function saveMessageFile(input: {
  data: Uint8Array;
  contentType: string;
  fileName?: string | null;
  direction: "in" | "out";
  contactPhone: string;
  customerId?: number | null;
  orderId?: number | null;
  messageId?: number | null;
  sourceUrl?: string | null;
  userId?: number | null;
}) {
  if ((await r2Used()) + input.data.length > R2_STOP_BYTES) throw new Error("File storage is almost at the free limit, so new files are paused. The Owner was told.");
  const ext = EXT[input.contentType] ?? "bin";
  const key = `messages/${input.contactPhone.replace(/\D/g, "")}/${new Date().toISOString().slice(0, 10)}-${randomUUID()}.${ext}`;
  await r2Put(key, input.data, input.contentType);
  const [row] = await db
    .insert(schema.messageFiles)
    .values({
      messageId: input.messageId ?? null,
      direction: input.direction,
      contactPhone: input.contactPhone,
      customerId: input.customerId ?? null,
      orderId: input.orderId ?? null,
      storageKey: key,
      contentType: input.contentType,
      sizeBytes: input.data.length,
      fileName: input.fileName?.slice(0, 200) ?? null,
      sourceUrl: input.sourceUrl ?? null,
      userId: input.userId ?? null,
    })
    .returning();
  return row;
}

/** Once the text is saved, its files point to it. */
export async function linkFilesToMessage(fileIds: number[], messageId: number) {
  if (fileIds.length) await db.update(schema.messageFiles).set({ messageId }).where(inArray(schema.messageFiles.id, fileIds));
}

/**
 * A picture or file a customer texted us: Twilio keeps it at MediaUrlN (signed in with our Twilio account). We keep our
 * own copy in R2, saved with the message, the customer and their booking. A file that can't be fetched is logged and
 * skipped; the text itself is already saved.
 */
export async function saveIncomingMedia(
  input: { messageId: number; from: string; customerId: number | null; media: { url: string; contentType?: string }[] },
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  if (!input.media.length) return 0;
  const orderId = await bookingFor(input.customerId);
  const auth = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` : null;
  let saved = 0;
  for (const m of input.media.slice(0, MMS_MAX_FILES)) {
    try {
      if (!/^https:\/\/api\.twilio\.com\//.test(m.url)) throw new Error("not a Twilio media link");
      const r = await fetcher(m.url, { headers: auth ? { authorization: auth } : {}, redirect: "follow" });
      if (!r.ok) throw new Error(`Twilio said ${r.status}`);
      const data = new Uint8Array(await r.arrayBuffer());
      if (!data.length || data.length > MMS_MAX_TOTAL_BYTES) throw new Error("empty or too big");
      const sniffed = fileKind(data.subarray(0, 16));
      const said = (m.contentType || r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
      await saveMessageFile({ data, contentType: sniffed ?? (INLINE_TYPES.has(said) ? "application/octet-stream" : said.slice(0, 100)), direction: "in", contactPhone: input.from, customerId: input.customerId, orderId, messageId: input.messageId, sourceUrl: m.url });
      saved++;
    } catch (e) {
      console.error(`[incoming text file] message ${input.messageId}: could not save a file (${(e as Error).message})`);
    }
  }
  return saved;
}

export async function filesForMessages(messageIds: number[]) {
  if (!messageIds.length) return [];
  return db.select().from(schema.messageFiles).where(inArray(schema.messageFiles.messageId, messageIds)).orderBy(asc(schema.messageFiles.id));
}

export async function filesForCustomer(customerId: number) {
  return db.select().from(schema.messageFiles).where(eq(schema.messageFiles.customerId, customerId)).orderBy(desc(schema.messageFiles.createdAt)).limit(100);
}

export async function filesForOrder(orderId: number) {
  return db.select().from(schema.messageFiles).where(eq(schema.messageFiles.orderId, orderId)).orderBy(desc(schema.messageFiles.createdAt)).limit(100);
}

/** Headers for serving a stored file: pictures and PDFs open in the browser; anything else only downloads. */
export function serveHeaders(f: { contentType: string; fileName: string | null; id: number }) {
  const inline = INLINE_TYPES.has(f.contentType);
  const name = (f.fileName || `file-${f.id}.${EXT[f.contentType] ?? "bin"}`).replace(/[^\w.\- ]/g, "_");
  return {
    "Content-Type": inline ? f.contentType : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  };
}

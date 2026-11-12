import { currentStaff } from "@/lib/auth";
import { fileBytes } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/** An Inbox attachment (Owner, signed in). Opened in the browser or downloaded. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await currentStaff();
  if (!s || s.role !== "owner") return new Response("Unauthorized", { status: 401 });
  const f = await fileBytes(Number((await ctx.params).id));
  if (!f) return new Response("Not found", { status: 404 });
  const name = f.file.fileName.replace(/[^\w.\- ]/g, "_");
  const download = new URL(req.url).searchParams.get("download") === "1";
  // Only images and PDFs open in the browser; anything else downloads (no HTML or scripts run from attachments)
  const inline = !download && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i.test(f.file.contentType);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": inline ? f.file.contentType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

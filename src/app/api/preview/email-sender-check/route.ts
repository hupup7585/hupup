import { emailEnvelope } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Email sender check (Abraham, Nov 12, 2026). Preview deployments only (behind Vercel Authentication).
 *  - no query: is hupupattractions.com verified in Resend? Sends from info@ to Resend's own test inbox
 *    (delivered@resend.dev); Resend refuses the send while the domain is unverified.
 *  - ?send=owner: the one test email to the owner's inbox (ADMIN_EMAIL), with the live sender and Reply-To.
 * Returns only Resend's status, error name and message id, never the key.
 */
export async function GET(req: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new Response("Not found", { status: 404 });
  if (!process.env.RESEND_API_KEY) return Response.json({ verified: false, reason: "RESEND_API_KEY is not set on preview" });
  const owner = new URL(req.url).searchParams.get("send") === "owner";
  const to = owner ? process.env.ADMIN_EMAIL || "hupupattractions@gmail.com" : "delivered@resend.dev";
  const env = owner ? process.env : { EMAIL_FROM: "Hup Up Attractions <info@hupupattractions.com>" };
  const envelope = emailEnvelope(to, env);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...envelope,
      subject: owner ? "Hup Up Attractions: test email from info@" : "Sender check",
      text: owner
        ? "Hello Abraham,\n\nThis is the test email you asked for. It should show as from Hup Up Attractions <info@hupupattractions.com>, and pressing Reply should go to info@hupupattractions.com.\n\nIf it landed in Spam, please mark it Not spam and let me know.\n\nHup Up Attractions"
        : "Domain verification check (Resend test inbox).",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
  return Response.json({ verified: res.ok, status: res.status, from: envelope.from, replyTo: envelope.reply_to, error: body.name ?? null, message: body.message ?? null, id: body.id ?? null });
}

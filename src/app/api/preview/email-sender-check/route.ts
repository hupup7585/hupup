export const dynamic = "force-dynamic";

/**
 * Is hupupattractions.com verified in Resend? (Abraham: switch the sender to info@ only once it is.)
 * Preview deployments only (behind Vercel Authentication). Sends from info@ to Resend's own test inbox
 * (delivered@resend.dev), so no real person gets anything; Resend refuses the send while the domain is unverified.
 * Returns only Resend's status and error name, never the key.
 */
export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return new Response("Not found", { status: 404 });
  if (!process.env.RESEND_API_KEY) return Response.json({ verified: false, reason: "RESEND_API_KEY is not set on preview" });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Hup Up Attractions <info@hupupattractions.com>",
      to: "delivered@resend.dev",
      subject: "Sender check",
      text: "Domain verification check (Resend test inbox).",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
  return Response.json({ verified: res.ok, status: res.status, error: body.name ?? null, message: body.message ?? null, id: body.id ?? null });
}

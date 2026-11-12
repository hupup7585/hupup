/**
 * Cloudflare Email Worker for info@hupupattractions.com (Hup Up Attractions, Nov 12, 2026). Free tier.
 *
 * 1. Forwards every email to hupupattractions@gmail.com FIRST, exactly as Email Routing does today, so the Gmail
 *    copy keeps working even if the website is down.
 * 2. Then sends the full original email to the website's Admin Inbox, in pieces of up to 3 MB
 *    (Vercel accepts at most 4.5 MB per request). A website problem never stops the Gmail copy.
 *
 * Worker settings (Cloudflare dashboard > Workers > this worker > Settings > Variables):
 *   SITE_URL               https://hupupattractions.com          (plain text)
 *   INBOUND_EMAIL_SECRET   the same value as INBOUND_EMAIL_SECRET in Vercel   (secret)
 */
const GMAIL = "hupupattractions@gmail.com";
const PIECE = 3 * 1024 * 1024;

export default {
  async email(message, env, ctx) {
    await message.forward(GMAIL);
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const id = crypto.randomUUID();
    const parts = Math.max(1, Math.ceil(raw.length / PIECE));
    ctx.waitUntil(
      (async () => {
        for (let i = 0; i < parts; i++) {
          const body = raw.slice(i * PIECE, (i + 1) * PIECE);
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetch(`${env.SITE_URL}/api/email/inbound-raw?id=${id}&i=${i}&n=${parts}`, {
                method: "POST",
                headers: { "x-inbound-secret": env.INBOUND_EMAIL_SECRET, "content-type": "application/octet-stream" },
                body,
              });
              if (res.ok) break;
            } catch (e) {
              // try again
            }
          }
        }
      })(),
    );
  },
};

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
    // Deep check C7: a Gmail forward error never stops the Admin inbox copy (the error is still reported at the end)
    let forwardError = null;
    try {
      await message.forward(GMAIL);
    } catch (e) {
      forwardError = e;
      console.error("info@ worker: Gmail forward failed", String(e));
    }
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const id = crypto.randomUUID();
    const parts = Math.max(1, Math.ceil(raw.length / PIECE));
    ctx.waitUntil(
      (async () => {
        for (let i = 0; i < parts; i++) {
          const body = raw.slice(i * PIECE, (i + 1) * PIECE);
          let ok = false;
          let last = "";
          for (let attempt = 0; attempt < 3 && !ok; attempt++) {
            try {
              const res = await fetch(`${env.SITE_URL}/api/email/inbound-raw?id=${id}&i=${i}&n=${parts}`, {
                method: "POST",
                headers: { "x-inbound-secret": env.INBOUND_EMAIL_SECRET, "content-type": "application/octet-stream" },
                body,
              });
              ok = res.ok;
              last = `status ${res.status}`;
              if (!ok && res.status >= 400 && res.status < 500) break; // refused (bad piece, too big, wrong secret): trying again won't help
            } catch (e) {
              last = String(e); // network: try again
            }
          }
          // Deep check C7: a piece that never arrived stops the upload and says so in the Worker log (the Gmail copy has it)
          if (!ok) {
            console.error(`info@ worker: Admin inbox upload stopped at piece ${i + 1} of ${parts} (${last}); the email is in Gmail only`);
            return;
          }
        }
      })(),
    );
    if (forwardError) throw forwardError;
  },
};

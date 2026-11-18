/**
 * Logo and signature on every email we send (Abraham, Nov 17, 2026): the Hup Up logo (hosted on our own site, never an
 * attachment) with "Hup Up Attractions Inc." beside it, a yellow line, the message, a thin blue line, then the
 * signature. A plain-text version goes along for email apps that block images. The Owner edits the signature in
 * Admin › Settings.
 */
// Abraham, Nov 18, 2026: on every email, "Thanks!" removed everywhere; the tagline under the name (small gray italics)
export const EMAIL_TAGLINE = "Bringing Something Special To Every Occasion";
export const EMAIL_SIGNATURE_DEFAULT = [
  "Hup Up Attractions",
  EMAIL_TAGLINE,
  "Jumping Balloons | Laser Tag | Inflatable Mazes | Paddle Boats",
  "(845) 777-7585 | info@hupupattractions.com | hupupattractions.com",
  "Kiryas Joel and Orange County, NY.",
].join("\n");

export const EMAIL_BUSINESS_NAME = "Hup Up Attractions Inc.";
/** The full-color logo (transparent PNG, 320 px wide), shown 140 px wide: sharp on retina screens. */
export const EMAIL_LOGO_PATH = "/brand/hupup-logo-320.png";

// Abraham, Nov 17, 2026 ("make the email look professional"): colors and sizes
const NAVY = "#123D73";
const YELLOW = "#FFD84D";
const PAGE = "#F4F7FB";
const TEXT = "#222222";
const GRAY = "#555555";
const DIVIDER = "#E3E8EF";
const FONT = "Arial, Helvetica, sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Phone numbers, email addresses and web addresses become tappable links, navy, no underline. */
function linkify(line: string): string {
  return esc(line).replace(
    /(\(\d{3}\)\s?\d{3}-\d{4})|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|net|org)(?:\/[^\s|]*)?)/gi,
    (m, phone: string | undefined, email: string | undefined) => {
      const href = phone ? `tel:+1${m.replace(/\D/g, "")}` : email ? `mailto:${m}` : m.startsWith("http") ? m : `https://${m}`;
      return `<a href="${href}" style="color:${NAVY};text-decoration:none">${m}</a>`;
    },
  );
}

/** The signature: "Thanks!" regular, the business name bold navy, the services line gray 14 px, contacts navy links. */
function signatureHtml(signature: string): string {
  return signature
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (!line) return `<div style="height:12px;line-height:12px;font-size:12px">&nbsp;</div>`;
      if (/^hup up attractions( inc\.?)?$/i.test(line)) return `<div style="font-size:16px;font-weight:700;color:${NAVY};line-height:1.6">${esc(line)}</div>`;
      if (line === EMAIL_TAGLINE) return `<div style="font-size:13px;font-style:italic;line-height:1.5;color:#777777;margin-bottom:4px">${esc(line)}</div>`;
      const linked = linkify(line);
      // Contact line: a little room around each "|" (Abraham's mock-up)
      if (linked !== esc(line)) return `<div style="font-size:14px;line-height:1.7;color:${NAVY}">${linked.replace(/ \| /g, " &nbsp;|&nbsp; ")}</div>`;
      if (/^thanks!?$/i.test(line)) return `<div style="font-size:16px;line-height:1.6;color:${TEXT}">${esc(line)}</div>`;
      return `<div style="font-size:14px;line-height:1.7;color:${GRAY}">${esc(line)}</div>`;
    })
    .join("");
}

/** The signature without its opening "Thanks!" line (and the blank line after it). */
export function withoutThanks(signature: string): string {
  return signature.replace(/^\s*thanks!?\s*\n(\s*\n)*/i, "").trim();
}

/** The email in both forms: HTML (logo header, message, signature) and plain text (message, then the signature). */
export function brandedEmail(text: string, opts: { baseUrl: string; signature?: string | null; promo?: { address: string; unsubscribeUrl: string }; noThanks?: boolean }): { html: string; text: string } {
  // No "Thanks!" on any email (Abraham, Nov 18, 2026), also when an older saved signature still starts with it
  const signature = withoutThanks((opts.signature ?? "").trim() || EMAIL_SIGNATURE_DEFAULT);
  const body = text.trim();
  // Promotional emails only (the law requires them): the mailing address and an Unsubscribe link at the very bottom
  const promoText = opts.promo ? `\n${opts.promo.address.trim() ? `${opts.promo.address.trim()}\n` : ""}Unsubscribe: ${opts.promo.unsubscribeUrl}\n` : "";
  const promoHtml = opts.promo
    ? `<tr><td class="hu-pad" style="padding:0 32px 24px 32px;font-family:${FONT};font-size:12px;line-height:1.6;color:#888888">${opts.promo.address.trim() ? `<div>${esc(opts.promo.address.trim())}</div>` : ""}<div><a href="${esc(opts.promo.unsubscribeUrl)}" style="color:#888888">Unsubscribe</a></div></td></tr>`
    : "";
  const plain = `${body}\n\n--\n${signature}\n${promoText}`;
  const bodyHtml = esc(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 18px 0">${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${NAVY}">$1</a>`)}</p>`)
    .join("");
  const logo = `${opts.baseUrl.replace(/\/$/, "")}${EMAIL_LOGO_PATH}`;
  // On a phone: the card goes full width, 20 px padding, the logo about 110 px, the name beside it (wrapping cleanly)
  const phoneCss = `@media only screen and (max-width:600px){.hu-outer{padding:0!important}.hu-card{border-radius:0!important;box-shadow:none!important}.hu-pad{padding-left:20px!important;padding-right:20px!important}.hu-logo{width:110px!important;height:auto!important}.hu-logo-cell{width:110px!important}.hu-name{font-size:19px!important;padding-left:14px!important}}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${phoneCss}</style></head><body style="margin:0;padding:0;background:${PAGE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}"><tr><td class="hu-outer" align="center" style="padding:32px 12px">
<table role="presentation" class="hu-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;box-shadow:0 2px 10px rgba(18,61,115,0.08);overflow:hidden;font-family:${FONT}">
<tr><td class="hu-pad" style="padding:28px 32px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
<td class="hu-logo-cell" style="vertical-align:middle;width:140px"><img class="hu-logo" src="${logo}" width="140" alt="Hup Up Attractions" style="display:block;border:0;width:140px;height:auto"></td>
<td class="hu-name" style="vertical-align:middle;padding-left:20px;font-family:${FONT};font-size:22px;font-weight:700;color:${NAVY};line-height:1.3">${EMAIL_BUSINESS_NAME}</td>
</tr></table>
</td></tr>
<tr><td style="height:4px;background:${YELLOW};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="hu-pad hu-body" style="padding:32px 32px 14px 32px;font-family:${FONT};font-size:16px;line-height:1.6;color:${TEXT}">${bodyHtml}</td></tr>
<tr><td class="hu-pad" style="padding:0 32px"><div style="border-top:1px solid ${DIVIDER};font-size:0;line-height:0">&nbsp;</div></td></tr>
<tr><td class="hu-pad" style="padding:22px 32px 30px 32px;font-family:${FONT}">${signatureHtml(signature)}</td></tr>
${promoHtml}
<tr><td style="height:4px;background:${NAVY};font-size:0;line-height:0">&nbsp;</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { html, text: plain };
}

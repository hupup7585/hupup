/**
 * Logo and signature on every email we send (Abraham, Nov 17, 2026): the Hup Up logo (hosted on our own site, never an
 * attachment) with "Hup Up Attractions Inc." beside it, a yellow line, the message, a thin blue line, then the
 * signature. A plain-text version goes along for email apps that block images. The Owner edits the signature in
 * Admin › Settings.
 */
export const EMAIL_SIGNATURE_DEFAULT = [
  "Thanks!",
  "",
  "Hup Up Attractions",
  "Jumping Balloons | Laser Tag | Inflatable Mazes | Paddle Boats",
  "(845) 777-7585 | info@hupupattractions.com | hupupattractions.com",
  "Kiryas Joel and Orange County, NY",
].join("\n");

export const EMAIL_BUSINESS_NAME = "Hup Up Attractions Inc.";
export const EMAIL_LOGO_PATH = "/brand/hupup-logo-h80@2x.png";

const NAVY = "#12386B";
const YELLOW = "#FFD229";
const BLUE_LINE = "#9CCBEF";
const LINK = "#1A73C8";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Phone numbers, email addresses and web addresses in a line become links (escaped first). */
function linkify(line: string): string {
  return esc(line).replace(
    /(\(\d{3}\)\s?\d{3}-\d{4})|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|net|org)(?:\/[^\s|]*)?)/gi,
    (m, phone: string | undefined, email: string | undefined) => {
      const href = phone ? `tel:+1${m.replace(/\D/g, "")}` : email ? `mailto:${m}` : m.startsWith("http") ? m : `https://${m}`;
      return `<a href="${href}" style="color:${LINK};text-decoration:none">${m}</a>`;
    },
  );
}

/** The signature as HTML: the business name line bold navy, contact lines as links, the rest plain. */
function signatureHtml(signature: string): string {
  return signature
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (!line) return `<div style="height:14px"></div>`;
      if (/^hup up attractions( inc\.?)?$/i.test(line)) return `<div style="margin-top:4px;font-size:18px;font-weight:700;color:${NAVY}">${esc(line)}</div>`;
      const linked = linkify(line);
      const isContact = linked !== esc(line);
      return `<div style="font-size:15px;line-height:1.6;color:${isContact ? LINK : "#555555"}">${linked}</div>`;
    })
    .join("");
}

/** The email in both forms: HTML (logo header, message, signature) and plain text (message, then the signature). */
export function brandedEmail(text: string, opts: { baseUrl: string; signature?: string | null; promo?: { address: string; unsubscribeUrl: string } }): { html: string; text: string } {
  const signature = (opts.signature ?? "").trim() || EMAIL_SIGNATURE_DEFAULT;
  const body = text.trim();
  // Promotional emails only (the law requires them): the mailing address and an Unsubscribe link at the very bottom
  const promoText = opts.promo ? `\n${opts.promo.address.trim() ? `${opts.promo.address.trim()}\n` : ""}Unsubscribe: ${opts.promo.unsubscribeUrl}\n` : "";
  const promoHtml = opts.promo
    ? `<tr><td class="hu-pad" style="padding:0 28px 24px 28px;font-size:12px;line-height:1.6;color:#888888">${opts.promo.address.trim() ? `<div>${esc(opts.promo.address.trim())}</div>` : ""}<div><a href="${esc(opts.promo.unsubscribeUrl)}" style="color:#888888">Unsubscribe</a></div></td></tr>`
    : "";
  const plain = `${body}\n\n--\n${signature}\n${promoText}`;
  const bodyHtml = esc(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0">${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${LINK}">$1</a>`)}</p>`)
    .join("");
  const logo = `${opts.baseUrl.replace(/\/$/, "")}${EMAIL_LOGO_PATH}`;
  // On a phone (Abraham, Nov 17, 2026, item 7): the logo and the name stack, the text gets more room
  const phoneCss = `@media only screen and (max-width:480px){.hu-hdr td{display:block!important;width:auto!important}.hu-name{padding:10px 0 0 0!important;font-size:20px!important}.hu-logo{width:64px!important;height:64px!important}.hu-pad{padding-left:18px!important;padding-right:18px!important}.hu-body{font-size:15px!important}}`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${phoneCss}</style></head><body style="margin:0;padding:24px 12px;background:#EEF2F7;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #D9DEE7;border-radius:14px;overflow:hidden">
<tr><td class="hu-pad" style="padding:20px 28px;background:#ffffff">
<table role="presentation" class="hu-hdr" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img class="hu-logo" src="${logo}" width="80" height="80" alt="Hup Up Attractions" style="display:block;border:0;width:80px;height:80px"></td>
<td class="hu-name" style="vertical-align:middle;padding-left:18px;font-size:24px;font-weight:700;color:${NAVY}">${EMAIL_BUSINESS_NAME}</td>
</tr></table>
</td></tr>
<tr><td style="height:5px;background:${YELLOW};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="hu-pad hu-body" style="padding:28px 28px 8px 28px;font-size:16px;line-height:1.6;color:#2B2B2B">${bodyHtml}</td></tr>
<tr><td class="hu-pad" style="padding:0 28px"><div style="border-top:1px solid ${BLUE_LINE}"></div></td></tr>
<tr><td class="hu-pad" style="padding:20px 28px 28px 28px">${signatureHtml(signature)}</td></tr>
${promoHtml}
</table>
</td></tr></table>
</body></html>`;
  return { html, text: plain };
}

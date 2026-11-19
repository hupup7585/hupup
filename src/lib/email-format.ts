/**
 * Formatted email text from the Compose formatting bar (Abraham, Nov 19, 2026, like Gmail): bold, italic, underline,
 * lists, text color and links. Only these survive; everything else (scripts, styles, images, frames, event handlers)
 * is removed before an email is sent, keeping the words.
 */
const KEEP = new Set(["b", "strong", "i", "em", "u", "ul", "ol", "li", "br", "p", "div", "span", "a", "font", "blockquote"]);
const DROP_WITH_CONTENT = /<(script|style|head|title|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const COLOR = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-z]{3,20})$/i;

function cleanAttrs(tag: string, attrs: string): string {
  const out: string[] = [];
  if (tag === "a") {
    const href = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const url = (href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim();
    if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) out.push(`href="${url.replace(/"/g, "&quot;")}"`);
  }
  // Text color only (from the color button): style="color: ..." or the older <font color="...">
  const style = attrs.match(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  const color = (style?.[2] ?? style?.[3] ?? "").match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim();
  const fontColor = tag === "font" ? attrs.match(/\bcolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) : null;
  const c = color ?? fontColor?.[2] ?? fontColor?.[3] ?? fontColor?.[4];
  if (c && COLOR.test(c.trim())) out.push(`style="color:${c.trim()}"`);
  return out.length ? ` ${out.join(" ")}` : "";
}

/** Keeps only the formatting the Compose bar makes; never anything that can run. */
export function cleanEmailHtml(html: string): string {
  return (html ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DROP_WITH_CONTENT, "")
    .replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (whole, name: string, attrs: string) => {
      const tag = name.toLowerCase();
      if (!KEEP.has(tag)) return "";
      const t = tag === "font" ? "span" : tag;
      if (whole.startsWith("</")) return t === "br" ? "" : `</${t}>`;
      return `<${t}${cleanAttrs(tag, attrs)}>`;
    });
}

/** Typed text (no formatting) as simple HTML, for opening a draft or a forward in the editor. */
export const textToHtml = (text: string) =>
  (text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

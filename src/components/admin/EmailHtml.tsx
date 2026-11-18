"use client";

import { useRef, useState } from "react";

/**
 * An HTML email in a locked frame (Abraham, Nov 18, 2026: HTML emails showed as an empty white box). No scripts, forms
 * or pop-ups run. The frame grows to the email's height. If the email shows nothing readable in the frame, its text is
 * shown instead, so an email is never blank.
 */
export default function EmailHtml({ html, text }: { html: string; text: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const [blank, setBlank] = useState(false);
  // Links open in a new tab; a white page with dark text unless the email sets its own
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:8px;background:#fff;color:#111;font-family:Arial,sans-serif}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  const onLoad = () => {
    try {
      const d = ref.current?.contentDocument;
      if (!d?.body) return;
      setHeight(Math.min(Math.max(d.documentElement.scrollHeight, 200), 4000));
      const seen = (d.body.innerText ?? "").trim().length > 0 || d.images.length > 0;
      setBlank(!seen && text.trim().length > 0);
    } catch {
      /* the frame could not be measured: keep the default height */
    }
  };
  return (
    <div data-email-html>
      {!blank && <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={onLoad} style={{ height }} className="w-full rounded-lg border border-line bg-white" />}
      {blank && <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed">{text}</pre>}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Bold, Italic, Link2, List, ListOrdered, Palette, RemoveFormatting, Underline } from "lucide-react";

/** Text colors for the color button (our navy, our blue, plus the usual ones). */
const COLORS = ["#202124", "#123D73", "#2585D8", "#13895C", "#C83A2F", "#E37400", "#7A5AC8", "#5F6368"];

/**
 * The Compose box with Gmail's formatting bar (Abraham, Nov 19, 2026): bold, italic, underline, text color, bulleted and
 * numbered lists, link, remove formatting. The words go back as plain text too (drafts, search, the plain version).
 */
export default function RichEditor({ initialHtml, onChange, disabled, placeholder, rows = 8 }: { initialHtml: string; onChange: (text: string, html: string) => void; disabled?: boolean; placeholder?: string; rows?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
  }, [initialHtml]);
  const changed = () => ref.current && onChange(ref.current.innerText.replace(/ /g, " "), ref.current.innerHTML);
  const cmd = (name: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, value);
    changed();
  };
  const btn = "rounded p-1.5 text-ink hover:bg-bg disabled:opacity-40";
  return (
    <div className="mt-3 rounded-xl border border-line focus-within:border-navy" data-rich-editor>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1" role="toolbar" aria-label="Formatting">
        <button type="button" className={btn} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("bold")} title="Bold" aria-label="Bold"><Bold className="h-4 w-4" /></button>
        <button type="button" className={btn} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("italic")} title="Italic" aria-label="Italic"><Italic className="h-4 w-4" /></button>
        <button type="button" className={btn} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("underline")} title="Underline" aria-label="Underline"><Underline className="h-4 w-4" /></button>
        <details className="relative">
          <summary className={`${btn} inline-flex cursor-pointer list-none`} title="Text color" aria-label="Text color"><Palette className="h-4 w-4" /></summary>
          <div className="absolute left-0 z-30 mt-1 grid w-40 grid-cols-4 gap-1 rounded-xl border border-line bg-white p-2 shadow-lg">
            {COLORS.map((c) => (
              <button key={c} type="button" className="h-7 w-7 rounded-full border border-line" style={{ background: c }} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("foreColor", c)} aria-label={`Color ${c}`} />
            ))}
          </div>
        </details>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" className={btn} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertUnorderedList")} title="Bulleted list" aria-label="Bulleted list"><List className="h-4 w-4" /></button>
        <button type="button" className={btn} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertOrderedList")} title="Numbered list" aria-label="Numbered list"><ListOrdered className="h-4 w-4" /></button>
        <button
          type="button"
          className={btn}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt("Web address (for example https://hupupattractions.com)");
            if (url && /^(https?:\/\/|mailto:|tel:)/i.test(url.trim())) cmd("createLink", url.trim());
          }}
          title="Insert link"
          aria-label="Insert link"
          data-insert-link
        >
          <Link2 className="h-4 w-4" />
        </button>
        <button type="button" className={btn} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("removeFormat")} title="Remove formatting" aria-label="Remove formatting"><RemoveFormatting className="h-4 w-4" /></button>
      </div>
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={changed}
        className="max-h-[60vh] overflow-y-auto px-3 py-2 text-[15px] leading-relaxed outline-none empty:before:text-muted empty:before:content-[attr(data-placeholder)] [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-navy [&_a]:underline"
        style={{ minHeight: `${rows * 1.6}rem` }}
      />
    </div>
  );
}

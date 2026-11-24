"use client";

import { useEffect } from "react";
import { caretAfterDigits, formatPhoneTyping } from "@/lib/phone-format";

/**
 * Every phone box on the site (type="tel" or inputmode="tel") gets its dashes while typing: 845-555-0123.
 * One listener for the whole page. It runs before React reads the box, and sets the value the way React expects, so
 * boxes kept in React state (New booking, Staff) get the dashed number too.
 */
export default function PhoneAutoFormat() {
  useEffect(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const onInput = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.type !== "tel" && el.inputMode !== "tel") return;
      if ((e as InputEvent).inputType?.startsWith("delete")) return; // deleting a dash works normally
      const before = el.value;
      const next = formatPhoneTyping(before);
      if (next === before) return;
      const caret = el.selectionStart ?? before.length;
      const digits = before.slice(0, caret).replace(/\D/g, "").length - (before.replace(/\D/g, "").length - next.replace(/\D/g, "").length);
      setter?.call(el, next);
      const pos = caretAfterDigits(next, digits);
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* some boxes do not allow a cursor position */
      }
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);
  return null;
}

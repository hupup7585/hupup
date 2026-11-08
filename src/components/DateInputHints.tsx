"use client";

import { useEffect } from "react";
import { hebrewDate } from "@/lib/dual-date";
import { yiddishDay } from "@/lib/yiddish-day";

/**
 * Staff date pickers (Abraham Y): under every date field on staff screens, the Hebrew date and the Yiddish day with
 * the week's parsha for the chosen date, e.g. "כ״ח חשון תשפ״ז · זונטאג, פרשת חיי שרה". Screens only.
 */
export default function DateInputHints() {
  useEffect(() => {
    const update = (input: HTMLInputElement) => {
      let hint = input.nextElementSibling as HTMLElement | null;
      if (!hint || !hint.hasAttribute("data-date-hint")) {
        hint = document.createElement("bdi");
        hint.setAttribute("data-date-hint", "");
        hint.setAttribute("dir", "rtl");
        hint.setAttribute("lang", "yi");
        hint.className = "mt-1 block text-xs text-muted";
        input.insertAdjacentElement("afterend", hint);
      }
      const v = input.value;
      const text = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${hebrewDate(v)} · ${yiddishDay(v)}` : "";
      if (hint.textContent !== text) hint.textContent = text; // only write when it changes (no observer loop)
    };
    const scan = () => document.querySelectorAll<HTMLInputElement>('main input[type="date"]').forEach(update);
    const onInput = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t instanceof HTMLInputElement && t.type === "date") update(t);
    };
    scan();
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    // Rescan when the page adds new date fields; ignore changes to our own hints
    const mo = new MutationObserver((records) => {
      if (records.every((r) => (r.target as Element).closest?.("[data-date-hint]") || [...r.addedNodes].every((n) => (n as Element).hasAttribute?.("data-date-hint")))) return;
      scan();
    });
    const main = document.querySelector("main");
    if (main) mo.observe(main, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      mo.disconnect();
    };
  }, []);
  return null;
}

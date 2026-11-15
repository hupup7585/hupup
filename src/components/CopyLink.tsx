"use client";

import { useState } from "react";

/** Copies a link to the clipboard (for example, a customer's invoice page to paste into a text or email). */
export default function CopyLink({ url, label }: { url: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      data-copy-link={url}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        } catch {
          window.prompt("Copy this link:", url);
        }
      }}
    >
      {done ? "Link copied" : label}
    </button>
  );
}

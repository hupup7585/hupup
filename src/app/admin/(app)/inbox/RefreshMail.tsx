"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Refresh the Inbox (Abraham, Nov 16, 2026): a button, and a quiet check every minute while the page is open, in view and in use. */
export default function RefreshMail() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState(() => new Date());
  // The arrows turn at least two full times, so it's clear the Inbox really checked (Abraham, Nov 16, 2026)
  const [spinning, setSpinning] = useState(false);
  const refresh = () => {
    setSpinning(true);
    setTimeout(() => setSpinning(false), 2000);
    start(() => {
      router.refresh();
      setAt(new Date());
    });
  };
  useEffect(() => {
    // Neon free plan (Nov 26, 2026): only while the tab is in view, and only while someone is using it. After 20
    // minutes without a mouse move, tap or key, the quiet check stops until someone uses the page again.
    let lastUse = Date.now();
    const used = () => (lastUse = Date.now());
    const events = ["mousemove", "keydown", "pointerdown", "scroll", "visibilitychange"] as const;
    events.forEach((e) => window.addEventListener(e, used, { passive: true }));
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastUse < 20 * 60_000) refresh();
    }, 60_000);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, used));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button type="button" onClick={refresh} disabled={pending || spinning} className="btn-ghost !py-1" data-refresh-mail title={`Checked ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}>
      <RefreshCw className={`inline-block h-4 w-4 align-[-0.15em] ${pending || spinning ? "animate-spin" : ""}`} aria-hidden /> Refresh
    </button>
  );
}

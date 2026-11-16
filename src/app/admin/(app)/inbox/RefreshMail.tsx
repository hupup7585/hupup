"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Refresh the Inbox (Abraham, Nov 16, 2026): a button, and a quiet check every minute while the page is open. */
export default function RefreshMail() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState(() => new Date());
  const refresh = () =>
    start(() => {
      router.refresh();
      setAt(new Date());
    });
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button type="button" onClick={refresh} disabled={pending} className="btn-ghost !py-1" data-refresh-mail title={`Checked ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}>
      <RefreshCw className={`inline-block h-4 w-4 align-[-0.15em] ${pending ? "animate-spin" : ""}`} aria-hidden /> Refresh
    </button>
  );
}

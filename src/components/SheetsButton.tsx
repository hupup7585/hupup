"use client";

import { useState } from "react";
import { Sheet } from "lucide-react";

/** "Every button answers" (Abraham, Nov 26, 2026; deep check 31): Open in Google Sheets says what is missing instead of being greyed out. */
export default function SheetsButton() {
  const [msg, setMsg] = useState("");
  return (
    <>
      <button type="button" className="btn-ghost inline-flex items-center gap-1.5" data-sheets-button onClick={() => setMsg("Needs a Google sign-in setup first (waiting for Abraham's approval). Meanwhile, download the Excel file and open it in Google Sheets.")}>
        <Sheet className="h-4 w-4" aria-hidden /> Open in Google Sheets
      </button>
      {msg && <span className="text-xs font-semibold text-muted" role="status" data-sheets-message>{msg}</span>}
    </>
  );
}

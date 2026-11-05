"use client";

import { Printer } from "lucide-react";

export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-ghost">
      <Printer className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}

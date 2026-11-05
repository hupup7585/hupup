"use client";

import { useState, useTransition } from "react";
import { agreeAndPayAction } from "./actions";
import { PAY_AGREE_LABEL } from "./label";

export default function PayForm({ orderId, token }: { orderId: number; token: string }) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await agreeAndPayAction(orderId, token, agreed);
          if (r?.error) setError(r.error);
        });
      }}
    >
      <label className="flex items-start gap-3 text-base">
        <input type="checkbox" name="agree" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-hu-deep" />
        <span>
          {PAY_AGREE_LABEL} (
          <a href="/terms" target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
            read the Terms and Conditions
          </a>
          )
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 font-semibold text-red-800">
          {error}
        </p>
      )}
      <button className="hu-btn w-full disabled:opacity-50" disabled={!agreed || pending}>
        {pending ? "One moment…" : "Continue to secure payment"}
      </button>
      <p className="text-sm text-hu-deep/70">You&rsquo;ll pay on our payment provider&rsquo;s secure page.</p>
    </form>
  );
}

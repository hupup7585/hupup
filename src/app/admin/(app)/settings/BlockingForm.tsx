"use client";

import { useActionState } from "react";
import { saveBlockListAction, testNumberAction } from "./blocking-actions";

/** Caller blocking list plus a "test a number" tool. */
export default function BlockingForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(saveBlockListAction, null);
  const [test, testAction] = useActionState(testNumberAction, null);
  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-3">
        <label className="block">
          <span className="label">One per line: number or pattern | note</span>
          <textarea name="blockedCallers" rows={4} defaultValue={initial} className="input font-mono text-sm" placeholder={"(845) 555-0199 | prank calls\n+1800* | toll-free sales calls\nwithheld | no caller ID"} />
          <span className="mt-1 block text-xs text-muted">* means any digits, ? means one digit, &ldquo;withheld&rdquo; means no caller ID. Blocked callers hear a busy signal.</span>
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save block list"}</button>
          {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
        </div>
      </form>
      <form action={testAction} className="flex flex-wrap items-center gap-2">
        <input name="number" placeholder="Test a number" className="input max-w-xs" />
        <button className="btn-ghost">Test</button>
        {test?.message && <span data-block-test className="text-sm font-semibold">{test.message}</span>}
      </form>
    </div>
  );
}

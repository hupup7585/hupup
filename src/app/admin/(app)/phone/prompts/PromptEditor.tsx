"use client";

import { useState, useTransition } from "react";
import { savePromptAction } from "./actions";

export default function PromptEditor(props: { promptKey: string; label: string; defaultText: string; vars: string[]; current: string }) {
  const [text, setText] = useState(props.current || props.defaultText);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const customized = Boolean(props.current) && props.current !== props.defaultText;
  return (
    <div className="border-b border-line pb-4 last:border-0 last:pb-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{props.label}</span>
        {customized && <span className="rounded-full bg-sun/30 px-2 py-0.5 text-xs font-bold">Customized</span>}
        {props.vars.length > 0 && <span className="text-xs text-muted">Uses {props.vars.map((v) => `{${v}}`).join(" ")}</span>}
      </div>
      <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="btn-dark !py-1.5 text-sm"
          disabled={pending}
          onClick={() => start(async () => setMsg(await savePromptAction(props.promptKey, text === props.defaultText ? "" : text)))}
        >
          Save
        </button>
        <button
          className="btn-ghost !py-1.5 text-sm"
          disabled={pending}
          onClick={() => {
            setText(props.defaultText);
            start(async () => setMsg(await savePromptAction(props.promptKey, "")));
          }}
        >
          Reset to default
        </button>
        {msg && <span className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</span>}
      </div>
    </div>
  );
}

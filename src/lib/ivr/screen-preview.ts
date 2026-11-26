import { randomUUID } from "node:crypto";
import { handleVoice } from "@/lib/ivr/flow";
import { GO_TO_SCREENS } from "@/lib/ivr/screens";
import { PREVIEW_PREFIX } from "@/lib/ivr/preview";
import type { Editor } from "@/lib/ivr/menu-editor";

/**
 * Test this screen (Admin handoff Phase 3, section 6, Nov 26, 2026): the exact phone instructions a caller would get
 * on a screen right now, with the Admin settings, recordings and timing that are live. Run as a preview call: nothing
 * is saved, nothing shows in the call log. Only screens that start fresh (no cart, no order, no earlier answers) can be
 * run this way; every other screen shows its lines and keys from the screen list.
 */
export const LIVE_PREVIEW_SCREENS: readonly string[] = GO_TO_SCREENS;

export type PreviewStep = { kind: "voice" | "recording" | "wait" | "pause" | "next" | "hangup" | "dial"; text: string };

const unescape = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const stepOf = (u: string) => unescape(u).replace(/^.*\/api\/voice\//, "").split("?")[0] || "the same step";

/** The phone instructions in plain words, in the order the caller hears them. */
export function describeTwiml(xml: string): PreviewStep[] {
  const out: PreviewStep[] = [];
  for (const m of xml.matchAll(/<(Say|Play|Gather|Pause|Redirect|Hangup|Dial|Record)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>|>)/g)) {
    const [, tag, attrs, , inner = ""] = m;
    if (tag === "Say") out.push({ kind: "voice", text: `Computer voice: "${unescape(inner)}"` });
    else if (tag === "Play" && /pause-500ms/.test(inner)) out.push({ kind: "pause", text: "Half-second pause" });
    else if (tag === "Play") out.push({ kind: "recording", text: `Recording: ${unescape(inner).replace(/^.*\//, "").split("?")[0]}` });
    else if (tag === "Gather") {
      const t = attr(attrs, "timeout");
      const n = attr(attrs, "numDigits");
      out.push({ kind: "wait", text: `Listens for ${n && n !== "1" ? `up to ${n} keys` : "a key"} while the lines below play, then waits ${t ?? "5"} seconds; a key goes to ${stepOf(attr(attrs, "action") ?? "")}` });
      out.push(...describeTwiml(inner).map((s) => ({ ...s, text: `   ${s.text}` })));
    } else if (tag === "Pause") out.push({ kind: "pause", text: `Pause of ${attr(attrs, "length") ?? "1"} second(s)` });
    else if (tag === "Redirect") out.push({ kind: "next", text: `If no key: goes to ${stepOf(inner)}` });
    else if (tag === "Hangup") out.push({ kind: "hangup", text: "The call ends" });
    else if (tag === "Dial") out.push({ kind: "dial", text: "Connects the call to a phone number" });
    else if (tag === "Record") out.push({ kind: "wait", text: `Records the caller for up to ${attr(attrs, "maxLength") ?? "?"} seconds` });
  }
  return out;
}

/**
 * Run a fresh-start screen as a preview call (nothing saved). Null when the screen cannot start fresh. With a draft,
 * the same screen is run a second time with the draft screens (Hark's review item 8), so Live and Draft can be shown
 * side by side; changed lines are marked.
 */
export async function previewScreen(id: string, draft?: Editor | null): Promise<{ xml: string; steps: PreviewStep[]; draft?: { xml: string; steps: PreviewStep[] } } | null> {
  if (!LIVE_PREVIEW_SCREENS.includes(id)) return null;
  const run = async (editorOverride?: Editor) => {
    const sid = `${PREVIEW_PREFIX}${randomUUID()}`;
    const xml = await handleVoice({ action: id, query: new URLSearchParams(), body: { CallSid: sid }, callSid: sid, from: "", ...(editorOverride ? { editorOverride } : {}) });
    return { xml, steps: describeTwiml(xml) };
  };
  const live = await run();
  return draft ? { ...live, draft: await run(draft) } : live;
}

/** Which lines differ between two previews (shown marked in each column). */
export function changedSteps(a: PreviewStep[], b: PreviewStep[]): { onlyA: Set<number>; onlyB: Set<number> } {
  const ta = a.map((s) => s.text.trim());
  const tb = b.map((s) => s.text.trim());
  return { onlyA: new Set(ta.flatMap((t, i) => (tb.includes(t) ? [] : [i]))), onlyB: new Set(tb.flatMap((t, i) => (ta.includes(t) ? [] : [i]))) };
}

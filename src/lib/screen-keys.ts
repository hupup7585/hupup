import { db, schema } from "@/lib/db";
import type { Editor, KeyAction } from "@/lib/ivr/menu-editor";
import { GO_TO_SCREENS } from "@/lib/ivr/screens";
import { RING_KEYS, RING_KEY_LABELS } from "@/lib/ivr/routing";
import { PROMPTS } from "@/lib/ivr/prompts";

/**
 * Every key set on Phone screens must go somewhere real (Hark's Phases 1-3 review, item 4, Nov 26, 2026). Before,
 * an unknown screen quietly went to the main menu and an unknown extension rang key 0. Now a bad target is refused
 * when the key is saved, checked again when the screens are published, and listed on the screen page (for example
 * an item archived later).
 */
export type KeyTargets = { products: Map<number, { name: string; active: boolean }>; lines: Set<string>; hotline: string | null };

export async function loadKeyTargets(): Promise<KeyTargets> {
  const products = new Map((await db.select({ id: schema.products.id, name: schema.products.name, active: schema.products.active }).from(schema.products)).map((p) => [p.id, { name: p.name, active: p.active }]));
  const { customSlots } = await import("@/lib/custom-slots");
  const lines = new Set<string>([...Object.keys(PROMPTS), ...(await customSlots()).map((s) => s.key)]);
  const { toE164 } = await import("@/lib/phone");
  return { products, lines, hotline: toE164(process.env.TWILIO_PHONE_NUMBER ?? "") ?? null };
}

const BOXES = new Set<string>([...RING_KEYS, "9"]);

/** Why a key's target does not work, in plain words; null = it works. */
export function keyTargetProblem(a: KeyAction, t: KeyTargets): string | null {
  switch (a.type) {
    case "screen":
      return (GO_TO_SCREENS as readonly string[]).includes(a.target) ? null : `"${a.target}" is not a menu or step a key can go to.`;
    case "ring":
      return (RING_KEYS as readonly string[]).includes(a.ext) ? null : `"${a.ext}" is not an extension that rings. Choose one of: ${RING_KEYS.map((k) => RING_KEY_LABELS[k]).join(", ")}.`;
    case "voicemail":
      return BOXES.has(a.box) ? null : `"${a.box}" is not a voicemail box.`;
    case "item": {
      const p = t.products.get(a.productId);
      if (!p) return "That item no longer exists. Choose another item.";
      return p.active ? null : `The item ${p.name} is switched off (archived). Choose another item or turn it back on in Catalog.`;
    }
    case "play": {
      if (!a.lines.length) return "Choose at least one recording to play.";
      const missing = a.lines.filter((l) => !t.lines.has(l));
      return missing.length ? `These recordings do not exist any more: ${missing.join(", ")}.` : null;
    }
    case "forward": {
      const digits = a.phone.replace(/\D/g, "");
      const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
      if (ten.length !== 10) return "Type a 10-digit US phone number to forward to.";
      if (t.hotline && `+1${ten}` === t.hotline) return "A key cannot forward to the hotline itself (the call would loop).";
      return null;
    }
    case "text":
      return a.text.trim() ? null : "Type the text to send.";
    case "back":
      return null;
  }
}

/** Every key whose target no longer works ("menu: key 5 ..."), for the publish check and the screen page. */
export function brokenKeys(e: Editor, t: KeyTargets): { screen: string; key: string; problem: string }[] {
  return Object.entries(e?.keys ?? {}).flatMap(([screen, list]) =>
    (list ?? []).flatMap((k) => {
      const problem = keyTargetProblem(k.action, t);
      return problem ? [{ screen, key: k.key, problem }] : [];
    }),
  );
}

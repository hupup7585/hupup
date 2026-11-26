"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { addCustomSlot } from "@/lib/custom-slots";
import { allSlots } from "@/lib/recording-slots";
import { customSlots } from "@/lib/custom-slots";
import { addLine, moveLine, removeKey, removeLine, setKey, toggleLine, KEY_ACTIONS, type Editor, type KeyAction } from "@/lib/ivr/menu-editor";
import { SCREENS } from "@/lib/ivr/screens";
import { ScreenDraftError, discardScreens, editingEditor, publishScreens, saveScreenDraft, undoScreens } from "@/lib/screen-drafts";

/**
 * Admin > Phone > Screens (Abraham, Nov 26, 2026): Owner only, audited. Draft first (Admin handoff Phase 3; Hark's
 * review M13): every change goes to the draft; callers hear it only after Publish (src/lib/screen-drafts.ts).
 */
async function read(): Promise<Editor> {
  return editingEditor();
}
async function save(screen: string, before: Editor, after: Editor, userId: number | null, action: string) {
  await saveScreenDraft(screen, before, after, userId, action);
  revalidatePath("/admin/phone/screens", "layout");
}
const back = (screen: string, q: string) => redirect(`/admin/phone/screens/${encodeURIComponent(screen)}?${q}`);
const where = (fd: FormData) => {
  const layout = String(fd.get("layout") ?? "");
  return layout ? { layout } : { screen: String(fd.get("screen") ?? "") };
};

export async function moveLineAction(fd: FormData) {
  const o = await requireOwner();
  const screen = String(fd.get("screen") ?? "");
  const e = await read();
  await save(screen, e, moveLine(e, where(fd), Number(fd.get("index")), fd.get("dir") === "up" ? -1 : 1), o.userId, "phone.screen_line_moved");
  back(screen, "ok=1");
}

export async function toggleLineAction(fd: FormData) {
  const o = await requireOwner();
  const screen = String(fd.get("screen") ?? "");
  const e = await read();
  await save(screen, e, toggleLine(e, where(fd), Number(fd.get("index")), fd.get("on") === "1"), o.userId, "phone.screen_line_switched");
  back(screen, "ok=1");
}

export async function removeLineAction(fd: FormData) {
  const o = await requireOwner();
  const screen = String(fd.get("screen") ?? "");
  const e = await read();
  await save(screen, e, removeLine(e, where(fd), Number(fd.get("index"))), o.userId, "phone.screen_line_removed");
  back(screen, "ok=1");
}

/** Add a line: any recording from the list, or a new one (its exact text; it gets its own slot for a recording). Starts off. */
export async function addLineAction(fd: FormData) {
  const o = await requireOwner();
  const screen = String(fd.get("screen") ?? "");
  let ref = String(fd.get("ref") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const text = String(fd.get("text") ?? "").trim();
  if (!ref && name && text) {
    const existing = allSlots([], {}, await customSlots()).map((s) => ({ key: s.key, group: s.group }));
    const r = await addCustomSlot({ name, group: "Menu lines", text, lookup: `${screen} ${name}` }, existing, o.userId);
    if (!r.ok) return back(screen, `err=${encodeURIComponent(r.message)}`);
    ref = r.key;
  }
  if (!ref) return back(screen, `err=${encodeURIComponent("Pick a recording from the list, or type a name and the exact words for a new one.")}`);
  const at = fd.get("at") === "" || fd.get("at") === null ? undefined : Number(fd.get("at"));
  const e = await read();
  await save(screen, e, addLine(e, where(fd), ref, at), o.userId, "phone.screen_line_added");
  back(screen, `ok=${encodeURIComponent("Added to the draft, switched off. Turn it on when its recording is ready, then publish.")}`);
}

export async function setKeyAction(fd: FormData) {
  const o = await requireOwner();
  const screen = String(fd.get("screen") ?? "");
  const type = String(fd.get("type") ?? "") as KeyAction["type"];
  if (!(type in KEY_ACTIONS)) return back(screen, "err=Choose what the key does.");
  const v = (k: string) => String(fd.get(k) ?? "").trim();
  const action: KeyAction =
    type === "screen" ? { type, target: v("target") }
    : type === "ring" ? { type, ext: v("ext") }
    : type === "voicemail" ? { type, box: v("box") }
    : type === "play" ? { type, lines: fd.getAll("lines").map(String).filter(Boolean) }
    : type === "text" ? { type, text: v("text"), ...(v("picture") ? { picture: v("picture") } : {}) }
    : type === "forward" ? { type, phone: v("phone") }
    : type === "item" ? { type, productId: Number(v("productId")) }
    : { type: "back" };
  // Every target must be real (Hark's review item 4): screen, extension, box, item, number and recordings
  const { keyTargetProblem, loadKeyTargets } = await import("@/lib/screen-keys");
  const problem = keyTargetProblem(action, await loadKeyTargets());
  if (problem) return back(screen, `err=${encodeURIComponent(`Not saved. ${problem}`)}`);
  const e = await read();
  const r = setKey(e, screen, { key: v("key"), on: fd.get("on") === "on", line: v("line") || undefined, action });
  if ("error" in r) return back(screen, `err=${encodeURIComponent(r.error)}`);
  await save(screen, e, r, o.userId, "phone.screen_key_set");
  back(screen, "ok=1");
}

export async function removeKeyAction(fd: FormData) {
  const o = await requireOwner();
  const screen = String(fd.get("screen") ?? "");
  if (!SCREENS[screen]) return back(screen, "err=Unknown screen.");
  const e = await read();
  await save(screen, e, removeKey(e, screen, String(fd.get("key") ?? "")), o.userId, "phone.screen_key_removed");
  back(screen, "ok=1");
}

/** Publish, discard and undo the draft (all screens at once). */
async function draftAction(fd: FormData, fn: (userId: number | null) => Promise<unknown>, done: string) {
  const o = await requireOwner();
  const screen = String(fd.get("screen") ?? "");
  let q = `ok=${encodeURIComponent(done)}`;
  try {
    await fn(o.userId);
  } catch (e) {
    if (!(e instanceof ScreenDraftError)) console.error("screen draft action failed", e);
    q = `err=${encodeURIComponent(e instanceof ScreenDraftError ? `Not done: ${e.message}` : "Not done: something went wrong. The live screens did not change.")}`;
  }
  revalidatePath("/admin/phone/screens", "layout");
  return screen ? back(screen, q) : redirect(`/admin/phone/screens?${q}`);
}
export async function publishScreensAction(fd: FormData) {
  await draftAction(fd, (u) => publishScreens(u, String(fd.get("reason") ?? "")), "Published. Callers hear the new screens from the next call step.");
}
export async function discardScreensAction(fd: FormData) {
  await draftAction(fd, (u) => discardScreens(u), "Draft discarded. The live screens did not change.");
}
export async function undoScreensAction(fd: FormData) {
  await draftAction(fd, (u) => undoScreens(u), "The screens from before the last publish are ready as a draft. Publish them to make them live.");
}

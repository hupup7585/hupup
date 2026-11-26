"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { addCustomSlot } from "@/lib/custom-slots";
import { allSlots } from "@/lib/recording-slots";
import { customSlots } from "@/lib/custom-slots";
import { addLine, moveLine, parseEditor, removeKey, removeLine, setKey, toggleLine, KEY_ACTIONS, type Editor, type KeyAction } from "@/lib/ivr/menu-editor";
import { SCREENS } from "@/lib/ivr/screens";

/** Admin > Phone > Screens (Abraham, Nov 26, 2026): Owner only, audited, live on the next call step. */
const SETTING = "screenEditor";

async function read(): Promise<Editor> {
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, SETTING)).limit(1);
  return parseEditor(row?.value);
}
async function save(screen: string, before: Editor, after: Editor, userId: number | null, action: string) {
  await db
    .insert(schema.appSettings)
    .values({ key: SETTING, value: after as never, updatedAt: new Date(), updatedBy: userId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: after as never, updatedAt: new Date(), updatedBy: userId } });
  await db.insert(schema.auditLog).values({ userId, action, entityType: "settings", entityId: `screen:${screen}`, before, after });
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
  back(screen, `ok=${encodeURIComponent("Added, switched off. Turn it on when its recording is ready.")}`);
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
  if (type === "text" && !("text" in action && action.text)) return back(screen, "err=Type the text to send.");
  if (type === "forward" && !/\d{10}/.test(v("phone").replace(/\D/g, ""))) return back(screen, "err=Type the 10-digit phone number to forward to.");
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

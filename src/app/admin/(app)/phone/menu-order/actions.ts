"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { getSettings, saveSetting } from "@/lib/settings";
import { MENU_RECORDINGS, menuOrder, setMenuOrder, type MenuId } from "@/lib/ivr/menu-order";

/** Owner only: move one recording of a menu up or down, or put the menu back in its first order. */
export async function moveMenuPartAction(form: FormData) {
  const owner = await requireOwner();
  const menu = String(form.get("menu") ?? "") as MenuId;
  if (!(menu in MENU_RECORDINGS)) return redirect("/admin/phone/menu-order");
  const s = await getSettings();
  if (form.get("reset") === "1") {
    await saveSetting("menuOrders", setMenuOrder(menu, [...MENU_RECORDINGS[menu].keys], s.menuOrders), owner.userId);
  } else {
    const order: string[] = menuOrder(menu, s.menuOrders);
    const i = order.indexOf(String(form.get("part") ?? ""));
    const j = form.get("dir") === "up" ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < order.length) {
      [order[i], order[j]] = [order[j], order[i]];
      await saveSetting("menuOrders", setMenuOrder(menu, order, s.menuOrders), owner.userId);
    }
  }
  revalidatePath("/admin/phone/menu-order");
  redirect("/admin/phone/menu-order");
}

import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { MENU_RECORDINGS, menuOrder, type MenuId } from "@/lib/ivr/menu-order";
import { PROMPTS, type PromptKey } from "@/lib/ivr/prompts";
import { moveMenuPartAction } from "./actions";
import { trustedMsg } from "@/lib/url-message";

export const dynamic = "force-dynamic";
export const metadata = { title: "Menu order · Hup Up Attractions", robots: { index: false } };

const partLabel = (k: string) => (k === "balloon_items" ? "The balloons, one by one (name, item number, key)" : PROMPTS[k as PromptKey]?.label ?? k);
const partText = (k: string) => (k === "balloon_items" ? "For the Soft Hop, item seven two, zero one, press, 1. ..." : PROMPTS[k as PromptKey]?.text ?? "");

/**
 * Owner only (Hark for Abraham, Nov 19, 2026): menus made of several recordings play them in the order set here. The
 * wording of each recording is edited in Hotline prompts.
 */
export default async function MenuOrderPage({ searchParams }: { searchParams?: Promise<{ m?: string; ms?: string }> }) {
  await requireOwner();
  const s = await getSettings();
  const sp = (await searchParams) ?? {};
  const saved = trustedMsg(sp.m, sp.ms);
  return (
    <div className="w-full" data-menu-order>
      <h1 className="text-2xl font-black sm:text-3xl">Menu order</h1>
      <p className="mb-4 mt-1 text-muted">Some phone menus are made of several recordings. They play one after the other in the order below. Use the arrows to change the order. The words of each recording are changed in Hotline prompts.</p>
      {saved && <p role="status" className="mb-4 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]">{saved}</p>}
      {(Object.keys(MENU_RECORDINGS) as MenuId[]).map((menu) => {
        const order = menuOrder(menu, s.menuOrders);
        return (
          <section key={menu} id={menu} className="card mb-5 p-5" data-menu={menu}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{MENU_RECORDINGS[menu].label}</h2>
              <form action={moveMenuPartAction}>
                <input type="hidden" name="menu" value={menu} />
                <input type="hidden" name="reset" value="1" />
                <button className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-muted hover:bg-bg" title="Back to the first order"><RotateCcw className="h-3.5 w-3.5" /> First order</button>
              </form>
            </div>
            <ol className="divide-y divide-line">
              {order.map((k, i) => (
                <li key={k} className="flex items-start gap-3 py-2" data-menu-part={k}>
                  <span className="mt-0.5 w-6 shrink-0 text-right font-bold text-muted">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{partLabel(k)}</div>
                    <div className="text-sm text-muted">{partText(k)}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {(["up", "down"] as const).map((dir) => (
                      <form key={dir} action={moveMenuPartAction}>
                        <input type="hidden" name="menu" value={menu} />
                        <input type="hidden" name="part" value={k} />
                        <input type="hidden" name="dir" value={dir} />
                        <button className="rounded-full p-1.5 hover:bg-bg disabled:opacity-30" disabled={dir === "up" ? i === 0 : i === order.length - 1} aria-label={dir === "up" ? "Move up" : "Move down"}>
                          {dir === "up" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                        </button>
                      </form>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

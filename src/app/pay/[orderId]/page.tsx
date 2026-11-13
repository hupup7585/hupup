import { notFound, redirect } from "next/navigation";
import { paymentLink } from "@/lib/sola";
import { getPaymentGroup, orderNumber } from "@/lib/orders";
import { ensureGroupPriced } from "@/lib/order-pricing";
import { termsActive, verifyPayToken } from "@/lib/rental-terms";
import PayForm from "./PayForm";
import { webConsentCopy } from "@/lib/sms-terms-v2";
import { smsNumberDisplay } from "@/lib/sms-number";
import DualDate from "@/components/DualDate";
import { LINK_TEXT, holdEnded, holdForCardPage, keepHoldWhileActive, linkOptionsActive, linkRulesActive, removedWithOptions } from "@/lib/late-payment";
import { checkAgainAction, chooseOptionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review and pay | Hup Up Attractions", robots: { index: false } };

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Review-and-pay page (from the payment text). Terms must be accepted with an unchecked box before Sola. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string; held?: string }> }) {
  const { orderId } = await params;
  const { t, held } = await searchParams;
  const id = Number(orderId);
  if (!Number.isInteger(id) || !verifyPayToken(id, t)) notFound();
  // Every link charges items + delivery + tax: price any order not priced yet (made in Admin, or older ones)
  const before = await getPaymentGroup(id);
  if (!before) notFound();
  // The link rule (Abraham, Nov 13, 2026; preview until he approves the wording)
  const rules = linkRulesActive();
  if (rules && before.orders.some((d) => holdEnded(d.order))) {
    const count = before.orders.reduce((n, d) => n + d.items.reduce((m, i) => m + i.qty, 0), 0);
    return (
      <main className="min-h-screen bg-hu-tint px-4 py-10 font-display text-hu-deep">
        <div className="mx-auto max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6" data-link-expired>
          <h1 className="text-2xl font-extrabold">{LINK_TEXT.expiredTitle}</h1>
          <p className="mt-3">{LINK_TEXT.expiredBody(count)}</p>
          <form action={checkAgainAction.bind(null, id, t!)} className="mt-5">
            <button className="btn-dark w-full py-3" data-check-again>{LINK_TEXT.checkButton}</button>
          </form>
        </div>
      </main>
    );
  }
  if (rules) await keepHoldWhileActive(before.orders.map((d) => d.order.id)); // opening the page is activity
  if (!(await ensureGroupPriced(before.orders.filter((d) => d.order.status === "PENDING_PAYMENT").map((d) => d.order.id)))) notFound();
  const group = await getPaymentGroup(id);
  if (!group) notFound();
  const full = group.primary;
  const o = full.order;
  const due = group.due; // every rental day booked together, one charge
  // Items someone else booked (taken out when the customer checked availability again), with their nearest options
  const removed = rules && linkOptionsActive() ? await removedWithOptions(id) : [];
  const removedCount = removed.reduce((n, r) => n + r.qty, 0);
  // Live site while the Terms are still a draft: no Terms box, straight to the secure payment page (as before)
  if (!termsActive() && o.status === "PENDING_PAYMENT" && due > 0) {
    if (rules) await holdForCardPage(group.orders.map((d) => d.order.id)); // straight to the card page: 10 minutes there
    redirect(paymentLink({ orderId: o.id, amountCents: due, name: full.customer?.name, email: full.customer?.email, phone: full.customer?.phone }));
  }
  return (
    <main className="min-h-screen bg-hu-tint px-4 py-10 font-display text-hu-deep">
      <div className="mx-auto max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6">
        <h1 className="text-2xl font-extrabold">Review and pay for order #{orderNumber(id)}</h1>
        {group.orders.map((day) => (
          <section key={day.order.id} data-pay-day className="mt-4 border-t border-hu-deep/15 pt-3 first:border-t-0">
            <div className="text-sm">
              <span className="block"><b>Delivery:</b> <DualDate iso={day.order.eventDate} stack /></span>
              <span className="mt-1 block"><b>Pickup:</b> <DualDate iso={day.order.pickupDate} stack /></span>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {day.items.map((i) => (
                <li key={i.id} className="flex justify-between">
                  <span>
                    {i.qty} × {i.name}
                  </span>
                  <span>{money(i.qty * i.unitPriceCents)}</span>
                </li>
              ))}
              {day.order.totalCents !== null && (
                <>
                  <li className="flex justify-between"><span>Delivery</span><span>{money(day.order.deliveryFeeCents)}</span></li>
                  <li className="flex justify-between"><span>Sales tax ({day.order.taxPercent}%)</span><span>{money(day.order.taxCents)}</span></li>
                </>
              )}
            </ul>
          </section>
        ))}
        <p data-rental-window className="mt-3 rounded-lg bg-hu-tint px-3 py-2 text-sm">
          We deliver between 9:00 AM and 12:00 PM on your delivery day. On your pickup day, please have the rental outside your door by 9:00 AM.
        </p>
        <ul className="mt-3 text-sm">
          <li className="flex justify-between border-t pt-2 text-base font-bold"><span>Total due</span><span>{money(due)}</span></li>
        </ul>
        {removed.length > 0 && (
          <section data-link-removed className="mt-5 rounded-xl border-2 border-sun bg-[#FFF8E1] p-4">
            <h2 className="text-lg font-extrabold">{LINK_TEXT.gone(removedCount)}</h2>
            {removed.some((r) => r.options.length) && <p className="mt-2 text-sm">{LINK_TEXT.optionsIntro}</p>}
            {removed.map((r) => (
              <div key={r.index} className="mt-3" data-link-removed-item>
                <div className="text-sm font-bold">
                  {r.qty} × {r.name}, <DualDate iso={r.eventDate} />
                </div>
                <div className="mt-2 space-y-2" data-link-options>
                  {r.options.map((x) => (
                    <form key={`${x.productId}-${x.date}`} action={chooseOptionAction.bind(null, id, t!, r.index, x.productId, x.date)}>
                      <button className="btn-ghost w-full justify-start py-3 text-left" data-link-option={x.kind}>
                        <span>
                          {x.name} on <DualDate iso={x.date} /> ({money(x.priceCents)})
                        </span>
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
            <p className="mt-3 text-sm" data-link-gone>{LINK_TEXT.goneCall}</p>
          </section>
        )}
        {rules && held && due > 0 && <p data-held-again className="mt-4 rounded-lg bg-[#e5f4e4] px-3 py-2 text-sm font-semibold">{LINK_TEXT.heldAgain(o.channel === "POS" ? 25 : 10)}</p>}
        {rules && o.status === "PENDING_PAYMENT" && due > 0 && <p data-card-note className="mt-3 text-sm">{LINK_TEXT.cardNote}</p>}
        <div className="mt-6">
          {o.status === "PENDING_PAYMENT" && due > 0 ? <PayForm orderId={id} token={t!} consent={{ transactionalText: webConsentCopy().transactional, marketingText: webConsentCopy().marketing, smsNumber: smsNumberDisplay() }} /> : removed.length ? null : <p className="font-semibold">This order is not waiting for payment. Questions? Call (845) 777-7585.</p>}
        </div>
      </div>
    </main>
  );
}

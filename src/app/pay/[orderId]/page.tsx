import { after } from "next/server";
import { runWhileAwake } from "@/lib/cron-schedule";
import { prefillFor } from "@/lib/pay-prefill";
import { paymentsClosedLine } from "@/lib/payments-closed";
import { notFound, redirect } from "next/navigation";
import { PAYMENT_UNAVAILABLE, onlinePaymentReady, paymentLink } from "@/lib/sola";
import { getPaymentGroup, orderNumber, payingDays } from "@/lib/orders";
import { ensureGroupPriced } from "@/lib/order-pricing";
import { termsActive, verifyPayToken } from "@/lib/rental-terms";
import PayForm from "./PayForm";
import { getSettings, linkHoldMinutes } from "@/lib/settings";
import { webConsentCopy } from "@/lib/sms-terms-v2";
import { smsNumberDisplay } from "@/lib/sms-number";
import DualDate from "@/components/DualDate";
import { LINK_TEXT, linkHoldKindOf, linkExpired, holdForCardPage, keepHoldWhileActive, linkOptionsActive, linkRulesActive, removedWithOptions } from "@/lib/late-payment";
import { checkAgainAction, chooseOptionAction } from "./actions";
import { orderIdFromParam } from "@/lib/order-path";
import { BREAKDOWN_LABELS, DELIVERY_SENTENCE, payBreakdown, pickupSentence } from "@/lib/pay-breakdown";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review and pay | Hup Up Attractions", robots: { index: false } };

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Hark's review L5: the minutes this order's own hold really has left (not today's setting), at least 1. */
function minutesLeft(until: Date, now = Date.now()) {
  return Math.max(1, Math.ceil((until.getTime() - now) / 60000));
}

/** Review-and-pay page (from the payment text). Terms must be accepted with an unchecked box before Sola. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string; held?: string }> }) {
  // The payment page reads the database anyway: the time-sensitive jobs get a chance to run, after the page
  after(() => runWhileAwake().catch((e) => console.error("[run while awake]", e)));
  const { orderId } = await params;
  const { t, held } = await searchParams;
  const id = orderIdFromParam(orderId); // the order number (1077) or an older id link (77)
  if (!Number.isInteger(id) || !verifyPayToken(id, t)) notFound();
  // Every link charges items + delivery + tax: price any order not priced yet (made in Admin, or older ones)
  const before = await getPaymentGroup(id);
  if (!before) notFound();
  // Abraham, Nov 27, 2026: payment links do not work from the phone cut-off (15 minutes before candle lighting) until
  // the phone reopens after Shabbes / Yom Tov: a closed notice, no card form
  // Deep check 06:00 M39: an expired link (every day released, so nothing shows as due) is closed too, so it never
  // shows a "Check availability again" button that does nothing until Shabbes / Yom Tov is over
  const closedLine = before.due > 0 || (linkRulesActive() && (await linkExpired(before.orders))) ? await paymentsClosedLine() : null;
  if (closedLine)
    return (
      <main className="min-h-screen bg-hu-tint px-4 py-10 font-display text-hu-deep">
        <div className="mx-auto max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6 text-center" data-payments-closed>
          <h1 className="text-2xl font-extrabold">{closedLine}</h1>
        </div>
      </main>
    );
  // Nov 24, 2026: no online payment without the Sola page name; never a link that skips the card step
  if (before.due > 0 && !onlinePaymentReady())
    return (
      <main className="min-h-screen bg-hu-tint px-4 py-10 font-display text-hu-deep">
        <div className="mx-auto max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6 text-center" data-payment-unavailable>
          <h1 className="text-2xl font-extrabold">{PAYMENT_UNAVAILABLE}</h1>
        </div>
      </main>
    );
  // The link rule (Abraham, Nov 13, 2026; preview until he approves the wording)
  const rules = linkRulesActive();
  if (rules && (await linkExpired(before.orders))) {
    const count = payingDays(before.orders, before.primary).reduce((n, d) => n + d.items.reduce((m, i) => m + i.qty, 0), 0);
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
  // Deep check Nov 27 #3/#24: the days being paid for (a day cancelled with nothing paid is not listed); the first day
  // still waiting decides the hold shown, so a cancelled first day never blocks paying for the others
  const days = payingDays(group.orders, full);
  const o = (days.find((d) => d.order.status === "PENDING_PAYMENT") ?? full).order;
  const due = group.due; // every rental day booked together, one charge
  // Items someone else booked (taken out when the customer checked availability again), with their nearest options
  const removed = rules && linkOptionsActive() ? await removedWithOptions(id) : [];
  const removedCount = removed.reduce((n, r) => n + r.qty, 0);
  // Live site while the Terms are still a draft: no Terms box, straight to the secure payment page (as before)
  if (!termsActive() && o.status === "PENDING_PAYMENT" && due > 0) {
    if (rules) await holdForCardPage(group.orders.map((d) => d.order.id)); // straight to the card page: 10 minutes there
    const link = paymentLink({ orderId: full.order.id, amountCents: due, prefill: prefillFor(full, days, `#${orderNumber(full.order.id)}`) });
    if (link) redirect(link);
  }
  // Same-day orders (Abraham, Nov 27, 2026, 12:47 AM): the same notice as the phone, by customer service hours
  const sameDay = await (await import("@/lib/same-day-notice")).sameDayNoticeText(days.map((d) => d.order.eventDate));
  const breakdown = payBreakdown(group.orders);
  const pickupLine = pickupSentence(group.orders.filter((d) => d.order.status !== "CANCELLED").map((d) => d.order), (await getSettings()) as never);
  return (
    <main className="min-h-screen bg-hu-tint px-4 py-10 font-display text-hu-deep">
      <div className="mx-auto max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6">
        <h1 className="text-2xl font-extrabold">Review and pay for order #{orderNumber(id)}</h1>
        {sameDay && <p className="mt-3 rounded-xl bg-hu-tint p-3 text-sm" data-same-day-notice>{sameDay}</p>}
        {/* Abraham, Nov 27, 2026 (item 4): the lines add up to Total due; each heading only when it has lines */}
        {breakdown.days.map((day) => (
          <section key={day.orderId} data-pay-day className="mt-4 border-t border-hu-deep/15 pt-3 first:border-t-0">
            <div className="text-sm">
              <span className="block"><b>Delivery:</b> <DualDate iso={day.eventDate} stack /></span>
              <span className="mt-1 block"><b>Pickup:</b> <DualDate iso={day.pickupDate} stack /></span>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {day.lines.map((l, n) => (
                <li key={n} className="flex justify-between" data-pay-line>
                  <span>
                    {l.label}
                    {l.note ? <span className="block text-xs text-hu-deep/70">{l.note}</span> : null}
                  </span>
                  <span>{money(l.cents)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {breakdown.discounts.length > 0 && (
          <section data-pay-group="discount" className="mt-4 border-t border-hu-deep/15 pt-3">
            <h2 className="text-sm font-extrabold">{BREAKDOWN_LABELS.discount}</h2>
            <ul className="mt-1 space-y-1 text-sm">
              {breakdown.discounts.map((l, n) => (
                <li key={n} className="flex justify-between font-semibold" data-pay-discount>
                  <span>{l.label}</span>
                  <span>-{money(-l.cents)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {breakdown.alreadyPaid.length > 0 && (
          <section data-pay-group="already-paid" className="mt-4 border-t border-hu-deep/15 pt-3">
            <h2 className="text-sm font-extrabold">{BREAKDOWN_LABELS.alreadyPaid}</h2>
            <ul className="mt-1 space-y-1 text-sm text-hu-deep/80">
              {breakdown.alreadyPaid.map((l, n) => (
                <li key={n} className="flex justify-between gap-3" data-pay-already-paid>
                  <span>{l.label}</span>
                  <span className="shrink-0 font-semibold">{BREAKDOWN_LABELS.alreadyPaid}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {breakdown.paidSoFarCents > 0 && (
          <section data-pay-group="partial" className="mt-4 border-t border-hu-deep/15 pt-3">
            <h2 className="text-sm font-extrabold">{BREAKDOWN_LABELS.partial}</h2>
            <ul className="mt-1 text-sm">
              <li className="flex justify-between" data-pay-paid-so-far>
                <span>{BREAKDOWN_LABELS.paidSoFar}: {money(breakdown.paidSoFarCents)}</span>
                <span>-{money(breakdown.paidSoFarCents)}</span>
              </li>
            </ul>
          </section>
        )}
        <ul className="mt-3 text-sm">
          <li className="flex justify-between border-t pt-2 text-base font-bold"><span>{BREAKDOWN_LABELS.totalDue}</span><span>{money(due)}</span></li>
        </ul>
        <p data-rental-window className="mt-3 rounded-lg bg-hu-tint px-3 py-2 text-sm">
          {DELIVERY_SENTENCE} {pickupLine}
        </p>
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
        {rules && held && due > 0 && <p data-held-again className="mt-4 rounded-lg bg-[#e5f4e4] px-3 py-2 text-sm font-semibold">{LINK_TEXT.heldAgain(o.holdExpiresAt ? minutesLeft(o.holdExpiresAt) : await linkHoldMinutes(linkHoldKindOf(o)))}</p>}
        {rules && o.status === "PENDING_PAYMENT" && due > 0 && <p data-card-note className="mt-3 text-sm">{LINK_TEXT.cardNote(await linkHoldMinutes(linkHoldKindOf(o)))}</p>}
        <div className="mt-6">
          {o.status === "PENDING_PAYMENT" && due > 0 ? <PayForm orderId={id} token={t!} consent={{ transactionalText: webConsentCopy().transactional, marketingText: webConsentCopy().marketing, smsNumber: smsNumberDisplay() }} /> : removed.length ? null : <p className="font-semibold">This order is not waiting for payment. Questions? Call (845) 777-7585.</p>}
        </div>
      </div>
    </main>
  );
}

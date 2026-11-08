import { notFound, redirect } from "next/navigation";
import { paymentLink } from "@/lib/sola";
import { getPaymentGroup, orderNumber } from "@/lib/orders";
import { termsActive, verifyPayToken } from "@/lib/rental-terms";
import PayForm from "./PayForm";
import { webConsentCopy } from "@/lib/sms-terms-v2";
import { smsNumberDisplay } from "@/lib/sms-number";
import DualDate from "@/components/DualDate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review and pay | Hup Up Attractions", robots: { index: false } };

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Review-and-pay page (from the payment text). Terms must be accepted with an unchecked box before Sola. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { orderId } = await params;
  const { t } = await searchParams;
  const id = Number(orderId);
  if (!Number.isInteger(id) || !verifyPayToken(id, t)) notFound();
  const group = await getPaymentGroup(id);
  if (!group) notFound();
  const full = group.primary;
  const o = full.order;
  const due = group.due; // every rental day booked together, one charge
  // Live site while the Terms are still a draft: no Terms box, straight to the secure payment page (as before)
  if (!termsActive() && o.status === "PENDING_PAYMENT" && due > 0) {
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
        <div className="mt-6">
          {o.status === "PENDING_PAYMENT" && due > 0 ? <PayForm orderId={id} token={t!} consent={{ transactionalText: webConsentCopy().transactional, marketingText: webConsentCopy().marketing, smsNumber: smsNumberDisplay() }} /> : <p className="font-semibold">This order isn&rsquo;t waiting for payment. Questions? Call (845) 777-7585.</p>}
        </div>
      </div>
    </main>
  );
}

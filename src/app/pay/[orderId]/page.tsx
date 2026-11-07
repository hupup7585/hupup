import { notFound, redirect } from "next/navigation";
import { paymentLink } from "@/lib/sola";
import { getOrderWithItems, orderNumber } from "@/lib/orders";
import { termsActive, verifyPayToken } from "@/lib/rental-terms";
import PayForm from "./PayForm";
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
  const full = await getOrderWithItems(id);
  if (!full) notFound();
  const o = full.order;
  const due = (o.totalCents ?? o.subtotalCents) - o.paidCents;
  // Live site while the Terms are still a draft: no Terms box, straight to the secure payment page (as before)
  if (!termsActive() && o.status === "PENDING_PAYMENT" && due > 0) {
    redirect(paymentLink({ orderId: id, amountCents: due, name: full.customer?.name, email: full.customer?.email, phone: full.customer?.phone }));
  }
  return (
    <main className="min-h-screen bg-hu-tint px-4 py-10 font-display text-hu-deep">
      <div className="mx-auto max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6">
        <h1 className="text-2xl font-extrabold">Review and pay for order #{orderNumber(id)}</h1>
        <div className="mt-2 text-sm">
          <span className="block"><b>Delivery:</b> <DualDate iso={o.eventDate} stack /></span>
          <span className="mt-1 block"><b>Pickup:</b> <DualDate iso={o.pickupDate} stack /></span>
        </div>
        <ul className="mt-4 space-y-1 text-sm">
          {full.items.map((i) => (
            <li key={i.id} className="flex justify-between">
              <span>
                {i.qty} × {i.name}
              </span>
              <span>{money(i.qty * i.unitPriceCents)}</span>
            </li>
          ))}
          {o.totalCents !== null && (
            <>
              <li className="flex justify-between"><span>Delivery</span><span>{money(o.deliveryFeeCents)}</span></li>
              <li className="flex justify-between"><span>Sales tax ({o.taxPercent}%)</span><span>{money(o.taxCents)}</span></li>
            </>
          )}
          <li className="flex justify-between border-t pt-2 text-base font-bold"><span>Total due</span><span>{money(due)}</span></li>
        </ul>
        <div className="mt-6">
          {o.status === "PENDING_PAYMENT" && due > 0 ? <PayForm orderId={id} token={t!} /> : <p className="font-semibold">This order isn&rsquo;t waiting for payment. Questions? Call (845) 777-7585.</p>}
        </div>
      </div>
    </main>
  );
}

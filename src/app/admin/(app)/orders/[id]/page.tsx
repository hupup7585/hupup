import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderWithItems, orderNumber } from "@/lib/orders";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { StatusBadge } from "@/components/StatusBadge";
import OrderActions from "./OrderActions";
import ConsentPanel from "./ConsentPanel";
import { staffDisclosure } from "@/lib/sms-terms-v2";
import { NO_TEXT_CONSENT, hasTransactionalConsent } from "@/lib/sms";
import DualDate from "@/components/DualDate";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getOrderWithItems(Number(id));
  if (!full) notFound();
  const { order: o, items, customer } = full;
  const due = (o.totalCents ?? o.subtotalCents) - o.paidCents;
  const textStatus = !customer?.phone ? "none" : customer.smsOptOut ? "stopped" : (await hasTransactionalConsent(customer.phone)) ? "ok" : "none";
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/orders" className="text-sm font-bold text-navy underline-offset-2 hover:underline">← All orders</Link>
      <div className="mb-5 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black sm:text-3xl">Order #{orderNumber(o.id)}</h1>
        <StatusBadge status={o.status} />
        <span className="text-sm text-muted">{o.channel === "PHONE" ? "Booked by phone" : "Booked in person"} · <DualDate yi at={o.createdAt} /></span>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <div className="card p-5">
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <div><div className="label">Delivery</div><div className="font-bold"><DualDate yi iso={o.eventDate} /></div></div>
              <div><div className="label">Pickup</div><div className="font-bold"><DualDate yi iso={o.pickupDate} /></div></div>
            </div>
            <table className="w-full text-sm">
              <thead><tr><th className="th">Item</th><th className="th">Qty</th><th className="th">Price</th><th className="th text-right">Total</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}><td className="td font-semibold">{i.name}</td><td className="td">{i.qty}</td><td className="td">{formatMoney(i.unitPriceCents)}</td><td className="td text-right">{formatMoney(i.qty * i.unitPriceCents)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-1 text-right">
              {o.totalCents !== null ? (
                <>
                  <div className="text-sm text-muted">Rentals {formatMoney(o.subtotalCents)} · Delivery {formatMoney(o.deliveryFeeCents)} · Sales tax ({o.taxPercent}%) {formatMoney(o.taxCents)}</div>
                  <div>Total <b className="ml-3 text-lg">{formatMoney(o.totalCents)}</b></div>
                </>
              ) : (
                <div>Total <b className="ml-3 text-lg">{formatMoney(o.subtotalCents)}</b></div>
              )}
              <div className="text-sm text-muted">Paid {formatMoney(o.paidCents)}{o.paymentMethod ? ` (${o.paymentMethod})` : ""}{o.solaRefNum ? ` · Sola ref ${o.solaRefNum}` : ""}</div>
              {due > 0 && <div className="text-sm font-bold text-coral">Balance due {formatMoney(due)}</div>}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="mb-3 font-bold">Customer</h2>
            {customer ? (
              <div className="space-y-1">
                <div className="text-lg font-bold">{customer.name}</div>
                {customer.phone && <a className="block text-navy underline-offset-2 hover:underline" href={`tel:${customer.phone}`}>{formatPhone(customer.phone)}</a>}
                {customer.email && <a className="block text-navy underline-offset-2 hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a>}
              </div>
            ) : (
              <p className="text-muted">Not entered yet (caller still on the phone or abandoned cart).</p>
            )}
          </div>
          {customer?.phone && (
            <div data-text-consent className={`card p-4 text-sm font-semibold ${textStatus === "ok" ? "text-[#13895C]" : "text-coral"}`}>
              {textStatus === "ok" ? "Order texts: customer has given text consent." : textStatus === "stopped" ? "Customer replied STOP: no texts of any kind. They must text START and reply YES. Call or email instead." : NO_TEXT_CONSENT}
            </div>
          )}
          {customer?.phone && <ConsentPanel orderId={o.id} phoneDisplay={formatPhone(customer.phone)} disclosures={staffDisclosure()} stopped={textStatus === "stopped"} />}
        </div>
        <OrderActions
          orderId={o.id}
          status={o.status}
          due={due}
          hasPhone={Boolean(customer?.phone)}
          deliveryAddress={o.deliveryAddress ?? ""}
          deliveryTime={o.deliveryTime ?? ""}
          notes={o.notes ?? ""}
          holdExpiresAt={o.holdExpiresAt?.toISOString() ?? null}
        />
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import TextConsentBoxes from "@/components/TextConsentBoxes";
import { availabilityFor, createBookingAction, type PosResult , calendarFor, checkDateFor, type CalendarDay, type DateCheck } from "./actions";
import DualDate, { HebrewDay } from "@/components/DualDate";
import { englishDate } from "@/lib/dual-date";
import { DELIVERY_WINDOW, PICKUP_BY } from "@/lib/rental-days";

type P = { id: number; categoryId: number; name: string; priceCents: number; quantity: number };

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function PosForm(props: {
  today: string;
  initialDate: string;
  initialProduct: number | null;
  categories: { id: number; name: string }[];
  products: P[];
  /** Ask how the customer accepted the Terms (off on the live site until the final Terms are in) */
  askTerms?: boolean;
  consent?: { transactionalText: string; marketingText: string; smsNumber: string };
}) {
  const [date, setDate] = useState(props.initialDate);
  const [avail, setAvail] = useState<Record<string, number>>({});
  const [qty, setQty] = useState<Record<string, number>>(props.initialProduct ? { [props.initialProduct]: 1 } : {});
  const [sms, setSms] = useState({ transactional: false, marketing: false });
  const [form, setForm] = useState({ name: "", termsVia: "", phone: "", email: "", address: "", deliveryTime: "", notes: "", amountPaid: "" });
  const [payment, setPayment] = useState<"link" | "cash" | "check" | "later">("link");
  const [result, setResult] = useState<PosResult | null>(null);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [check, setCheck] = useState<DateCheck | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    calendarFor(props.today, 14).then(setDays);
  }, [props.today]);

  useEffect(() => {
    if (!date) return;
    let live = true;
    availabilityFor(date).then((a) => live && setAvail(a));
    checkDateFor(date).then((c) => live && setCheck(c));
    return () => {
      live = false;
    };
  }, [date, result]);

  const total = useMemo(
    () => props.products.reduce((s, p) => s + (qty[p.id] || 0) * p.priceCents, 0),
    [qty, props.products],
  );

  useEffect(() => {
    if (payment === "cash" || payment === "check") setForm((f) => ({ ...f, amountPaid: (total / 100).toFixed(2) }));
  }, [payment, total]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = () =>
    start(async () => {
      const r = await createBookingAction({ date, items: qty, ...form, payment, smsTransactional: sms.transactional, smsMarketing: sms.marketing });
      setResult(r);
      if (r.ok) {
        setQty({});
        setForm({ name: "", phone: "", email: "", address: "", deliveryTime: "", notes: "", amountPaid: "", termsVia: "" });
        setSms({ transactional: false, marketing: false });
      }
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <div className="card min-w-0 p-5">
        <label className="label">Event (delivery) date — pickup is the next open day</label>
        {/* Coming days with Hebrew dates; closed days (Shabbos, Yom Tov, other closed days) can't be chosen. */}
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" data-pos-calendar>
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              disabled={d.closed}
              onClick={() => setDate(d.date)}
              title={d.closed ? `Closed: ${d.reason}` : d.names.join(", ") || d.hebrew}
              className={`min-w-[5.5rem] shrink-0 rounded-lg border px-2 py-1.5 text-left text-xs ${d.date === date ? "border-navy bg-navy text-white" : d.closed ? "border-line bg-bg text-muted line-through" : "border-line bg-white hover:border-navy"}`}
            >
              <span className="block font-bold">{englishDate(d.date, "short")}</span>
              <HebrewDay yi iso={d.date} className="block" />
              <span className="block truncate">{d.closed ? d.reason : d.closesAtLabel ? "Closes early" : d.names[0] ?? ""}</span>
            </button>
          ))}
        </div>
        <input type="date" min={props.today} value={date} onChange={(e) => setDate(e.target.value)} className="input mb-3 max-w-xs" />
        {check && (
          <div data-date-check className={`mb-5 rounded-lg p-3 text-sm ${check.ok ? "bg-bg" : "bg-[#ffe6e4] font-semibold text-[#b3261e]"}`}>
            <div className="font-bold">
              <DualDate yi iso={check.day.date} />
              {check.day.names.length > 0 && <span className="font-normal"> · {check.day.names.join(", ")}</span>}
            </div>
            {!check.ok && <div>{check.message}</div>}
            {check.day.closesAtLabel && <div className="badge badge-pending mt-1">{check.day.closesAtLabel}</div>}
            {check.ok && <div className="mt-1">Pickup: <DualDate yi iso={check.pickup} /></div>}
            {check.pickupWarning && <div className="mt-1 font-semibold text-navy">{check.pickupWarning}</div>}
          </div>
        )}
        {!date && <p className="text-muted">Pick a date to see what&apos;s available.</p>}
        {date &&
          props.categories.map((c) => {
            const items = props.products.filter((p) => p.categoryId === c.id);
            if (!items.length) return null;
            return (
              <div key={c.id} className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{c.name}</div>
                {items.map((p) => {
                  const free = avail[p.id] ?? 0;
                  const q = qty[p.id] || 0;
                  return (
                    <div key={p.id} className="flex items-center gap-3 border-b border-line py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold">{p.name}</div>
                        <div className="text-sm text-muted">
                          {money(p.priceCents)} ·{" "}
                          <span className={free ? "font-semibold text-[#13895C]" : "font-semibold text-coral"}>
                            {free ? `${free} of ${p.quantity} available` : "Fully booked"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" className="btn-ghost h-9 w-9 !p-0" disabled={!q} onClick={() => setQty({ ...qty, [p.id]: q - 1 })}>−</button>
                        <span className="w-6 text-center font-bold">{q}</span>
                        <button type="button" className="btn-ghost h-9 w-9 !p-0" disabled={q >= free} onClick={() => setQty({ ...qty, [p.id]: q + 1 })}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="font-bold">Customer</h2>
        <input className="input" placeholder="Full name *" value={form.name} onChange={set("name")} />
        <input className="input" placeholder="Mobile phone" inputMode="tel" value={form.phone} onChange={set("phone")} />
        <input className="input" placeholder="Email (optional)" type="email" value={form.email} onChange={set("email")} />
        <input className="input" placeholder="Delivery address" value={form.address} onChange={set("address")} />
        {/* Whole rental days (Abraham): no delivery time; delivery is always 9:00 AM - 12:00 PM, pickup by 9:00 AM */}
        <p data-rental-window className="text-sm text-muted">Delivery {DELIVERY_WINDOW} · pickup by {PICKUP_BY} on the pickup day</p>
        <textarea className="input" placeholder="Notes" rows={2} value={form.notes} onChange={set("notes")} />
        {props.askTerms !== false && (
        <label className="block">
          <span className="label">Customer accepted the Terms and Conditions by *</span>
          <select className="input" value={form.termsVia} onChange={set("termsVia")} required>
            <option value="">Choose how they accepted</option>
            <option value="phone">Phone</option>
            <option value="text">Text message</option>
            <option value="email">Email</option>
            <option value="in_person">In person</option>
          </select>
        </label>
        )}

        {props.consent && (
          <TextConsentBoxes staff transactionalText={props.consent.transactionalText} marketingText={props.consent.marketingText} transactional={sms.transactional} marketing={sms.marketing} onChange={setSms} smsNumber={props.consent.smsNumber} />
        )}

        <h2 className="pt-2 font-bold">Payment</h2>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["link", "💬 Text Sola pay link"],
            ["cash", "💵 Paid cash"],
            ["check", "🧾 Paid check"],
            ["later", "⏳ Pay on delivery"],
          ] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setPayment(v)} className={`btn-ghost text-sm ${payment === v ? "!border-navy !bg-bg" : ""}`}>
              {l}
            </button>
          ))}
        </div>
        {(payment === "cash" || payment === "check") && (
          <input className="input" placeholder="Amount received" inputMode="decimal" value={form.amountPaid} onChange={set("amountPaid")} />
        )}

        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-muted">Total</span>
          <span className="text-2xl font-black">{money(total)}</span>
        </div>
        <button className="btn w-full py-3.5" disabled={pending || !date || total === 0 || check?.ok === false || (props.askTerms !== false && !form.termsVia)} onClick={submit}>
          {pending ? "Booking…" : "Book it"}
        </button>
        {result && (
          <p className={`rounded-xl p-3 text-sm font-semibold ${result.ok ? "bg-mint/15 text-[#13895C]" : "bg-coral/10 text-coral-dark"}`}>
            {result.message}{" "}
            {result.orderId && <Link className="underline" href={`/admin/orders/${result.orderId}`}>Open order</Link>}
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import TextConsentBoxes from "@/components/TextConsentBoxes";
import { availabilityFor, createBookingAction, type PosResult , calendarFor, checkDateFor, type CalendarDay, type DateCheck, quoteAction, directorySuggestAction, type DirectoryHit } from "./actions";
import type { BookingQuote } from "@/lib/order-pricing";
import DualDate, { HebrewDay } from "@/components/DualDate";
import { englishDate } from "@/lib/dual-date";
import { DELIVERY_WINDOW, PICKUP_BY } from "@/lib/rental-days";
import MonthCalendar from "./MonthCalendar";

type P = { id: number; categoryId: number; name: string; priceCents: number; quantity: number };

/** Jumping balloon categories (the phone's rule) and the ocean balls group (Abraham, Nov 19, 2026). */
const BALLOON = /balloon|bounce|jump|inflatable(?!.*maze)/i;
const OCEAN = /^ocean balls$/i;

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const phoneShown = (e164: string | null) => {
  const d = (e164 ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 ?? "";
};

export default function PosForm(props: {
  today: string;
  initialDate: string;
  initialProduct: number | null;
  categories: { id: number; name: string }[];
  products: P[];
  /** Ask how the customer accepted the Terms (off on the live site until the final Terms are in) */
  askTerms?: boolean;
  consent?: { transactionalText: string; marketingText: string; smsNumber: string };
  /** Thursday to Sunday offer is on (Owner switch) */
  offerThuSun?: boolean;
  /** Month calendar date picker (preview only until Abraham approves the screenshot) */
  monthCalendar?: boolean;
}) {
  const [date, setDate] = useState(props.initialDate);
  const [avail, setAvail] = useState<Record<string, number>>({});
  const [qty, setQty] = useState<Record<string, number>>(props.initialProduct ? { [props.initialProduct]: 1 } : {});
  const [sms, setSms] = useState({ transactional: false, marketing: false });
  const [thuSun, setThuSun] = useState(false);
  const isThursday = Boolean(date) && new Date(`${date}T12:00:00Z`).getUTCDay() === 4;
  const [form, setForm] = useState({ name: "", termsVia: "", phone: "", email: "", address: "", deliveryTime: "", notes: "", amountPaid: "" });
  const [payment, setPayment] = useState<"link" | "card" | "cash" | "check" | "later">("link");
  const [result, setResult] = useState<PosResult | null>(null);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [check, setCheck] = useState<DateCheck | null>(null);
  const [pending, start] = useTransition();
  // Ocean balls right after a jumping balloon is added (Abraham, Nov 19, 2026): asked under that balloon
  const [oceanFor, setOceanFor] = useState<number | null>(null);
  const oceanCat = props.categories.find((c) => OCEAN.test(c.name.trim()));
  const oceanItems = oceanCat ? props.products.filter((p) => p.categoryId === oceanCat.id) : [];
  const balloonCats = new Set(props.categories.filter((c) => BALLOON.test(c.name) && !OCEAN.test(c.name.trim())).map((c) => c.id));

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

  // Live total (Nov 24, 2026): items, delivery, sales tax and total, the same math the saved booking gets
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  useEffect(() => {
    if (!date || total === 0) {
      setQuote(null);
      return;
    }
    let live = true;
    setQuoting(true);
    const t = window.setTimeout(() => {
      quoteAction({ date, items: qty, phone: form.phone, address: form.address, thuSun: thuSun && isThursday })
        .then((q) => live && setQuote(q))
        .catch(() => live && setQuote(null))
        .finally(() => live && setQuoting(false));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [date, qty, form.address, form.phone, thuSun, isThursday, total]);
  const fullTotal = quote?.totalCents ?? null;

  useEffect(() => {
    if (payment === "cash" || payment === "check") setForm((f) => ({ ...f, amountPaid: ((fullTotal ?? total) / 100).toFixed(2) }));
  }, [payment, total, fullTotal]);

  // Directory suggestions (Owner only) as a name, phone number or street is typed (Nov 24, 2026)
  const [lookFor, setLookFor] = useState<{ field: "name" | "phone" | "address"; text: string } | null>(null);
  const [hits, setHits] = useState<DirectoryHit[]>([]);
  useEffect(() => {
    if (!lookFor || lookFor.text.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      directorySuggestAction(lookFor.text).then((h) => live && setHits(h)).catch(() => live && setHits([]));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [lookFor]);
  const pick = (h: DirectoryHit) => {
    setForm((f) => ({ ...f, name: [h.firstName, h.lastName].filter(Boolean).join(" "), phone: h.phone ? phoneShown(h.phone) : f.phone, address: h.address }));
    setLookFor(null);
    setHits([]);
  };
  const typing = (k: "name" | "phone" | "address") => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setLookFor({ field: k, text: e.target.value });
  };
  const suggestions = (k: "name" | "phone" | "address") =>
    lookFor?.field === k && hits.length > 0 ? (
      <ul className="mt-1 max-h-72 overflow-auto rounded-xl border border-[#D9E3F0] bg-white text-sm shadow-lg" role="listbox" data-dir-suggest>
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" role="option" aria-selected={false} onMouseDown={(e) => (e.preventDefault(), pick(h))} className="block w-full px-3 py-2 text-left hover:bg-[#F2F6FB]" data-dir-hit={h.id}>
              <span className="font-bold">{h.lastName}, {h.firstName}</span>
              {h.shared && <span className="ml-2 rounded-full bg-[#FFF6D6] px-2 py-0.5 text-[11px] font-bold text-[#8A6100]">Shared number</span>}
              <span className="block text-[13px] text-[#4A5B72]">{h.house} {h.street}{h.unit ? `, unit ${h.unit}` : ""}, {h.town} {h.zip}{h.phone ? ` · ${phoneShown(h.phone)}` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;
  const linkBlocked = Boolean(quote?.problem); // no booking at all until the address can be priced (delivery always applies)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = () =>
    start(async () => {
      const r = await createBookingAction({ date, items: qty, ...form, payment, smsTransactional: sms.transactional, smsMarketing: sms.marketing, thuSun: thuSun && isThursday });
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
        {/* Coming days with Hebrew dates; closed days (Shabbes, Yom Tov, other closed days) can't be chosen. */}
        {props.monthCalendar ? (
          <MonthCalendar today={props.today} value={date} onPick={setDate} />
        ) : (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" data-pos-calendar>
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              disabled={d.closed}
              onClick={() => setDate(d.date)}
              title={d.closed ? `Closed: ${d.reason}` : d.names.join(", ") || d.hebrew}
              className={`min-w-[5.5rem] shrink-0 rounded-lg border px-2 py-1.5 text-left text-xs ${d.date === date ? "border-navy bg-navy text-white" : d.closed ? "border-line bg-bg text-muted line-through" : d.holidayWeek ? "border-[#CFE6FB] bg-[#EEF7FF] hover:border-navy" : "border-line bg-white hover:border-navy"}`}
            >
              <span className="block font-bold">{englishDate(d.date, "short")}</span>
              <HebrewDay yi iso={d.date} className="block" />
              <span className="block truncate">{d.closed ? d.reason : d.closesAtLabel ? "Closes early" : d.names[0] ?? ""}</span>
            </button>
          ))}
        </div>
        )}
        {!props.monthCalendar && <input type="date" min={props.today} value={date} onChange={(e) => setDate(e.target.value)} className="input mb-3 max-w-xs" />}
        {check && (
          <div data-date-check className={`mb-5 rounded-lg p-3 text-sm ${check.ok ? "bg-bg" : "bg-[#ffe6e4] font-semibold text-[#b3261e]"}`}>
            <div className="font-bold">
              <DualDate yi iso={check.day.date} />
              {check.day.names.length > 0 && <span className="font-normal"> · {check.day.names.join(", ")}</span>}
            </div>
            {!check.ok && <div>{check.message}</div>}
            {check.day.closesAtLabel && <div className="badge badge-pending mt-1">{check.day.closesAtLabel}</div>}
            {check.ok && !(thuSun && isThursday) && <div className="mt-1">Pickup: <DualDate yi iso={check.pickup} /></div>}
            {check.ok && props.offerThuSun && isThursday && (
              <label className="mt-2 flex items-center gap-2 font-semibold" data-thu-sun>
                <input type="checkbox" checked={thuSun} onChange={(e) => setThuSun(e.target.checked)} /> Thursday to Sunday offer: pickup Monday, 1.5 times the rental
              </label>
            )}
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
                    <Fragment key={p.id}>
                    <div className="flex items-center gap-3 border-b border-line py-2.5">
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
                        <button
                          type="button"
                          className="btn-ghost h-9 w-9 !p-0"
                          disabled={q >= free}
                          onClick={() => {
                            setQty({ ...qty, [p.id]: q + 1 });
                            if (balloonCats.has(p.categoryId) && oceanItems.length) setOceanFor(p.id);
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    {oceanFor === p.id && (
                      <div className="mb-2 rounded-lg border border-navy/20 bg-bg p-3" data-ocean-offer>
                        <div className="mb-2 text-sm font-bold">Would you like to add ocean balls?</div>
                        <div className="flex flex-wrap gap-2">
                          {oceanItems.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              className="btn-ghost !min-h-9 !py-1 text-sm"
                              disabled={(qty[o.id] || 0) >= (avail[o.id] ?? 0)}
                              onClick={() => {
                                setQty((cur) => ({ ...cur, [o.id]: (cur[o.id] || 0) + 1 }));
                                setOceanFor(null);
                              }}
                            >
                              {o.name}, {money(o.priceCents)}
                            </button>
                          ))}
                          <button type="button" className="btn-ghost !min-h-9 !py-1 text-sm text-muted" onClick={() => setOceanFor(null)}>
                            Skip
                          </button>
                        </div>
                      </div>
                    )}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="font-bold">Customer</h2>
        <div>
          <input className="input" placeholder="Full name *" value={form.name} onChange={typing("name")} onBlur={() => window.setTimeout(() => setLookFor(null), 150)} autoComplete="off" data-pos-name />
          {suggestions("name")}
        </div>
        <div>
          <input className="input" placeholder="Mobile phone" inputMode="tel" value={form.phone} onChange={typing("phone")} onBlur={() => window.setTimeout(() => setLookFor(null), 150)} autoComplete="off" data-pos-phone />
          {suggestions("phone")}
        </div>
        <input className="input" placeholder="Email (optional)" type="email" value={form.email} onChange={set("email")} />
        <div>
          <input className="input" placeholder="Delivery address (or type a name, phone or street to find it in the Directory)" value={form.address} onChange={typing("address")} onBlur={() => window.setTimeout(() => setLookFor(null), 150)} autoComplete="off" data-pos-address />
          {suggestions("address")}
        </div>
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
          {/* Abraham, Nov 24, 2026: Cash and Check, then card and Pay on delivery, then the payment link on one long line */}
          {([
            ["cash", "Cash"],
            ["check", "Check"],
            ["card", "Credit or debit card"],
            ["later", "Pay on delivery"],
            ["link", "Send payment link by text"],
          ] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setPayment(v)} className={`btn-ghost text-sm ${v === "link" ? "col-span-2" : ""} ${payment === v ? "!border-navy !bg-bg" : ""}`} data-pay-option={v}>
              {l}
            </button>
          ))}
        </div>
        {(payment === "cash" || payment === "check") && (
          <input className="input" placeholder="Amount received" inputMode="decimal" value={form.amountPaid} onChange={set("amountPaid")} />
        )}

        <div className="space-y-1 border-t border-line pt-3 text-sm" data-pos-totals>
          <div className="flex justify-between"><span className="text-muted">Items</span><span className="font-semibold" data-pos-items>{money(quote?.itemsCents ?? total)}</span></div>
          {quote && quote.offerCents !== 0 && (
            <div className="flex justify-between"><span className="text-muted">{quote.offerNote}</span><span className="font-semibold">{quote.offerCents > 0 ? `−${money(quote.offerCents)}` : `+${money(-quote.offerCents)}`}</span></div>
          )}
          <div className="flex justify-between"><span className="text-muted">Delivery</span><span className="font-semibold" data-pos-delivery>{quote?.deliveryCents != null ? money(quote.deliveryCents) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted">Sales tax{quote?.taxPercent != null ? ` (${quote.taxPercent}%)` : ""}</span><span className="font-semibold" data-pos-tax>{quote?.taxCents != null ? money(quote.taxCents) : "—"}</span></div>
          <div className="flex items-start justify-between gap-3 pt-1">
            <span className="pt-1.5 text-base text-muted">Total</span>
            <div className="text-right">
              <span className="text-2xl font-black" data-pos-total>{fullTotal != null ? money(fullTotal) : money(total)}</span>
              {quoting && <span className="ml-2 text-xs text-muted">updating…</span>}
              {quote?.problem && <p className="mt-1 max-w-xs text-xs font-bold text-[#b3261e]" role="alert" data-pos-problem>{quote.problem}</p>}
              {fullTotal == null && !quote?.problem && total > 0 && <p className="text-xs text-muted">Items only, until the address is priced</p>}
            </div>
          </div>
          {linkBlocked && <p className="rounded-lg bg-[#ffe6e4] p-2 text-xs font-bold text-[#b3261e]" data-pos-link-blocked>No booking until the address can be priced.</p>}
          {payment === "card" && !linkBlocked && <p className="rounded-lg bg-bg p-2 text-xs text-muted" data-pos-card-note>After Book it, open the secure Sola card page and type the customer&apos;s credit or debit card there. The card number never goes through our system.</p>}
        </div>
        <button className="btn w-full py-3.5" disabled={pending || !date || total === 0 || check?.ok === false || linkBlocked || (props.askTerms !== false && !form.termsVia)} onClick={submit}>
          {pending ? "Booking…" : "Book it"}
        </button>
        {result && (
          <p className={`rounded-xl p-3 text-sm font-semibold ${result.ok ? "bg-mint/15 text-[#13895C]" : "bg-coral/10 text-coral-dark"}`}>
            {result.message}{" "}
            {result.orderId && <Link className="underline" href={`/admin/orders/${result.orderId}`}>Open order</Link>}
            {result.cardUrl && (
              <a href={result.cardUrl} target="_blank" rel="noopener noreferrer" className="btn mt-3 block w-full py-3 text-center" data-pos-card-page>
                Open the secure card page ({money(result.cardCents ?? 0)})
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { recentAttempts } from "@/lib/sola-phonepay";
import { orderNumber } from "@/lib/orders";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { dualDateTime } from "@/lib/dual-date";
import { savePhonePayAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sola PhonePay · Hup Up Attractions", robots: { index: false } };

const NOTE: Record<string, string> = {
  Paid: "Paid",
  not_found: "No Sola payment found",
  amount_mismatch: "Different amount",
  ambiguous: "Two payments with the same amount",
};

/** Owner only (Abraham, Nov 14, 2026): callers pay by card through Sola's free PhonePay line. No card data, ever. */
export default async function PhonePayPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireOwner();
  const { m } = await searchParams;
  const [s, attempts] = await Promise.all([getSettings(), recentAttempts(20)]);
  const ready = {
    pin: Boolean(process.env.SOLA_PHONEPAY_PIN),
    sub: Boolean(process.env.TWILIO_PAY_SIP_DOMAIN && process.env.TWILIO_PAY_SIP_USERNAME && process.env.TWILIO_PAY_SIP_PASSWORD && process.env.TWILIO_PAY_AUTH_TOKEN),
    api: Boolean(process.env.SOLA_API_KEY),
  };
  return (
    <div className="mx-auto max-w-4xl" data-phonepay>
      <h1 className="text-2xl font-black sm:text-3xl">Sola PhonePay</h1>
      <p className="mb-4 mt-1 text-muted">
        Callers pay by card on the phone. After the order is read back, a caller who presses 1 is passed to Sola&rsquo;s secure PhonePay line, types the card on the keypad, and comes back to finish the order. We never hear, record or keep the card number. The payment is then found in Sola and the order is marked paid.
      </p>
      {m && <p className="card mb-4 p-3 text-sm font-semibold" data-phonepay-message>{m}</p>}

      <section className="card mb-5 p-5" data-phonepay-ready>
        <h2 className="mb-2 text-lg font-bold">Set up</h2>
        <ul className="space-y-1 text-sm">
          <li>{ready.pin ? "Yes" : "Not yet"}: our PhonePay merchant PIN (SOLA_PHONEPAY_PIN in Vercel, added by Hark)</li>
          <li>{ready.sub ? "Yes" : "Not yet"}: the payment subaccount &ldquo;Hup Up Payments&rdquo; and its SIP domain</li>
          <li>{ready.api ? "Yes" : "Not yet"}: the Sola key used to find each payment (SOLA_API_KEY)</li>
        </ul>
      </section>

      <form action={savePhonePayAction} className="card mb-5 grid gap-4 p-5" data-phonepay-form>
        <label className="block" data-phone-card-provider>
          <span className="label">Card payments on the phone line go through</span>
          <select name="provider" defaultValue={s.phoneCardProvider} className="input">
            <option value="sola">Sola PhonePay (the live choice)</option>
            <option value="stripe">Stripe through Twilio Pay (test numbers only until you approve Stripe live mode)</option>
          </select>
          <span className="mt-1 block text-xs text-muted">Only you can change this. The staff POS and the website always use Sola.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="on" defaultChecked={s.solaPhonePayOn} className="mt-1" />
          <span><b>Turn on phone payments by card.</b> <span className="text-sm text-muted">When off, every caller gets the secure payment link, as today.</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="ownerOnly" defaultChecked={s.solaPhonePayOwnerOnly} className="mt-1" />
          <span><b>Only test calls</b> from the numbers below. <span className="text-sm text-muted">Untick this to offer it to every caller, after your test payment and once the 5 phone lines are approved.</span></span>
        </label>
        <label className="block" data-payment-test-numbers>
          <span className="label">Payment test numbers</span>
          <textarea name="testNumbers" rows={3} defaultValue={s.paymentTestNumbers.split(/[\n,;]+/).filter(Boolean).map((n) => formatPhone(n)).join("\n")} className="input font-mono" />
          <span className="mt-1 block text-xs text-muted">One phone number per line. While &ldquo;Only test calls&rdquo; is ticked, only calls from these numbers (and always (845) 777-7585) are offered pay by card.</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="label">PhonePay number</span><input name="number" defaultValue={formatPhone(s.solaPhonePayNumber)} className="input" placeholder="(833) 434-3354" /></label>
          <label className="block"><span className="label">Backup number (used if the first does not answer)</span><input name="backup" defaultValue={formatPhone(s.solaPhonePayBackup)} className="input" placeholder="(844) 422-7356" /></label>
        </div>
        <label className="block">
          <span className="label">Digits sent to PhonePay</span>
          <input name="digits" defaultValue={s.solaPhonePayDigits} className="input font-mono" />
          <span className="mt-1 block text-xs text-muted">
            Sent automatically after PhonePay answers. <code>w</code> waits half a second. <code>{"{pin}"}</code> is our merchant PIN (kept secret in Vercel), <code>{"{amount}"}</code> the total in cents with no point (230.00 is 23000), <code>{"{dollars}"}</code> whole dollars, <code>{"{order}"}</code> the order number. The default matches your test call of November 15: it waits 5 seconds for the greeting, enters the PIN and pound, waits 12 seconds for the amount question, enters the amount and pound, waits 5 seconds, then presses 1 to confirm. After that it sends nothing more, and the caller types the card.
          </span>
        </label>
        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2" data-phonepay-custom>
          <p className="text-sm sm:col-span-2"><b>Owner custom charge</b> (owner voicemail menu, key 7): charge any amount by phone, after your voicemail password.</p>
          <label className="block"><span className="label">Highest amount allowed, in dollars</span><input name="customCap" inputMode="decimal" defaultValue={(Number(s.solaPhonePayCustomCapCents) / 100).toFixed(2)} className="input" placeholder="5000.00" /></label>
          <label className="block"><span className="label">Digits sent to PhonePay for a custom charge</span><input name="customDigits" defaultValue={s.solaPhonePayCustomDigits} className="input font-mono" /><span className="mt-1 block text-xs text-muted">Same rules as above. Leave {"{amount}"} out if PhonePay should let you type the amount yourself.</span></label>
        </div>
        <button className="btn-dark w-fit">Save</button>
      </form>

      <section className="card p-5" data-phonepay-attempts>
        <h2 className="mb-2 text-lg font-bold">Last 20 attempts</h2>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">No attempts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">When</th><th className="th">Order</th><th className="th">Try</th><th className="th">Amount</th><th className="th">Matched</th><th className="th">Card</th><th className="th">Sola reference</th></tr></thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td className="td">{dualDateTime(a.startedAt)}</td>
                  <td className="td">
                    {a.orderId ? <a className="underline" href={`/admin/orders/${a.orderId}`}>Order number {orderNumber(a.orderId)}</a> : "No order number"}
                    {a.kind === "custom" && <span className="block text-xs text-muted">Custom charge (owner)</span>}
                  </td>
                  <td className="td">{a.kind === "custom" ? "" : `${a.tryNumber} of 6`}</td>
                  <td className="td">{formatMoney(a.amountCents)}</td>
                  <td className={`td font-semibold ${a.matched ? "text-[#13895C]" : a.matched === false ? "text-[#C83A2F]" : "text-muted"}`}>{a.matched ? "Yes" : a.matched === false ? `No (${NOTE[a.note ?? ""] ?? a.note ?? ""})` : "In progress"}</td>
                  <td className="td">{a.cardType ?? ""}{a.last4 ? ` ending ${a.last4}` : ""}</td>
                  <td className="td font-mono text-xs">{a.solaRef ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

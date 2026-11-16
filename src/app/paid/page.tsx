import { BUSINESS_NAME, config } from "@/lib/config";
import { HEADER_LOGO } from "@/components/site/parts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Thank You | Hup Up Attractions", description: "Your Hup Up Attractions payment is being confirmed.", robots: { index: false, follow: false } };

/**
 * Where Sola's PaymentSITE sends the customer after paying (or after a payment that did not go through). Confirmation
 * itself comes from the webhook. Brand look (Abraham, Nov 17, 2026): the website logo on plain white, brand colors
 * #FFD84D, #8CCBFF, white and #123D73. Wording unchanged.
 */
export default async function Paid({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const invoice = sp.invoice || sp.xInvoice;
  const declined = sp.xResult && sp.xResult !== "A";
  return (
    <main className="grid min-h-screen place-items-center bg-[#8CCBFF] px-4 py-10" data-paid-page>
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white text-center shadow-2xl ring-1 ring-black/5">
        <div className="bg-white px-8 pb-5 pt-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HEADER_LOGO.src} srcSet={HEADER_LOGO.srcSet} width={91} height={96} alt="Hup Up Attractions" className="mx-auto h-24 w-auto" data-brand-logo />
        </div>
        <div className="h-1.5 bg-[#FFD84D]" aria-hidden />
        <div className="px-8 pb-8 pt-6 text-[#123D73]">
          {declined ? (
            <>
              <h1 className="text-2xl font-black">Payment did not go through</h1>
              <p className="mt-2">Please try the link again, or call us at {config.hotlineDisplay}.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-black">Thank you!</h1>
              <p className="mt-2">
                {invoice ? `Order ${invoice.replace(/^HU-/, "#")}` : "Your order"} is being confirmed. You will receive a
                text as soon as it&apos;s done.
              </p>
            </>
          )}
          <p className="mt-6 text-sm font-semibold">{BUSINESS_NAME} · {config.hotlineDisplay}</p>
        </div>
      </div>
    </main>
  );
}

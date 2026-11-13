import { BUSINESS_NAME, config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Thank You | Hup Up Attractions", description: "Your Hup Up Attractions payment is being confirmed.", robots: { index: false, follow: false } };

/** Where Sola's PaymentSITE sends the customer after paying. Confirmation itself comes from the webhook. */
export default async function Paid({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const invoice = sp.invoice || sp.xInvoice;
  const declined = sp.xResult && sp.xResult !== "A";
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="card max-w-md p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Hup Up Attractions" className="mx-auto h-14" />
        {declined ? (
          <>
            <h1 className="mt-5 text-2xl font-black">Payment did not go through</h1>
            <p className="mt-2 text-muted">Please try the link again, or call us at {config.hotlineDisplay}.</p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-2xl font-black">Thank you!</h1>
            <p className="mt-2 text-muted">
              {invoice ? `Order ${invoice.replace(/^HU-/, "#")}` : "Your order"} is being confirmed. You will receive a
              text as soon as it&apos;s done.
            </p>
          </>
        )}
        <p className="mt-6 text-sm text-muted">{BUSINESS_NAME} · {config.hotlineDisplay}</p>
      </div>
    </main>
  );
}

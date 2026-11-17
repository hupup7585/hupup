import type { Metadata } from "next";
import { UNSUBSCRIBE_TEXT, unsubscribe } from "@/lib/unsubscribe";
import { verifyUnsubscribe } from "@/lib/signed-link";

export const metadata: Metadata = { title: "Unsubscribe | Hup Up Attractions", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The Unsubscribe link at the bottom of promotional emails: one button (so link checkers cannot unsubscribe anyone). */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ e?: string; s?: string; done?: string }> }) {
  const sp = await searchParams;
  const ok = verifyUnsubscribe(sp.e ?? null, sp.s ?? null);
  async function confirm() {
    "use server";
    await unsubscribe(sp.e ?? null, sp.s ?? null);
    const { redirect } = await import("next/navigation");
    redirect(`/unsubscribe?e=${encodeURIComponent(sp.e ?? "")}&s=${encodeURIComponent(sp.s ?? "")}&done=1`);
  }
  return (
    <main className="min-h-screen bg-hu-tint px-4 py-10 font-display text-hu-deep">
      <div className="mx-auto max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6 text-center" data-unsubscribe>
        <h1 className="text-2xl font-extrabold">{UNSUBSCRIBE_TEXT.title}</h1>
        {!ok ? (
          <p className="mt-3">{UNSUBSCRIBE_TEXT.bad}</p>
        ) : sp.done ? (
          <p className="mt-3">{UNSUBSCRIBE_TEXT.done}</p>
        ) : (
          <form action={confirm} className="mt-4">
            <p className="mb-4">{UNSUBSCRIBE_TEXT.ask}</p>
            <button className="btn-dark w-full py-3">{UNSUBSCRIBE_TEXT.button}</button>
          </form>
        )}
      </div>
    </main>
  );
}

import { getSiteContent } from "@/lib/site-content";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

export default async function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const c = await getSiteContent();
  return (
    <div className="font-display text-hu-deep">
      <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-4xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm opacity-70">Last updated {updated}</p>
        <div className="mt-8 space-y-5 text-lg leading-relaxed [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-bold [&_li]:ml-6 [&_li]:list-disc">{children}</div>
      </main>
      <SiteFooter c={c} />
    </div>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import PhoneAutoFormat from "@/components/PhoneAutoFormat";
import { isLiveSite } from "@/lib/seo";
import { config } from "@/lib/config";

import { inter, poppins } from "./fonts";

export const metadata: Metadata = {
  // canonical and share links use the real site address, never a vercel.app one (item 7, Nov 25, 2026)
  metadataBase: new URL(config.siteUrl()),
  title: "Bounce House & Party Rentals in Kiryas Joel, NY | Hup Up Attractions",
  description:
    "Hup Up Attractions makes party planning easy with bounce house, laser tag, inflatable maze and paddle boat rentals in Kiryas Joel and Orange County, NY. Call (845) 777-7585.",
  // Only the live site is indexed; every preview stays noindex (SEO rule in CLAUDE.md).
  robots: isLiveSite() ? { index: true, follow: true } : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${inter.variable}`}>
      <body className="font-sans antialiased">
        <PhoneAutoFormat />
        {children}
      </body>
    </html>
  );
}

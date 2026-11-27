import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import PhoneAutoFormat from "@/components/PhoneAutoFormat";
import { isLiveSite } from "@/lib/seo";

// Code audit L3 (Nov 24, 2026): Inter is self-hosted by Next (no blocking request to Google Fonts on every page)
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], variable: "--font-inter", display: "swap", preload: false });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-poppins", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "https://hupupattractions.com"),
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

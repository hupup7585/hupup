import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { isLiveSite } from "@/lib/seo";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-poppins", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "https://hupup.vercel.app"),
  title: "Bounce House & Party Rentals in Kiryas Joel, NY | Hup Up Attractions",
  description:
    "Hup Up Attractions makes party planning easy with bounce house, laser tag, inflatable maze and paddle boat rentals in Kiryas Joel and Orange County, NY. Call (845) 777-7585.",
  // Only the live site is indexed; every preview stays noindex (SEO rule in CLAUDE.md).
  robots: isLiveSite() ? { index: true, follow: true } : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <head>
        {/* Inter for the admin screens */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

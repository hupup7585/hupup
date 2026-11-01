import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hup Up Attractions — Bounce Houses, Laser Tag & Paddle Boats in Kiryas Joel",
  description:
    "Bounce houses, laser tag with inflatable mazes, and paddle boat rentals delivered in Kiryas Joel and the surrounding area. Call to book.",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

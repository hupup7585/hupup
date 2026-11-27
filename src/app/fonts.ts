import { Inter, Poppins } from "next/font/google";

// Code audit L3 (Nov 24, 2026): Inter is self-hosted by Next (no blocking request to Google Fonts on every page)
export const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], variable: "--font-inter", display: "swap", preload: false });
export const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-poppins", display: "swap" });

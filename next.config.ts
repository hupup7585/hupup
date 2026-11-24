import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "twilio"],
  // Bookkeeping receipts and tax-exempt certificates (up to 4 MB, under Vercel's 4.5 MB request limit).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // The Terms and SMS Terms link to /privacy-policy; the page lives at /privacy.
  async redirects() {
    return [
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
      // Nov 24, 2026: addresses people try for the rentals go to that part of the home page (one-page site)
      { source: "/rentals", destination: "/#rentals", permanent: false },
      { source: "/catalog", destination: "/#rentals", permanent: false },
      { source: "/jumping-balloons", destination: "/#jumping-balloons", permanent: false },
      { source: "/paddle-boats", destination: "/#paddle-boats", permanent: false },
      { source: "/laser-tag", destination: "/#laser-tag", permanent: false },
    ];
  },
};

export default nextConfig;

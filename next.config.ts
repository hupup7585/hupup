import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "twilio"],
  // Bookkeeping receipts and tax-exempt certificates (up to 4 MB, under Vercel's 4.5 MB request limit).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // The Terms and SMS Terms link to /privacy-policy; the page lives at /privacy.
  async redirects() {
    return [{ source: "/privacy-policy", destination: "/privacy", permanent: true }];
  },
};

export default nextConfig;

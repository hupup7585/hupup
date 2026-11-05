import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "twilio"],
  // The Terms and SMS Terms link to /privacy-policy; the page lives at /privacy.
  async redirects() {
    return [{ source: "/privacy-policy", destination: "/privacy", permanent: true }];
  },
};

export default nextConfig;

import type { Metadata } from "next";

/** Review pages for Abraham only: never indexed, not linked from the site, not in the sitemap. */
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

export default function MockupsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

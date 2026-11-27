import type { Metadata } from "next";
import ErrorScreen from "@/components/site/ErrorScreen";

export const metadata: Metadata = { title: "Page unavailable | Hup Up Attractions", robots: { index: false, follow: true } };

/**
 * A page that can't be shown (Abraham, Nov 27, 2026, item 7): the same branded error page as error.tsx, with the site
 * header and footer, the approved words and one button back to the homepage. No database needed.
 */
export default function NotFound() {
  return <ErrorScreen />;
}

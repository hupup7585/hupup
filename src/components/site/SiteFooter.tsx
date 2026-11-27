import type { SiteContent } from "@/lib/site-content";
import { termsActive } from "@/lib/rental-terms";
import SiteFooterView from "./SiteFooterView";

export default function SiteFooter({ c }: { c: SiteContent }) {
  return <SiteFooterView c={c} termsLink={termsActive()} />;
}

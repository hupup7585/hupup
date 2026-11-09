import { Phone, type LucideIcon } from "lucide-react";
export { categoryIcon } from "@/lib/category-icons";
import { keepName } from "@/lib/site-copy";
import type { SiteContent } from "@/lib/site-content";

/*
 * Shared building blocks for the public pages.
 * Flat palette colors only (no gradients/glows). One icon set: Lucide, stroke 2.
 */

export const ICON_STROKE = 2;

/** Official logo (transparent PNG). Abraham's rule: on light blue #8CCBFF, never on navy. */
export const LOGO_SRC = "/brand/hupup-logo-320.png";
/** Sharp header logo files (96px tall at 1x, 2x and 3x), served as-is with no image compression. */
export const HEADER_LOGO = { src: "/brand/hupup-logo-h96@1x.png", srcSet: "/brand/hupup-logo-h96@1x.png 1x, /brand/hupup-logo-h96@2x.png 2x, /brand/hupup-logo-h96@3x.png 3x" };

export function Wordmark({ logoUrl, light = false }: { logoUrl: string | null; light?: boolean }) {
  // On light backgrounds show the logo on its light blue tile; on navy (light = true) keep the text name instead.
  if (!light) {
    return (
      <span data-logo-tile className="inline-block rounded-2xl bg-[#8CCBFF] p-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl || HEADER_LOGO.src}
          srcSet={logoUrl ? undefined : HEADER_LOGO.srcSet}
          alt="Hup Up Attractions"
          width={91}
          height={96}
          fetchPriority="high"
          className="block h-[72px] w-auto sm:h-24"
        />
      </span>
    );
  }
  return (
    <span className={`whitespace-nowrap font-display text-lg font-extrabold leading-none tracking-tight min-[400px]:text-xl sm:text-2xl ${light ? "text-white" : "text-hu-deep"}`}>
      Hup Up <span className={light ? "text-hu-yellow" : "rounded-md bg-hu-yellow px-1.5"}>Attractions</span>
    </span>
  );
}

export function CallButton({ phone, label = "CALL TO BOOK", variant = "solid", className = "" }: { phone: string; label?: string; variant?: "solid" | "outline"; className?: string }) {
  return (
    <a href={`tel:${phone}`} className={`${variant === "solid" ? "hu-btn" : "hu-btn-outline"} ${className}`}>
      <Phone className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden /> {label}
    </a>
  );
}

/** Icon on a flat square tile. */
export function IconTile({ icon: Icon, tone = "sky", size = "md" }: { icon: LucideIcon; tone?: "sky" | "yellow" | "white"; size?: "sm" | "md" | "lg" }) {
  const bg = tone === "sky" ? "bg-hu-sky" : tone === "yellow" ? "bg-hu-yellow" : "bg-white";
  const dims = size === "lg" ? "h-20 w-20 rounded-3xl" : size === "sm" ? "h-9 w-9 rounded-xl" : "h-12 w-12 rounded-2xl";
  const icon = size === "lg" ? "h-10 w-10" : size === "sm" ? "h-5 w-5" : "h-6 w-6";
  return (
    <span className={`grid shrink-0 place-items-center border-2 border-hu-deep text-hu-deep ${bg} ${dims}`} aria-hidden>
      <Icon className={icon} strokeWidth={ICON_STROKE} />
    </span>
  );
}

/** Wavy divider, used sparingly. `fill` is the color of the section BELOW it. */
export function Wave({ fill = "#FFFFFF", className = "" }: { fill?: string; className?: string }) {
  return (
    <svg viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden className={`block h-10 w-full sm:h-16 ${className}`}>
      <path d="M0 48c120 22 240 32 360 20S600 14 720 16s240 34 360 40 240-6 360-30v54H0z" fill={fill} />
    </svg>
  );
}

export function SectionTitle({
  kicker,
  title,
  className = "",
  compactLg = false,
  kickerSpacing = "mb-2",
}: {
  kicker?: string;
  title: string;
  className?: string;
  compactLg?: boolean;
  /** Margin classes for the small label above the heading (default mb-2). */
  kickerSpacing?: string;
}) {
  return (
    <div className={className}>
      {kicker && <p className={`${kickerSpacing} text-sm font-extrabold uppercase tracking-[0.18em] text-hu-deep`}>{keepName(kicker)}</p>}
      <h2 className={`font-display text-[1.7rem] font-extrabold leading-tight text-hu-deep min-[370px]:text-3xl sm:text-4xl ${compactLg ? "lg:text-4xl xl:text-5xl" : "lg:text-5xl"}`}>{keepName(title)}</h2>
    </div>
  );
}

export type Content = SiteContent;

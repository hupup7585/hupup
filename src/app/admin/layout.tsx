import type { ReactNode } from "react";

/** Every staff page (sign-in, admin, deliveries): its own description, never the customer home page's, and never indexed. */
export const metadata = {
  description: "Staff sign-in and tools for Hup Up Attractions.",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return children;
}

"use client";

import ErrorScreen from "@/components/site/ErrorScreen";

/**
 * Any website page that breaks (a website or database problem): the branded error page with Abraham's approved words
 * (Nov 27, 2026, item 7), never a blank screen or a technical error. The details stay in the server logs only.
 */
export default function ErrorPage() {
  return <ErrorScreen />;
}

"use client";

import "./globals.css";
import { inter, poppins } from "./fonts";
import ErrorScreen from "@/components/site/ErrorScreen";

/**
 * When even the site's main layout fails: the same branded error page (Abraham, Nov 27, 2026, item 7), with its own
 * html and body as Next requires, the site fonts and colors. No error codes or technical words.
 */
export default function GlobalError() {
  return (
    <html lang="en" className={`${poppins.variable} ${inter.variable}`}>
      <head>
        <title>Hup Up Attractions</title>
        <meta name="robots" content="noindex" />
      </head>
      <body className="font-sans antialiased">
        <ErrorScreen />
      </body>
    </html>
  );
}

/* Website catalog request wording (Abraham, Nov 18, 2026). No server code here: the page form imports it. */
export const CATALOG_EMAIL_BUTTON = "Email me the catalog";
/** Draft (Abraham, Nov 18, 2026: "an option to receive it by text from our website"), waiting for his OK. */
export const CATALOG_TEXT_BUTTON = "Text me the catalog";
/** Draft lines, waiting for Abraham's OK (preview only). */
export const CATALOG_FORM_DRAFT = {
  placeholder: "Your email address",
  phonePlaceholder: "Your cell phone number",
  textSent: "Sent! Please check your texts.",
  badPhone: "Please enter a 10-digit phone number.",
  textAgain: "We already texted the catalog to this number today.",
  sent: "Sent! Please check your email.",
  bad: "Please enter a valid email address.",
  again: "We already sent the catalog to this email today. Please check your inbox.",
  failed: "Sorry, we could not send it right now. Please call us at (845) 777-7585.",
};

/* Catalog by text consent, Plan A (Abraham, Nov 27, 2026, 1:52 AM; his exact words). Website only. */
export const CATALOG_TEXT_CONSENT = "Yes, text the Hup Up Attractions catalog to this number.";
export const CATALOG_TEXT_FINE_PRINT = "One text with our catalog. Message and data rates may apply. Reply STOP to stop, or HELP for help.";
/** The version saved with each consent record (change it whenever the two lines above change). */
export const CATALOG_TEXT_CONSENT_VERSION = "catalog-web-2026-11-27";

/** Drafts waiting for Abraham's OK: shown on preview only; the live site shows `failed` until approved. */
export const CATALOG_TEXT_DRAFT = {
  stopped: "This number replied STOP to our texts, so we cannot text it. To get our texts again, text START to (845) 415-7585.",
  noConsent: "Please tick the box to get the catalog by text.",
};


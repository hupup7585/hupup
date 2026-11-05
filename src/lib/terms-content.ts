/**
 * The Terms and Conditions text customers accept, as plain text, with its version and effective date.
 * The /terms page shows the same wording (a test keeps them in sync). When Abraham's final text (v4) arrives,
 * replace TERMS_TEXT, set the version and effective date, and the new version is stored on first acceptance.
 */
export const TERMS_VERSION = "terms-2026-11-06-AE";
/** "draft" while /terms is preview-only; the real effective date once Abraham approves the final version. */
export const TERMS_EFFECTIVE_DATE = "draft";

export const TERMS_SECTIONS: { heading: string; body: string }[] = [
  { heading: "TERMS AND CONDITIONS", body: 'HUP UP ATTRACTIONS INC. ("Hup Up Attractions")' },
  {
    heading: "A. ACCEPTANCE OF TERMS",
    body: "By reserving, paying for, accepting delivery of, or using any equipment or services provided by Hup Up Attractions, you acknowledge that you have read, understood, and agree to be bound by all terms, conditions, policies, and notices contained herein, as well as any additional terms published on our website (https://hupupattractions.com).",
  },
  {
    heading: "B. NO SIGNATURE REQUIRED",
    body: "Completing a reservation or payment, including pressing # on our phone line or paying by our payment link, constitutes full acceptance of these Terms. No physical or electronic signature is required to make these Terms and Conditions binding upon you.",
  },
  {
    heading: "C. GENERAL RULES AND REGULATIONS",
    body: "See Sections 9 through 13 (Bounce Houses and Inflatable Attractions, Laser Tag and Inflatable Mazes, Paddle Boats and Water Safety, Supervision of Minors, Participant Conduct and Safety Rules).",
  },
  { heading: "D. LIABILITY AND WAIVERS", body: "See Sections 15 through 18 (Injuries and Incidents, Assumption of Ordinary Activity Risks, Limitation of Liability, Customer Responsibility for Claims and Damage)." },
  {
    heading: "E. MODIFICATIONS TO TERMS",
    body: "Hup Up Attractions may update or modify these Terms and Conditions at any time. The most current version, with its effective date, will always be available at https://hupupattractions.com/terms. Changes apply to reservations made after the update; a reservation already confirmed follows the Terms in effect when it was made.",
  },
];

export const TERMS_TEXT = TERMS_SECTIONS.map((s) => `${s.heading}\n${s.body}`).join("\n\n");

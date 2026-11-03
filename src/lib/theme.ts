/**
 * Hup Up Attractions brand palette — the ONE place to change website colors.
 * The same values are mirrored as CSS tokens in src/app/globals.css (@theme "--color-hu-*").
 * Rules: mostly white + sky blue, yellow buttons, deep blue only as an accent (text on sky/yellow,
 * footer, some headings). Never white text on sky blue or yellow.
 */
export const theme = {
  yellow: "#FFD84D",
  sky: "#8CCBFF",
  white: "#FFFFFF",
  deep: "#123D73",
  /** very light sky tint for alternating sections */
  skyTint: "#EEF7FF",
} as const;

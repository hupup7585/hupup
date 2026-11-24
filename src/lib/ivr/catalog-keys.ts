/** Spoken letters ("Y O S S I", "j o h n dot smith") to text. */
export function spokenLetters(said: string): string {
  return said
    .toLowerCase()
    // Speech results come back punctuated ("Y. O. S. S. I."): those periods are not dots in the address (Abraham,
    // Nov 17, 2026). Only a spoken "dot" (or "period", "point") is a real dot.
    .replace(/[.,!?;:]/g, " ")
    .replace(/\b(dot|period|point)\b/g, ".")
    .replace(/\b(underscore|under score)\b/g, "_")
    .replace(/\b(dash|hyphen|minus)\b/g, "-")
    .replace(/\bat\b/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

/** "y o s s i dot k" for reading back. */
export function spellOut(text: string): string {
  return text
    .split("")
    .map((c) => (c === "." ? "dot" : c === "_" ? "underscore" : c === "-" ? "dash" : c))
    .join(" ");
}

export const CATALOG_ENDINGS: Record<string, string> = { "1": "gmail.com", "2": "outlook.com", "3": "yahoo.com", "4": "icloud.com" };

export const validLocal = (s: string) => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(s);
export const validDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) && s.length <= 253;

/**
 * "y o s s i at gmail dot com", said in one smooth run (Abraham, Nov 14, 2026): no comma or pause between the parts,
 * "dot" only where the address really has one, "at" for @.
 */
export function spokenEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${spellOut(user)} at ${domain.split(".").filter(Boolean).join(" dot ")}`.replace(/\s+/g, " ").trim();
}

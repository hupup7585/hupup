/**
 * Keypad typing, the ONE decoder for every typing step: name, street, checkout email, catalog email and payment-link
 * email (Abraham's decision, Nov 24, 2026: silent typing, one Gather, decoded at the end). Exactly as the recording says:
 *  - keys 2 to 9: once for the first letter, twice for the second, and so on (2 = abc ... 7 = pqrs, 9 = wxyz);
 *    one more press after the last letter = that digit (2222 = 2, 77777 = 7, 99999 = 9);
 *  - one star = separator between two letters on the same key (2*22 = ab);
 *  - two stars in a row = go back, erase the last character (2 33 ** 4 = ag); four stars erase two;
 *  - 0 once = space, 00 = the digit 0 (in an email a space is left out);
 *  - 1 once = 1, 11 = dot, 111 = dash, 1111 = underscore (the same in every step);
 *  - pound = finished (Twilio's finishOnKey, so it never arrives here). No pause between presses is needed.
 */
const LETTERS: Record<string, string> = { "2": "abc", "3": "def", "4": "ghi", "5": "jkl", "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz" };
const CYCLE: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(LETTERS).map(([k, v]) => [k, [...v, k]])),
  "0": [" ", "0"],
  "1": ["1", ".", "-", "_"],
};

export type TypingMode = "text" | "email";

/**
 * Decode keypad presses to text (lowercase). `start` is text already typed (adding more to it: two stars can erase
 * into it). Returns "" when nothing usable was typed.
 */
export function decodeMultitap(input: string, mode: TypingMode = "text", start = ""): string {
  let out = start;
  let i = 0;
  while (i < input.length) {
    const k = input[i];
    let run = 1;
    while (i + run < input.length && input[i + run] === k) run++;
    i += run;
    if (k === "*") {
      out = out.slice(0, Math.max(0, out.length - Math.floor(run / 2))); // each pair of stars erases one; a single star only separates
      continue;
    }
    const cycle = CYCLE[k];
    if (!cycle) continue; // pound or anything else
    const ch = cycle[(run - 1) % cycle.length];
    if (ch === " " && mode === "email") continue; // no spaces in an email address
    out += ch;
  }
  return mode === "email" ? out : out.replace(/\s+/g, " ").trim();
}

/** "yossi friedman" -> "Yossi Friedman" (names and addresses). Emails stay lowercase. */
export function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/**
 * Keypad typing (Abraham L), like old phone texting: press a key once for its first letter, twice for the second, and
 * so on; one more press gives the key's digit (2 once = a, 2222 = 2). A single star separates two letters on the same
 * key (a then b = 2*22), two stars make a space, and # finishes (Twilio stops collecting at #, so it never arrives here).
 * Key 1: in an email, . @ - _ then 1 (one press = dot, two = @); elsewhere the digit 1. Key 0: the digit 0.
 */
const LETTERS: Record<string, string> = { "2": "abc", "3": "def", "4": "ghi", "5": "jkl", "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz" };
const EMAIL_ONE = ".@-_1";

export type TypingMode = "text" | "email";

/** Decode keypad presses to text (lowercase). Returns "" when nothing usable was typed. */
export function decodeMultitap(input: string, mode: TypingMode = "text"): string {
  let out = "";
  // Split into runs: a run is the same key pressed repeatedly; stars separate runs.
  const runs: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "*") {
      let stars = 0;
      while (input[i] === "*") (stars++, i++);
      if (stars >= 2) runs.push(" ".repeat(Math.floor(stars / 2))); // two stars = a space (four = two spaces)
      continue; // one star = just a separator
    }
    let j = i;
    while (input[j] === ch) j++;
    runs.push(input.slice(i, j));
    i = j;
  }
  for (const run of runs) {
    if (run.trim() === "") {
      out += run;
      continue;
    }
    const key = run[0];
    const n = run.length;
    if (LETTERS[key]) {
      const cycle = LETTERS[key] + key;
      out += cycle[(n - 1) % cycle.length];
    } else if (key === "1") {
      out += mode === "email" ? EMAIL_ONE[(n - 1) % EMAIL_ONE.length] : "1".repeat(1);
    } else if (key === "0") {
      out += "0";
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** "yossi friedman" -> "Yossi Friedman" (names and addresses). Emails stay lowercase. */
export function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

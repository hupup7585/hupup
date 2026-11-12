/**
 * Keypad typing for the catalog email (Abraham, Phone Menu v3):
 *  - press a key once, twice or three times for its letter (2 = a b c ... 7 = p q r s, 9 = w x y z);
 *  - star once: the next letter on the same key starts fresh; star twice: erase the last letter;
 *    star three times: go back a step;
 *  - 1 once = dot, twice = underscore, three times = dash;
 *  - 0 switches between letters and numbers (in numbers, each key press is that digit; 1 to 9 only);
 *  - pound finishes (Twilio's finishOnKey, so it never reaches here).
 */
const LETTERS: Record<string, string> = { "2": "abc", "3": "def", "4": "ghi", "5": "jkl", "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz", "1": "._-" };

export type KeysResult = { text: string; back: boolean };

export function decodeCatalogKeys(digits: string, start = ""): KeysResult {
  let text = start;
  let numbers = false;
  let i = 0;
  while (i < digits.length) {
    const k = digits[i];
    let run = 1;
    while (i + run < digits.length && digits[i + run] === k) run++;
    i += run;
    if (k === "*") {
      if (run === 2) text = text.slice(0, -1);
      else if (run >= 3) return { text, back: true };
      continue; // one star: separates two letters on the same key
    }
    if (k === "0") {
      for (let n = 0; n < run; n++) numbers = !numbers; // 0 switches between letters and numbers
      continue;
    }
    if (numbers) {
      text += k.repeat(run);
      continue;
    }
    const set = LETTERS[k];
    if (!set) continue;
    text += set[(run - 1) % set.length];
  }
  return { text, back: false };
}

/** Spoken letters ("Y O S S I", "j o h n dot smith") to text. */
export function spokenLetters(said: string): string {
  return said
    .toLowerCase()
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

/** "yossi at gmail dot com" */
export function spokenEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${spellOut(user)}, at ${domain.replace(/\./g, " dot ")}`;
}

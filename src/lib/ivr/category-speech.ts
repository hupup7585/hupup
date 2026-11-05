/**
 * Lets callers SAY what they want on the main menu instead of pressing a key.
 * "Jumping Balloons" is the business's name for bounce houses, so callers who say
 * "bounce house" / "bouncy castle" still land in that category.
 */
type Cat = { id: number; name: string; spokenName: string | null };

const STOP = new Set(["and", "the", "for", "with", "our"]);

/** Extra phrases per kind of category (matched against the category's own name). */
const SYNONYMS: { when: RegExp; words: string[] }[] = [
  { when: /jump|balloon|bounce|jumper|castle/i, words: ["jumping", "balloon", "balloons", "bounce", "bouncy", "bouncer", "jumper", "castle", "moonwalk", "moon bounce"] },
  { when: /laser|maze/i, words: ["laser", "tag", "maze", "mazes"] },
  { when: /paddle|boat/i, words: ["paddle", "paddles", "boat", "boats"] },
];

function norm(s: string) {
  return ` ${s.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function keywordsFor(c: Cat): string[] {
  const own = norm(`${c.name} ${c.spokenName ?? ""}`)
    .trim()
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));
  const extra = SYNONYMS.filter((s) => s.when.test(`${c.name} ${c.spokenName ?? ""}`)).flatMap((s) => s.words);
  return [...new Set([...own, ...extra])];
}

export type SpeechChoice = { kind: "category"; categoryId: number } | { kind: "cart" } | { kind: "operator" } | { kind: "repeat" } | null;

export function matchMenuSpeech(speech: string, cats: Cat[]): SpeechChoice {
  const s = norm(speech);
  if (!s.trim()) return null;
  if (/ (person|someone|somebody|operator|representative|agent|human) /.test(s)) return { kind: "operator" };
  if (/ (cart|checkout|check out) /.test(s)) return { kind: "cart" };
  if (/ (repeat|again|options|menu) /.test(s)) return { kind: "repeat" };
  let best: { id: number; score: number } | null = null;
  let tie = false;
  for (const c of cats) {
    const score = keywordsFor(c).filter((k) => s.includes(` ${k} `)).length;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: c.id, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? { kind: "category", categoryId: best.id } : null;
}

/** Speech recognition hints for the main menu. */
export function menuSpeechHints(cats: Cat[]): string {
  return [...cats.map((c) => c.spokenName || c.name), "jumping balloons", "bounce house", "bouncy castle", "laser tag", "inflatable maze", "paddle boats", "talk to someone", "check out"].join(", ");
}

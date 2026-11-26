/**
 * No contractions in spoken wording (Abraham's standing rule): "you are", never "you're". Straight and curly
 * apostrophes both count (Hark's Phases 1-3 review, item 12: "you’re", "we’ll" and "don’t" got through).
 * "Let's" is allowed (an approved line uses it).
 */
const CONTRACTION = /\b\w+['’](t|s|re|ll|ve|d|m)\b/i;

export function hasContraction(text: string): boolean {
  return CONTRACTION.test(text.replace(/\blet['’]s\b/gi, "let us"));
}

export const NO_CONTRACTIONS_MESSAGE = "No contractions in a prompt. Please write the words in full (for example: you are, we will, do not).";

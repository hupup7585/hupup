/** All settings: the fixed success messages (Hark's review L11: never free text taken from the address). */
export const OK_MESSAGES = {
  draft: "Draft saved. Customers do not see it until you publish.",
  published: "Published. It is live now.",
  discarded: "Draft discarded. The live value did not change.",
  undo: "The value from before is ready as a draft. Publish it to make it live.",
} as const;
export type OkCode = keyof typeof OK_MESSAGES;

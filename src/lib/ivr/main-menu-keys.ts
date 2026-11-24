/**
 * The main menu's keys in one place (Hark's Admin audit, Nov 24, 2026): the Dashboard legend, the Hotline prompts
 * filter and the call journey all read this list, and it matches the live main menu line and the call routing
 * (menu-choice in flow.ts). A test checks it against the main menu prompt word by word.
 */
export const MAIN_MENU_KEYS: [string, string][] = [
  ["1", "Reservations and bookings"],
  ["2", "Equipment instructions and guidance"],
  ["3", "Customer service"],
  ["4", "Questions or problems during a rental"],
  ["5", "Delivery and pickup information"],
  ["6", "Learn about our rentals"],
  ["7", "Hours of operation"],
  ["8", "Catalog by text or email"],
  ["9", "Feedback and comments (voicemail)"],
  ["0", "Operator"],
];
export const mainMenuKeyLabel = (k: string) => MAIN_MENU_KEYS.find(([key]) => key === k)?.[1] ?? null;

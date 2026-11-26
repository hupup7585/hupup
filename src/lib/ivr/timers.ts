/**
 * Phone timing (Admin handoff Phase 3, section 9A, Nov 26, 2026): every wait the phone line uses, editable in Admin
 * (All settings, group "Phone: timing"). Each default is exactly the value the code used before, so nothing changes
 * for callers until the Owner changes a number. Seconds unless the label says otherwise.
 */
export type PhoneTimer = {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  what: string;
  where: string;
  ifChanged: string;
};

export const PHONE_TIMERS = [
  // Menus and no key
  { key: "timerMenuWait", label: "Main menu: seconds to wait for a key after the last line", default: 3, min: 1, max: 15, what: "How long the main menu waits for a key after its last line before it counts as no key.", where: "Every caller, on the main menu.", ifChanged: "Longer gives callers more time to choose; shorter repeats the menu sooner." },
  { key: "timerMenuPlays", label: "Main menu: plays with no key before the call ends", default: 3, min: 1, max: 10, what: "How many times the main menu plays with no key before the disconnect line and the hang-up.", where: "Callers who press nothing on the main menu.", ifChanged: "More plays keep a silent caller on the line longer; fewer end the call sooner. The minimum seconds below must also have passed." },
  { key: "timerMenuMinSeconds", label: "Main menu: minimum seconds before the call ends with no key", default: 20, min: 5, max: 300, what: "The least time, counted from the first play of the main menu, before a silent call can end.", where: "Callers who press nothing on the main menu.", ifChanged: "A bigger number keeps silent callers longer, even after the plays above." },
  { key: "timerNoKey", label: "Every other screen: seconds to wait for a key", default: 5, min: 2, max: 30, what: "How long a screen waits for a key before it says the no-choice line and plays the screen again. Screens with their own wait below use that instead.", where: "Every menu and question on the phone line except the main menu.", ifChanged: "Longer gives callers more time on every screen; shorter moves on sooner." },
  { key: "timerNoKeyEnd", label: "Every other screen: seconds with no key before the call ends", default: 60, min: 20, max: 600, what: "How long a caller can press nothing on a screen before the disconnect line and the hang-up. Callers with items in the cart use the disconnect check instead.", where: "Callers who stop pressing keys anywhere except the main menu.", ifChanged: "Longer keeps silent callers longer; shorter ends the call sooner." },
  { key: "timerTwoDigit", label: "Two-digit choices: seconds to wait for the second digit", default: 2, min: 1, max: 10, what: "When a list has 10 or more choices, how long the phone waits for a second digit before using the first one alone.", where: "Callers choosing from a long list of rentals, or removing items from a long cart.", ifChanged: "Longer helps slow typists press two digits; shorter answers single-digit choices faster." },
  // Typing on the keypad
  { key: "timerBalloonDigit", label: "Jumping balloon list: seconds to wait for the second digit of an item number", default: 2, min: 1, max: 10, what: "In the jumping balloon list, how long the phone waits for the second digit of an item number before using the first digit alone.", where: "Callers choosing a jumping balloon by its item number.", ifChanged: "Longer helps slow typists; shorter answers one-digit item numbers faster." },
  { key: "timerPhoneDigits", label: "Typing a phone number: seconds to wait", default: 10, min: 3, max: 30, what: "How long the phone waits while a caller types a 10-digit phone number.", where: "Callers typing a number for the catalog text, the payment link, promotional texts or a confirmation.", ifChanged: "Longer gives slow typists more time; shorter moves on sooner when they stop." },
  { key: "timerDateDigits", label: "Typing a date: seconds to wait", default: 8, min: 3, max: 30, what: "How long the phone waits while a caller types the event date (month and day).", where: "Callers booking a rental, at the date question.", ifChanged: "Longer gives more time to type the date; shorter moves on sooner." },
  { key: "timerAddressDigits", label: "Typing a house number, unit or zip code: seconds to wait", default: 10, min: 3, max: 30, what: "How long the phone waits while a caller types the house number, the unit number or the zip code.", where: "Callers entering a delivery address by hand.", ifChanged: "Longer gives more time to type; shorter moves on sooner." },
  { key: "timerSpelling", label: "Spelling a name or street on the keypad: seconds to wait", default: 15, min: 5, max: 60, what: "How long the phone waits while a caller spells letters on the keypad (press 2 once for A, twice for B, and so on).", where: "Callers typing their name or a street name on the keypad.", ifChanged: "Longer gives more time between letters; shorter ends the spelling sooner." },
  { key: "timerEmailSpelling", label: "Spelling an email address on the keypad: seconds to wait", default: 20, min: 5, max: 60, what: "How long the phone waits while a caller spells an email address on the keypad.", where: "Callers asking for the catalog or a receipt by email.", ifChanged: "Longer gives more time between letters; shorter ends the spelling sooner." },
  // Checkout and payment
  { key: "timerCheckoutAnswer", label: "Checkout questions: seconds to wait for a key", default: 8, min: 3, max: 30, what: "How long the checkout questions wait for a key: the rental terms, text updates, payment choice and card retry.", where: "Callers checking out an order.", ifChanged: "Longer gives more time to answer; shorter repeats the question sooner." },
  { key: "timerPaidWait", label: "After payment: seconds to wait after line 3, the line 5 sub-menu and Line 8", default: 3, min: 1, max: 15, what: "How long the phone waits for a key after each question in the after-payment ending (hear it again, text or email, seasonal offers). Line 5 itself does not wait.", where: "Callers who just paid by card on the phone.", ifChanged: "Longer gives more time to press a key; shorter moves to the next line sooner." },
  { key: "timerPaidLine5", label: "After payment, line 5: seconds a key still counts after the line ends", default: 1, min: 1, max: 10, what: "Line 5 (confirmation and receipt by text or email) does not wait: key 1 works while it plays, and the call moves on right after it. This is the short moment after the line in which a key still counts.", where: "Callers who just paid by card on the phone.", ifChanged: "Longer gives a little more time to press 1 after the line ends; the shortest is 1 second." },
  { key: "timerPromoSteps", label: "Promotional texts sign-up steps: seconds to wait", default: 6, min: 3, max: 30, what: "How long the steps after choosing promotional texts wait for a key (which number, and confirming the number).", where: "Callers signing up for promotional texts with a different number.", ifChanged: "Longer gives more time; shorter skips the sign-up sooner when nothing is pressed." },
  { key: "timerCartHoldCheck", label: "Cart hold ran out: seconds to wait for a key after the check", default: 3, min: 1, max: 15, what: "When the cart's hold runs out on a caller who stopped responding, the phone asks them to press any key to keep the items; this is how long it waits.", where: "Callers with items in the cart whose hold ran out while they were silent.", ifChanged: "Longer gives the caller more time to keep the items; shorter releases them and ends the call sooner." },
  // Recordings the caller makes
  { key: "timerSpokenMax", label: "Spoken answers: longest answer, in seconds", default: 20, min: 5, max: 60, what: "The longest a caller can speak when answering a question by voice (for example their name).", where: "Callers answering a checkout question by voice.", ifChanged: "Longer allows longer answers; shorter cuts long answers off sooner." },
  { key: "timerDirectionsMax", label: "Delivery instructions: longest message, in seconds", default: 180, min: 30, max: 600, what: "The longest delivery instructions message a caller can record.", where: "Callers who press 1 to add special delivery instructions.", ifChanged: "Longer allows longer messages; shorter cuts them off sooner." },
  { key: "timerDirectionsSilence", label: "Delivery instructions: seconds of silence that end the message", default: 10, min: 3, max: 30, what: "How many seconds of silence end a delivery instructions recording.", where: "Callers recording delivery instructions.", ifChanged: "Longer lets callers pause to think; shorter ends the recording sooner after they stop." },
  { key: "timerVoicemailSilence", label: "Voicemail: seconds of silence that end the message", default: 6, min: 3, max: 30, what: "How many seconds of silence end a voicemail recording. The longest length is set on each voicemail box.", where: "Callers leaving a voicemail in any box.", ifChanged: "Longer lets callers pause; shorter ends the message sooner after they stop." },
  { key: "timerVoicemailOptions", label: "Voicemail: seconds to wait after the send, listen, record-again choice", default: 6, min: 3, max: 30, what: "How long the phone waits for a key after a voicemail, at the send, listen or record again question.", where: "Callers who just left a voicemail.", ifChanged: "Longer gives more time to choose; shorter sends the message sooner when nothing is pressed." },
  // Staff
  { key: "timerStaffAccept", label: "Staff answering a forwarded call: seconds to press 1", default: 8, min: 3, max: 30, what: "How long a staff member who answers a forwarded call has to press 1 to accept it, the first time.", where: "Staff only: the announcement on the staff member's phone. The caller hears hold music meanwhile.", ifChanged: "Longer gives staff more time; shorter moves to the next phone on the list sooner." },
  { key: "timerStaffAcceptAgain", label: "Staff answering a forwarded call: seconds to press 1 the second time", default: 6, min: 3, max: 30, what: "How long the staff member has to press 1 after the announcement plays a second time.", where: "Staff only: the announcement on the staff member's phone, played a second time.", ifChanged: "Longer gives staff more time; shorter moves to the next phone sooner." },
  { key: "timerStaffMenus", label: "Staff voicemail by phone: seconds to wait on its menus", default: 8, min: 3, max: 30, what: "How long the staff voicemail menus (choose a box, message choices) wait for a key.", where: "Staff calling in to listen to voicemail.", ifChanged: "Longer gives staff more time; shorter repeats or ends sooner." },
  { key: "timerStaffDigits", label: "Staff voicemail by phone: seconds to wait while typing", default: 10, min: 3, max: 30, what: "How long the staff voicemail steps wait while typing a password, a phone number or an order number.", where: "Staff calling in to voicemail.", ifChanged: "Longer gives more time to type; shorter moves on sooner." },
  { key: "timerCallbackRing", label: "Staff calling a customer back: seconds to ring", default: 30, min: 10, max: 120, what: "How long the customer's phone rings when staff call them back from the voicemail menu.", where: "Customers being called back by staff from the hotline number.", ifChanged: "Longer rings the customer longer before giving up." },
] as const satisfies readonly PhoneTimer[];

export type TimerKey = (typeof PHONE_TIMERS)[number]["key"];

/** The stored defaults (text, like every setting). */
export const TIMER_DEFAULTS = Object.fromEntries(PHONE_TIMERS.map((t) => [t.key, String(t.default)])) as Record<TimerKey, string>;

/** The live values from settings, each kept within its limits (a bad value falls back to the default). */
export function timerValues(settings: Record<string, unknown>): Record<TimerKey, number> {
  return Object.fromEntries(
    PHONE_TIMERS.map((t) => {
      const n = Number(settings[t.key]);
      return [t.key, Number.isFinite(n) && n >= t.min && n <= t.max ? n : t.default];
    }),
  ) as Record<TimerKey, number>;
}

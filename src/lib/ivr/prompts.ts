import { db, schema } from "@/lib/db";

/**
 * Every sentence the hotline speaks. Defaults are warm, upbeat and short.
 * Plain text only (Google Chirp3-HD voices don't support SSML) — punctuation creates the pauses.
 * Each prompt can be overridden from /admin/phone/prompts. {placeholders} are filled at runtime.
 */
export type PromptDef = {
  label: string;
  group: string;
  text: string;
  vars?: string[];
  /** Always spoken from the text (never an uploaded recording), so the stored consent language is exactly what was heard. */
  textOnly?: boolean;
};

export const PROMPTS = {
  // Welcome & main menu
  // Abraham's exact main menu (greeting, then one line per key, with a 0.75-second pause after each)
  greeting: { group: "Welcome & main menu", label: "Welcome greeting (Abraham)", text: "Hi! Thank you for calling Hup Up Attractions, bringing something special to every occasion!" },
  // Abraham's main menu, approved Nov 8, 2026 (word for word). Lines with new wording have new names, so an old
  // recording or edit saved for a different meaning can never play by mistake.
  main_enter_extension: { group: "Welcome & main menu", label: "Main menu: enter your extension any time (Abraham)", text: "If you know your desired extension, you may enter it at any time." },
  main_book: { group: "Welcome & main menu", label: "Main menu key 1 (Abraham)", text: "For reservations and bookings, press 1." },
  main_equipment: { group: "Welcome & main menu", label: "Main menu key 2 (Abraham)", text: "For instructions and guidance on using our rental equipment, press 2." },
  main_learn: { group: "Welcome & main menu", label: "Main menu key 3 (Abraham)", text: "To learn more about our rental attractions and the services we offer, press 3." },
  main_service: { group: "Welcome & main menu", label: "Main menu key 4 (Abraham)", text: "For customer service and general inquiries, press 4." },
  main_rental_help: { group: "Welcome & main menu", label: "Main menu key 5 (Abraham)", text: "For questions or assistance with any issues during your rental, press 5." },
  main_6: { group: "Welcome & main menu", label: "Main menu key 6 (Abraham)", text: "For delivery and pickup information, press 6." },
  main_hours: { group: "Welcome & main menu", label: "Main menu key 7 (Abraham)", text: "To hear our hours of operation, press 7." },
  main_organizations: { group: "Welcome & main menu", label: "Main menu key 8 (Abraham)", text: "For schools, corporate events, and organizational bookings, press 8." },
  main_9: { group: "Welcome & main menu", label: "Main menu key 9 (Abraham)", text: "To leave a message in our general voicemail, press 9." },
  main_0: { group: "Welcome & main menu", label: "Main menu key 0 (Abraham)", text: "To speak with an operator, press 0." },
  main_star_again: { group: "Welcome & main menu", label: "Main menu: hear it again (Abraham)", text: "To hear this menu again, press the star key." },
  main_thanks: { group: "Welcome & main menu", label: "Main menu: closing line (Abraham)", text: "Thank you for choosing Hup Up Attractions. We look forward to serving you!" },
  not_valid: { group: "Welcome & main menu", label: "Any menu: a key that is not a choice (Abraham)", text: "Sorry, that is not a valid selection. Please try again." },
  menu_category: { group: "Welcome & main menu", label: "Menu option for a category", text: "For {category}, press {key}.", vars: ["category", "key"] },
  menu_cart: { group: "Welcome & main menu", label: "Menu option: review cart", text: "Ready to check out? Press 9 to hear your cart." },
  menu_operator: { group: "Welcome & main menu", label: "Menu option: talk to a person", text: "To talk with someone from our team, press 0." },
  menu_speech: { group: "Welcome & main menu", label: "Menu: you can also speak", text: "Or just tell me what you're looking for." },
  menu_repeat: { group: "Welcome & main menu", label: "Menu option: repeat", text: "To hear this again, press star." },
  menu_empty: { group: "Welcome & main menu", label: "No rentals set up yet", text: "We're getting our rentals ready right now. Please call back soon!" },

  // Errors & retries
  no_input: { group: "Errors & retries", label: "Didn't hear anything", text: "Sorry, I didn't catch that. No problem, let's try that again." },
  no_input_final: { group: "Errors & retries", label: "Giving up after no input", text: "It sounds like we got disconnected. Please call us back anytime, we'd love to help. Thanks for calling Hup Up Attractions. Bye for now!" },
  tech_error: { group: "Errors & retries", label: "Technical problem", text: "Oops, something went wrong on our end. Please call back in a few minutes. Sorry about that!" },
  went_wrong: { group: "Errors & retries", label: "Something went wrong, back to menu", text: "Sorry, something went wrong. Let's head back to the main menu." },

  // Browsing
  category_intro: { group: "Browsing", label: "Category intro", text: "Awesome, {category}!", vars: ["category"] },
  category_item: { group: "Browsing", label: "Item option in a category", text: "For the {item}, press {key}.", vars: ["item", "key"] },
  back_to_menu: { group: "Browsing", label: "Go back option", text: "To go back to the main menu, press star." },
  category_empty: { group: "Browsing", label: "Category has no items", text: "Sorry, nothing is available in that section right now. Let's head back to the main menu." },
  product_intro: { group: "Browsing", label: "Item intro", text: "Great choice! The {item} is {price}. Delivery is available for an additional fee, and our team will give you the delivery price.", vars: ["item", "price"] },
  product_options: { group: "Browsing", label: "Item options", text: "To hear more about it, press 1. To add it to your cart, press 2. To go back, press star." },
  product_default_desc: { group: "Browsing", label: "Description when an item has none", text: "The {item} is one of our most popular rentals. Kids love it!", vars: ["item"] },

  // Date & quantity
  date_prompt: { group: "Date & quantity", label: "Ask for the party date", text: "What day is your party? Just say the date, like November 8th. Or type the month and day on your keypad. For November 8th, that's 1, 1, 0, 8." },
  date_past: { group: "Date & quantity", label: "Date already passed", text: "Hmm, that date has already passed. Let's pick another one." },
  date_too_far: { group: "Date & quantity", label: "Date too far ahead", text: "We can book up to one year ahead. Let's pick a date a little sooner." },
  date_unclear: { group: "Date & quantity", label: "Didn't understand the date", text: "Sorry, I didn't quite get that date. Let's try that again." },
  date_confirm_day: { group: "Date & quantity", label: "Confirm the date (whole rental day, delivery and pickup times)", text: "Got it, {date}! We'll deliver that day between 9 AM and noon, and pick up on {pickup}. Please have the rental outside your door by 9 AM that morning. Press 1 if that's right, or 2 to pick a different date.", vars: ["date", "pickup"] },
  sold_out: { group: "Date & quantity", label: "Item booked up", text: "Oh no, the {item} is all booked up on {date}.", vars: ["item", "date"] },
  sold_out_options_cart: { group: "Date & quantity", label: "Booked-up options (has cart)", text: "To look at other rentals, press 1. To hear your cart, press 9. For the main menu, press star." },
  sold_out_options: { group: "Date & quantity", label: "Booked-up options (no cart)", text: "To try a different date, press 1. To look at other rentals, press 2. For the main menu, press star." },
  qty_prompt: { group: "Date & quantity", label: "Ask how many", text: "Good news, we have {count} available on {date}! How many would you like? Press a number from 1 to {max}.", vars: ["count", "date", "max"] },
  qty_invalid: { group: "Date & quantity", label: "Bad quantity", text: "Let's try that again. Please press a number from 1 to 9." },
  only_some_left: { group: "Date & quantity", label: "Fewer left than asked", text: "Oh, only {count} are left for that date.", vars: ["count"] },
  just_booked: { group: "Date & quantity", label: "Someone just booked it", text: "Oh no, someone just grabbed the last {item} for that date.", vars: ["item"] },

  // Cart
  added: { group: "Cart", label: "Item added to cart", text: "Woohoo! I added {items} to your cart for {date}. It's saved just for you while we're on the phone.", vars: ["items", "date"] },
  after_add: { group: "Cart", label: "After adding", text: "To keep shopping, press 1. To check out, press 9." },
  cart_empty: { group: "Cart", label: "Cart is empty", text: "Your cart is empty right now. Let's find something fun!" },
  cart_summary: { group: "Cart", label: "Cart summary", text: "Here's your cart: {items}, for {date}. Your rental total is {total}, plus delivery and sales tax.", vars: ["items", "date", "total"] },
  // Key 1 booking, several days on one call (Abraham, Nov 8, 2026). day_choice and cart_key are Abraham's exact lines.
  day_choice: { group: "Cart", label: "After an item: same day or another day (Abraham)", text: "For the same day, press 1. For another day, press 2." },
  cart_key: { group: "Cart", label: "Booking menus: go to the cart (Abraham)", text: "To go to your shopping cart, press 0." },
  cart_intro: { group: "Cart", label: "Cart: opening line", text: "Here's your cart." },
  cart_day: { group: "Cart", label: "Cart: one rental day", text: "For {date}: {items}.", vars: ["date", "items"] },
  cart_total: { group: "Cart", label: "Cart: rental total", text: "Your rental total is {total}, plus delivery and sales tax.", vars: ["total"] },
  cart_options: { group: "Cart", label: "Cart options", text: "To check out, press 1. To keep shopping, press 2. To start over with an empty cart, press 3." },
  cart_cleared: { group: "Cart", label: "Cart emptied", text: "All set, your cart is empty. Let's start fresh!" },
  cart_expired: { group: "Cart", label: "Cart timed out", text: "Sorry, your cart timed out. Let's start again." },

  // Checkout
  ask_name: { group: "Checkout", label: "Ask for name", text: "Awesome, let's get you booked! Please say your first and last name." },
  ask_address: { group: "Checkout", label: "Ask for address", text: "Thanks! Now please say the delivery address, with the house number, street, and town." },
  ask_email: { group: "Checkout", label: "Ask for email", text: "Almost done! Please say your email address for your receipt, like john at gmail dot com. Or press pound to skip." },
  // Call recording notice (Abraham O): PROPOSED wording, not approved yet; plays only if the Owner turns recording on.
  recording_notice: { group: "Welcome & main menu", label: "Call recording notice (proposed, plays only when recording is on)", text: "This call may be recorded for quality and training. Please don't share card numbers or security codes on this call." },
  // Keypad typing (Abraham L; proposed wording approved under P, Nov 8, 2026)
  type_hint: { group: "Checkout", label: "Typing: how to switch", text: "To type it on your keypad instead, press star." },
  type_instructions: { group: "Checkout", label: "Typing: how to type", text: "To type, press each key until you reach the letter: press 2 once for A, twice for B, three times for C, and the same for every key. To type two letters on the same key, press star once between them. For example, A then B is 2, star, 2 2. Press star twice for a space. Press pound when you're done." },
  type_email_symbols: { group: "Checkout", label: "Typing: email symbols", text: "For a dot, press 1 once. For the at sign, press 1 twice." },
  typed_back: { group: "Checkout", label: "Typing: read back", text: "You typed: {value}. If that's right, press 1. To try again, press 2.", vars: ["value"] },
  heard: { group: "Checkout", label: "Read back what we heard", text: "I heard: {value}. If that's right, press 1. To try again, press 2.", vars: ["value"] },
  field_unclear: { group: "Checkout", label: "Didn't catch it", text: "Sorry, I didn't catch that. No problem, let's try that again." },
  email_unclear: { group: "Checkout", label: "Didn't catch the email", text: "Sorry, I couldn't quite catch that email. Let's try that again." },
  email_skip: { group: "Checkout", label: "Skipping email", text: "No problem, we'll skip the email." },
  field_trouble: { group: "Checkout", label: "Having trouble hearing", text: "I'm having a little trouble hearing you." },
  phone_confirm: { group: "Checkout", label: "Confirm texting number", text: "We'll text your secure payment link to the number you're calling from, ending in {last4}. Press 1 to use this number, or 2 to enter a different one.", vars: ["last4"] },
  phone_enter: { group: "Checkout", label: "Type a cell number", text: "Sure thing! Please type your 10 digit cell phone number, starting with the area code." },
  phone_bad: { group: "Checkout", label: "Bad phone number", text: "Hmm, that doesn't look like a 10 digit number. Let's try again." },
  phone_heard: { group: "Checkout", label: "Read back phone number", text: "I have {number}. Press 1 if that's right, or 2 to type it again.", vars: ["number"] },
  thanks_order: { group: "Checkout", label: "Order placed", text: "You're all set, {name}! Your order number is {number}.", vars: ["name", "number"] },
  link_sent: { group: "Checkout", label: "Payment link texted", text: "We just texted you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay, and we'll text you as soon as it's confirmed.", vars: ["minutes"] },
  link_failed: { group: "Checkout", label: "Couldn't text the link", text: "We couldn't send the text, so someone from our team will call you back shortly to finish up." },
  goodbye_order_days: { group: "Checkout", label: "Goodbye after ordering several days", text: "We'll deliver and pick up on the days you chose. Thanks so much for choosing Hup Up Attractions. Have an amazing party, bye for now!" },
  goodbye_order: { group: "Checkout", label: "Goodbye after ordering", text: "We'll deliver on {date} and pick up on {pickup}. Thanks so much for choosing Hup Up Attractions. Have an amazing party, bye for now!", vars: ["date", "pickup"] },

  // Text message consent (A2P 10DLC). The exact text spoken is stored with every consent record.
  consent_transactional: {
    group: "Text message consent",
    label: "Ask for order and service texts (transactional)",
    textOnly: true,
    text: "Can Hup Up Attractions text you at this number about your reservation, order, payment, delivery, pickup, and customer service? By agreeing, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Message frequency varies. Message and data rates may apply. You can reply STOP to opt out, or HELP for help, at any time. Our text message terms and privacy policy are on our website. To agree, press 1 or say yes. If not, press 2 or say no.",
  },
  consent_marketing: {
    group: "Text message consent",
    label: "Ask for promotional texts (marketing)",
    textOnly: true,
    text: "One more question. Would you like to receive promotional text messages from Hup Up Attractions at this number? By agreeing, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. You can reply STOP to opt out, or HELP for help, at any time. To agree, press 1 or say yes. To skip, press 2 or say no.",
  },
  consent_marketing_v2: {
    group: "Text message consent",
    label: "Ask for promotional texts, written consent (SMS Terms v2, preview only)",
    textOnly: true,
    text: "One more question. Would you like promotional text messages from Hup Up Attractions at this number, such as discounts, special offers, and catalog updates? If you say yes, we'll text you a confirmation, and you'll be signed up only after you reply YES to that text. By agreeing, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. You can reply STOP to opt out, or HELP for help, at any time. To get the confirmation text, press 1 or say yes. To skip, press 2 or say no.",
  },
  consent_marketing_sent: {
    group: "Text message consent",
    label: "Promotional confirmation text sent (SMS Terms v2, preview only)",
    text: "Thank you. We just texted you a confirmation. Reply YES to that text within 24 hours to sign up for promotional texts.",
  },
  consent_unclear: { group: "Text message consent", label: "Didn't understand the answer", text: "Sorry, I didn't get that. Please press 1 for yes, or 2 for no." },
  consent_stopped: { group: "Text message consent", label: "Number replied STOP before", text: "This number has opted out of our text messages, so we won't text you. To get our texts again, text the word START to this hotline number." },
  consent_marketing_yes: { group: "Text message consent", label: "Signed up for promotional texts", text: "Thank you, you're signed up for promotional texts. We just texted you a confirmation." },
  consent_marketing_no: { group: "Text message consent", label: "Said no to promotional texts", text: "No problem, you won't get promotional texts." },
  tz_ask: { group: "Text message consent", label: "Ask the caller's time zone (after a promotional yes)", text: "Last question, so we only send promotional texts at reasonable hours. Are you in the Eastern time zone, the same as New York? Press 1 for yes, or 2 for a different time zone." },
  tz_pick: { group: "Text message consent", label: "Pick a different time zone", text: "For Central time, press 1. Mountain, press 2. Arizona, press 3. Pacific, press 4. Alaska, press 5. Hawaii, press 6. To skip, press 0." },
  tz_saved: { group: "Text message consent", label: "Time zone saved", text: "Got it, thank you." },
  late_cholhamoed: { group: "Welcome & main menu", label: "Chol Hamoed, while open (Abraham approved)", text: "Happy Chol Hamoed! We're open late today, and you can book anytime using this automated system." },
  late_chanukah: { group: "Welcome & main menu", label: "Chanukah, while open (Abraham approved)", text: "Happy Chanukah! We're open late today, and you can book anytime using this automated system." },
  office_closed: { group: "Welcome & main menu", label: "Office closed (booking still available)", text: "Our office is closed right now, but you can book anytime using this automated system." },
  date_closed: { group: "Date & quantity", label: "Chosen date is a closed day", text: "Sorry, we're closed on {date} for {reason}. Let's pick another date.", vars: ["date", "reason"] },
  address_outside_area: { group: "Checkout", label: "Address outside the delivery area", text: "Sorry, we only deliver in Kiryas Joel and nearby Orange County towns. Please say a delivery address in our area." },
  checkout_total: { group: "Checkout", label: "Order total read-back", text: "Your total is {total}. That's {items} for the rentals, {delivery} for delivery, and {tax} sales tax.", vars: ["total", "items", "delivery", "tax"] },
  terms_notice: {
    group: "Checkout",
    label: "Terms notice (press #)",
    textOnly: true,
    text: "By pressing #, you agree to our Terms and Conditions. To review them, go to hupupattractions.com/terms. To get the link by text message, press 1. To continue, press #.",
  },
  terms_link_sent: { group: "Checkout", label: "Terms link texted", text: "We just texted you the link to our Terms and Conditions." },
  terms_link_no_text: { group: "Checkout", label: "Can't text the Terms link (no text consent)", text: "We can't text you, because you didn't agree to text messages, but you can read our Terms at hupupattractions.com/terms." },
  terms_required: { group: "Checkout", label: "Terms not accepted", text: "To finish your booking, you need to accept our Terms and Conditions. Please call us back anytime. Goodbye!" },
  link_emailed: { group: "Checkout", label: "Payment link emailed (no texts)", text: "No problem, we won't text you. We just emailed you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay.", vars: ["minutes"] },
  link_call_back: { group: "Checkout", label: "No texts and no email", text: "No problem, we won't text you. Someone from our team will call you shortly to finish your payment." },

  // Talk to a person
  transfer_connecting: { group: "Talk to a person", label: "Connecting", text: "Sure thing! Hang tight while I connect you to our team." },
  // Abraham's own wording (same line for both), followed straight by the voicemail beep
  transfer_failed: { group: "Talk to a person", label: "No one answered (then voicemail)", text: "Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!" },
  operator_unavailable: { group: "Talk to a person", label: "No one available (then voicemail)", text: "Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!" },

  // Voicemail (Main box)
  menu_voicemail: { group: "Voicemail", label: "Menu option when the office is closed: leave a message", text: "To leave us a message, press 0." },
  voicemail_offer: { group: "Voicemail", label: "Offer after no one answered", text: "To leave a message, press 1. To keep booking, press star." },
  voicemail_prompt: { group: "Voicemail", label: "Before the beep (unless the box has its own greeting)", text: "Please leave your name, phone number, and a short message after the beep. Press pound when you're done." },
  voicemail_thanks: { group: "Voicemail", label: "After the message", text: "Thanks! We got your message and will call you back soon. Bye for now!" },
  voicemail_none: { group: "Voicemail", label: "Caller didn't leave a message", text: "We didn't get a message. Please call back anytime. Bye for now!" },
} satisfies Record<string, PromptDef>;

export type PromptKey = keyof typeof PROMPTS;
export type PromptOverrides = Partial<Record<PromptKey, { text: string | null; audioUrl: string | null }>>;

export async function loadPromptOverrides(): Promise<PromptOverrides> {
  try {
    const rows = await db.select().from(schema.voicePrompts);
    const out: PromptOverrides = {};
    for (const r of rows) {
      if (r.key in PROMPTS) out[r.key as PromptKey] = { text: r.text, audioUrl: r.audioUrl };
    }
    return out;
  } catch (e) {
    console.error("Could not load prompt overrides, using defaults", e);
    return {};
  }
}

export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Text for a prompt key: admin override if set, else default. */
export function promptText(overrides: PromptOverrides, key: PromptKey, vars?: Record<string, string | number>) {
  const t = overrides[key]?.text?.trim();
  return fill(t || PROMPTS[key].text, vars);
}

/** Recorded audio for a prompt (only used when the prompt has no placeholders). */
export function promptAudio(overrides: PromptOverrides, key: PromptKey): string | null {
  const def = PROMPTS[key] as PromptDef;
  if (def.vars?.length || def.textOnly) return null;
  return overrides[key]?.audioUrl || null;
}

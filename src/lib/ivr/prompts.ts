import { promptRecordingLink } from "@/lib/signed-link";
import { and, desc, eq } from "drizzle-orm";
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
  /** Wording not yet approved by Abraham: shows "Waiting for approval" in Admin and never plays on the phone line. */
  pending?: boolean;
  /** A text or email the phone system sends (not spoken): longer, can have new lines, no recording. */
  message?: boolean;
};

export const PROMPTS = {
  // Welcome & main menu
  // Abraham's exact main menu (greeting, then one line per key, with a 0.75-second pause after each)
  // Main menu (Abraham, Nov 11, 2026), approved word for word. Half-second pauses between the greeting lines.
  main_hi: { group: "Welcome & main menu", label: "Greeting, line 1 (Abraham)", text: "Hi! Thank you for calling Hup Up Attractions!" },
  main_slogan: { group: "Welcome & main menu", label: "Greeting, line 2 (Abraham)", text: "Bringing something special to every occasion!" },
  main_any_time: { group: "Welcome & main menu", label: "Greeting, line 3 (Abraham)", text: "If you know your desired extension, you may press it at any time." },
  main_catalog: { group: "Welcome & main menu", label: "Main menu key 8, catalog (Abraham; said twice)", text: "To receive our catalog by text or email, press 8." },
  main_book: { group: "Welcome & main menu", label: "Main menu key 1 (Abraham)", text: "For reservations and bookings, press 1." },
  main_equipment: { group: "Welcome & main menu", label: "Main menu key 2 (Abraham)", text: "For instructions and guidance on using our rental equipment, press 2." },
  main_service_3: { group: "Welcome & main menu", label: "Main menu key 3 (Abraham)", text: "For customer service and general inquiries, press 3." },
  main_learn_4: { group: "Welcome & main menu", label: "Main menu key 4 (Abraham)", text: "To learn more about our rental attractions and the services we offer, press 4." },
  main_rental_help: { group: "Welcome & main menu", label: "Main menu key 5 (Abraham)", text: "For questions or assistance with any issues during your rental, press 5." },
  main_6: { group: "Welcome & main menu", label: "Main menu key 6 (Abraham)", text: "For delivery and pickup information, press 6." },
  main_hours: { group: "Welcome & main menu", label: "Main menu key 7 (Abraham)", text: "To hear our hours of operation, press 7." },
  main_9: { group: "Welcome & main menu", label: "Main menu key 9 (Abraham, Phone Menu v3)", text: "For feedback and comments, press 9." },
  main_star_again: { group: "Welcome & main menu", label: "Main menu: hear it again (Abraham)", text: "To hear this menu again, press the star key." },
  main_thanks: { group: "Welcome & main menu", label: "Main menu: closing line (Abraham, Phone Menu v3)", text: "Thank you for choosing Hup Up Attractions." },
  main_0: { group: "Welcome & main menu", label: "Main menu key 0 (Abraham)", text: "To speak with an operator, press 0." },
  // Bookings menu after pressing 1 (Abraham, Nov 11, 2026), approved word for word; categories come from Admin.
  book_note: { group: "Booking by item (key 1)", label: "Bookings menu: first line (Abraham)", text: "Please note, orders can be placed only through our automated system. For information or questions, press 0 for customer service." },
  book_corporate: { group: "Booking by item (key 1)", label: "Bookings menu key 9 (Abraham)", text: "For schools, corporate events, and organizational bookings, press 9." },
  book_back: { group: "Booking by item (key 1)", label: "Bookings menu: go back (Abraham)", text: "To go back, press star." },
  not_valid: { group: "Welcome & main menu", label: "Any menu: a key that is not a choice (Abraham)", text: "Sorry, that is not a valid selection. Please try again." },
  // Main menu key 2 (Abraham W): instructions for each type of attraction. Editable here like every other prompt.
  attraction_choice: { group: "Key 2: Instructions", label: "Which attraction (keys 2 and 3, Abraham)", text: "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3." },
  instr_menu: { group: "Key 2: Instructions", label: "Key 2 menu (Abraham, Phone Menu v3)", text: "For jumping balloon instructions, press 1. For laser tag, press 2. For paddle boats, press 3. To go back, press star." },
  attraction_menu_back: { group: "Key 2: Instructions", label: "Which attraction: star for the main menu", text: "To go back to the main menu, press the star key." },
  instr_intro: { group: "Key 2: Instructions", label: "Key 2 opening line", text: "We're happy to help you get the most out of your rental." },
  instr_balloons: {
    group: "Key 2: Instructions",
    pending: true, // Abraham (Phone Menu v3): his scripts are coming
    label: "Instructions: jumping balloons",
    text: "Here's how to enjoy your jumping balloon safely. Setup: our team sets it up on a flat, open area, away from trees, fences, power lines and anything sharp. Keep the blower running and its cord and air tube clear the whole time it's in use. Safe use: everyone takes off their shoes, glasses and anything in their pockets. No food, drinks, gum, silly string or sharp toys inside. Keep big and small children apart, and don't overcrowd it. No flips, wrestling or climbing on the walls. Supervision: a responsible adult must watch the jumping balloon at all times while it's in use. Please follow the age and rider limits printed on the unit. Weather: if the wind picks up, if it rains, or if you hear thunder, have everyone get out right away and unplug the blower. Getting ready for pickup: make sure everyone is out, unplug the blower, remove any toys or trash, and leave the unit where it is. We'll take care of folding it. Thank you!",
  },
  instr_laser: {
    group: "Key 2: Instructions",
    pending: true, // Abraham (Phone Menu v3): his scripts are coming
    label: "Instructions: laser tag",
    text: "Here's how to enjoy your laser tag safely. Setup: our team sets up the maze and gets the blasters and vests ready. Keep the blower running and its cord clear, and charge the equipment as our team shows you. Safe use: players walk, never run, inside the maze, and no shoes inside the inflatable. Never point the blasters at anyone's eyes up close, and keep vests fastened. No food or drinks inside. Supervision: a responsible adult must supervise the game at all times. Laser tag is best for children around age six and up, and teens and adults love it too. Weather: if it gets windy, starts to rain, or you hear thunder, stop the game, have everyone get out, and unplug the blower. Bring the blasters and vests inside, out of the rain. Getting ready for pickup: collect every blaster and vest, count them, and put them back in their bins. Make sure the maze is empty and unplugged. We'll take care of the rest. Thank you!",
  },
  instr_paddle: {
    group: "Key 2: Instructions",
    pending: true, // Abraham (Phone Menu v3): his scripts are coming
    label: "Instructions: paddle boats",
    text: "Here's how to enjoy your paddle boats safely. Setup: our team places the boats in the pool or water area and shows you how they work. Safe use: one rider per boat, unless the boat says otherwise. Riders stay seated, keep their hands and feet inside, and never stand up or bump boats hard. Children who can't swim should wear a life jacket. Supervision: a responsible adult must watch the water at all times while the boats are in use, and stay close enough to reach a child right away. Please follow the age and weight limits on each boat. Weather: if it gets windy, starts to rain, or you hear thunder, have everyone get out of the water right away. Getting ready for pickup: take the boats out of the water if you can, line them up in one place, and remove any toys or trash. We'll take care of the rest. Thank you!",
  },
  attraction_after: { group: "Key 2: Instructions", label: "After instructions or a description: options (keys 2 and 3)", text: "To hear this again, press the star key. To choose another attraction, press 1. To go back to the main menu, press 2." },
  // Main menu key 3 (Abraham W): a description of each type; the items list comes from Admin, so it always matches the website.
  learn_intro: { group: "Key 4: Learn about our rentals", label: "Key 3 opening line", text: "We'd love to tell you about our rentals." },
  learn_balloons: {
    group: "Key 4: Learn about our rentals",
    label: "About jumping balloons",
    text: "Our jumping balloons are inflatable bounce houses, and many come with slides or play areas. They're a favorite for birthday parties, family simchas, school events and community celebrations, with options for toddlers and for older kids. Jumping balloons are mostly set up outdoors on grass or a flat, open area. Some smaller units can go indoors in a large room with a high ceiling. Each unit needs open space around it and a nearby power outlet for the blower.",
  },
  learn_laser: {
    group: "Key 4: Learn about our rentals",
    label: "About laser tag",
    text: "Our laser tag comes with blasters and vests, and our inflatable mazes make the game even more exciting. It's a hit with kids around age six and up, teens, and adults, and it's great for parties, schools, camps and group events. Laser tag can be played outdoors, or indoors in a large hall or gym. The maze needs a good amount of open space and a power outlet for the blower.",
  },
  learn_paddle: {
    group: "Key 4: Learn about our rentals",
    label: "About paddle boats",
    text: "Our paddle boats are small, easy-to-steer boats that kids pedal or paddle around the water. They're a fun, special attraction for summer parties, camps and outdoor events. Paddle boats are used outdoors, in a pool or a calm water area with an adult watching. You can rent as many as you need for your space.",
  },
  learn_items: { group: "Key 4: Learn about our rentals", label: "Our items in this category (from Admin)", text: "Our {category} include: {items}.", vars: ["category", "items"] },
  learn_deliver: { group: "Key 4: Learn about our rentals", label: "We deliver (key 3)", text: "We deliver, set up, and pick up, so you can relax and enjoy your event. To book, go back to the main menu and press 1." },
  learn_none: { group: "Key 4: Learn about our rentals", label: "No items in this category right now", text: "We're updating this part of our catalog right now. Please check back with us soon." },
  menu_category: { group: "Welcome & main menu", label: "Menu option for a category", text: "For {category}, press {key}.", vars: ["category", "key"] },
  menu_cart: { group: "Welcome & main menu", label: "Menu option: review cart", text: "Ready to check out? Press 9 to hear your cart." },
  menu_operator: { group: "Welcome & main menu", label: "Menu option: talk to a person", text: "To talk with someone from our team, press 0." },
  menu_speech: { group: "Welcome & main menu", label: "Menu: you can also speak", text: "Or just tell me what you're looking for." },
  menu_repeat: { group: "Welcome & main menu", label: "Menu option: repeat", text: "To hear this again, press star." },
  menu_empty: { group: "Welcome & main menu", label: "No rentals set up yet", text: "We're getting our rentals ready right now. Please call back soon!" },

  // Errors & retries
  idle_warning: { group: "Errors & retries", label: "Inside a booking: 9 minutes with no key (Abraham)", text: "Are you still there? Please press any key to continue. Otherwise, this call will end in one minute." },
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

  // Booking by item (Abraham, Nov 9, 2026): category, item, date; if booked, the nearest options
  book_intro: { group: "Booking by item (key 1)", label: "Before the categories", text: "Let's find the right rental for your event." },
  book_category_list: { group: "Booking by item (key 1)", label: "Before the items in a category", text: "Here are our {category}.", vars: ["category"] },
  book_date_prompt: { group: "Booking by item (key 1)", label: "Ask for the event date (keypad)", text: "Please enter your event date: two digits for the month, then two digits for the day. For example, for March 5th, press 0, 3, 0, 5." },
  book_date_entered: { group: "Booking by item (key 1)", label: "Confirm the date", text: "You entered {date}. If that's correct, press 1. To enter a different date, press 2.", vars: ["date"] },
  booked_intro: { group: "Booking by item (key 1)", label: "Item booked that day", text: "I'm sorry, the {item} is already booked on {date}.", vars: ["item", "date"] },
  booked_closest: { group: "Booking by item (key 1)", label: "Closest options intro", text: "Here are the closest options for that day." },
  booked_bigger: { group: "Booking by item (key 1)", label: "Next size up", text: "For the next size up, the {item}, press 1.", vars: ["item"] },
  booked_smaller: { group: "Booking by item (key 1)", label: "Next size down", text: "For the next size down, the {item}, press 2.", vars: ["item"] },
  booked_keep: { group: "Booking by item (key 1)", label: "Keep the item, choose another date", text: "To keep the {item} and choose a different date, press 3.", vars: ["item"] },
  altdate_before: { group: "Booking by item (key 1)", label: "Available the day before", text: "The {item} is available on {date}, the day before. To choose that day, press 1.", vars: ["item", "date"] },
  altdate_after_also: { group: "Booking by item (key 1)", label: "Also available the day after", text: "It's also available on {date}, the day after. To choose that day, press 2.", vars: ["date"] },
  altdate_after: { group: "Booking by item (key 1)", label: "Available the day after (only)", text: "The {item} is available on {date}, the day after. To choose that day, press 2.", vars: ["item", "date"] },
  altdate_not_near: { group: "Booking by item (key 1)", label: "Not available the day before or after", text: "The {item} isn't available the day before or after.", vars: ["item"] },
  altdate_nearest_before: { group: "Booking by item (key 1)", label: "Nearest date before", text: "The nearest date before your date is {date}. To choose it, press 1.", vars: ["date"] },
  altdate_nearest_after: { group: "Booking by item (key 1)", label: "Nearest date after", text: "The nearest date after your date is {date}. To choose it, press 2.", vars: ["date"] },
  altdate_other: { group: "Booking by item (key 1)", label: "Try a different date", text: "To try a different date, press 3." },

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
  cart_empty: { group: "Cart", label: "Cart is empty (Abraham, Phone Menu v3)", text: "Your cart is empty. Let's start shopping!" },
  bounce_water_note: { group: "Cart", label: "Before a bounce house is added (Abraham, Phone Menu v3)", text: "Please note, our bounce houses are not for water use." },
  checkout_tax_note: { group: "Cart", label: "Before checkout (Abraham, Phone Menu v3)", text: "Taxes will be calculated after checkout." },
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
  link_sent: { group: "Checkout", label: "Payment link texted (Abraham, Nov 13, 2026)", text: "We just texted you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay. After that, they go back into stock, and you'll need to book them again.", vars: ["minutes"] },
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
    label: "Ask for promotional texts, long version (no longer played; replaced by the keys-only steps)",
    textOnly: true,
    text: "One more question. Would you like promotional text messages from Hup Up Attractions at this number: seasonal offers, discount codes, and rental deals, up to 5 per calendar year? If you say yes, we'll text you a confirmation, and you'll be signed up only after you reply YES to that text within 24 hours. Agreeing is never required to book or buy. Message and data rates may apply. You can reply NOPROMO to stop promos, STOP to stop all texts, or HELP for help, at any time. To get the confirmation text, press 1 or say yes. To skip, press 2 or say no.",
  },
  consent_marketing_sent: {
    group: "Text message consent",
    label: "Promotional confirmation text sent (SMS v3)",
    text: "Thank you. We just texted you a confirmation. Reply YES to that text within 24 hours to sign up for promotional texts.",
  },
  // Promo texts by phone, keys only (Abraham, Nov 10, 2026): replaces consent_marketing_v2, which is no longer played.
  promo_ask: { group: "Promo texts by phone (keys only)", label: "Step 1: after the order", text: "To get seasonal offers, discounts, and deals by text, up to 5 a year, press 1. To skip, press pound." },
  promo_which: { group: "Promo texts by phone (keys only)", label: "Step 2: which number", text: "To get texts at the number you're calling from, press 1. To use a different phone number, press 2." },
  promo_enter: { group: "Promo texts by phone (keys only)", label: "Step 3: enter a number", text: "Please enter the 10-digit mobile number, then press pound." },
  promo_heard: { group: "Promo texts by phone (keys only)", label: "Step 3: read the number back", text: "You entered {number}. To confirm, press 1. To enter it again, press 2.", vars: ["number"] },
  promo_bad: { group: "Promo texts by phone (keys only)", label: "Step 3: not 10 digits", text: "Sorry, that number didn't work. Please try again." },
  promo_final: { group: "Promo texts by phone (keys only)", label: "Final line", text: "Thanks! We just sent a text. Reply YES within 24 hours to finish signing up." },
  promo_disclosure: { group: "Promo texts by phone (keys only)", label: "Disclosure line (right after the Final line)", text: "Message and data rates may apply, and you're signed up only after you reply YES to our confirmation text." },
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
  link_emailed: { group: "Checkout", label: "Payment link emailed (caller said no to texts; Abraham, Nov 13, 2026)", text: "No problem, we won't text you. We just emailed you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay. After that, they go back into stock, and you'll need to book them again.", vars: ["minutes"] },
  link_emailed_consented: {
    group: "Checkout",
    label: "Payment link emailed (caller agreed to texts, texting not live yet). Approved by Abraham, Nov 12, 2026",
    text: "We just emailed you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay. After that, they go back into stock, and you'll need to book them again.",
    vars: ["minutes"],
  },
  // Pay by keypad through Stripe (Abraham, Nov 12, 2026). Wording approved Nov 13, 2026; still owner test only.
  pay_start: { group: "Pay by keypad", label: "Before the card steps", text: "Let's take care of your payment now. Please have your card ready." },
  pay_card_number: { group: "Pay by keypad", label: "Card number", text: "Please enter your card number on your keypad, then press pound." },
  pay_expiration: { group: "Pay by keypad", label: "Expiration date", text: "Please enter the expiration date, two digits for the month and two digits for the year, then press pound." },
  pay_security_code: { group: "Pay by keypad", label: "Security code", text: "Please enter the security code on your card, then press pound." },
  pay_postal_code: { group: "Pay by keypad", label: "Billing ZIP code", text: "Please enter the billing ZIP code for your card, then press pound." },
  pay_processing: { group: "Pay by keypad", label: "While the payment goes through", text: "One moment while we process your payment." },
  pay_success: { group: "Pay by keypad", label: "Payment approved (Abraham)", text: "Payment received, thank you!" },
  pay_declined: { group: "Pay by keypad", label: "Card declined: try again or link", text: "Sorry, that card didn't go through. To try again, press 1. To get a secure payment link by email instead, press 2." },
  link_call_back: { group: "Checkout", label: "No texts and no email", text: "No problem, we won't text you. Someone from our team will call you shortly to finish your payment." },

  // Talk to a person
  transfer_connecting: { group: "Talk to a person", label: "Connecting", text: "Sure thing! Hang tight while I connect you to our team." },
  // Abraham's own wording (same line for both), followed straight by the voicemail beep
  transfer_failed: { group: "Talk to a person", label: "No one answered (then voicemail)", text: "Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!" },
  operator_unavailable: { group: "Talk to a person", label: "No one available (then voicemail)", text: "Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!" },

  // Voicemail (Main box)
  menu_voicemail: { group: "Voicemail", label: "Menu option when the office is closed: leave a message", text: "To leave us a message, press 0." },
  voicemail_offer: { group: "Voicemail", label: "Offer after no one answered", text: "To leave a message, press 1. To keep booking, press star." },
  // Abraham, Nov 11, 2026, approved word for word, every voicemail box (main and each extension).
  vm_greeting: {
    group: "Voicemail",
    label: "Greeting while the office is open (every box except key 9)",
    text: "We apologize that we are unable to answer your call. Our team is assisting other customers right now. Please feel free to leave a message after the tone and we will get back to you as soon as possible. When you are finished, you may hang up or press the pound key.",
  },
  // Staff voicemail access by phone (Abraham, Nov 13, 2026): drafts, hidden (7 then 4 during a greeting), preview only.
  vma_pin: { group: "Voicemail", label: "Staff access: ask for the voicemail PIN", text: "Please enter your voicemail PIN, then press pound.", pending: true },
  vma_wrong: { group: "Voicemail", label: "Staff access: wrong PIN", text: "Sorry, that PIN isn't right. Please try again.", pending: true },
  vma_locked: { group: "Voicemail", label: "Staff access: locked", text: "Voicemail access is locked for now. Please try again later. Goodbye.", pending: true },
  vma_box: { group: "Voicemail", label: "Staff access: choose a box", text: "Please enter the extension number of the voicemail box, or press 0 for the main box.", pending: true },
  vma_count: { group: "Voicemail", label: "Staff access: how many messages", text: "You have {count} messages, newest first.", vars: ["count"], pending: true },
  vma_none: { group: "Voicemail", label: "Staff access: empty box", text: "There are no messages in this box.", pending: true },
  vma_message: { group: "Voicemail", label: "Staff access: before each message", text: "Message {n}, from {number}, on {date} at {time}.", vars: ["n", "number", "date", "time"], pending: true },
  vma_options: { group: "Voicemail", label: "Staff access: after each message", text: "To replay this message, press 1. For the next message, press 2. To mark it as heard, press 3. To call this person back, press 4. To choose another box, press star.", pending: true },
  vma_heard: { group: "Voicemail", label: "Staff access: marked as heard", text: "Marked as heard.", pending: true },
  vma_end: { group: "Voicemail", label: "Staff access: no more messages", text: "That was the last message. To choose another box, press star, or hang up.", pending: true },
  vma_calling: { group: "Voicemail", label: "Staff access: calling back", text: "Calling them back now.", pending: true },
  vma_no_number: { group: "Voicemail", label: "Staff access: no number to call", text: "Sorry, there's no number we can call back for this message.", pending: true },
  // Key 9 (Abraham, Nov 11, 2026, word for word): feedback and comments only.
  // Key 8 catalog (Abraham, Phone Menu v3), approved word for word.
  catalog_menu: { group: "Catalog (key 8)", label: "Text or email", text: "To receive our catalog by text, press 1. To get it by email, press 2. To go back, press star." },
  catalog_text_which: { group: "Catalog (key 8)", label: "Text: which number", text: "We'll text it to the number you're calling from. To use this number, press 1. To enter a different number, press 2." },
  catalog_text_enter: { group: "Catalog (key 8)", label: "Text: enter a number", text: "Please enter the 10-digit phone number, then press pound." },
  catalog_text_heard: { group: "Catalog (key 8)", label: "Text: read the number back", text: "I have {number}. If that's correct, press 1. To try again, press 2.", vars: ["number"] },
  catalog_texted: { group: "Catalog (key 8)", label: "Text: done", text: "Done! We just texted you our catalog. Thank you for choosing Hup Up Attractions!" },
  catalog_text_not_yet: { group: "Catalog (key 8)", label: "Text: not available yet", text: "Sorry, we can't send it by text just yet. Let's send it by email instead." },
  catalog_email_info: { group: "Catalog (key 8)", label: "Email: send us an empty email (plays once the info@ auto-reply is on)", text: "You can also send us an empty email to info at hup up attractions dot com, with the subject Catalog, and we'll send it right back to you." },
  catalog_email_local: { group: "Catalog (key 8)", label: "Email step 1: the first part", text: "Please enter the first part of your email address, up to the at symbol. To type it, start pressing keys on your keypad now. To say it, wait for the tone, then say it letter by letter. When you're finished, press pound." },
  catalog_keypad_help: { group: "Catalog (key 8)", label: "Email: keypad directions (when the caller starts typing)", text: "To type, press each key once, twice, or three times for its letter. For example, press 2 once for A, twice for B, or three times for C. To type another letter on the same key, press star once first. To erase the last letter, press star twice. To go back, press star three times. For a dot, press 1 once. For an underscore, press 1 twice. For a dash, press 1 three times. To switch between letters and numbers, press 0. When you're finished, press pound." },
  catalog_got: { group: "Catalog (key 8)", label: "Email: read back what we got", text: "We got {letters}. To continue, press pound. To start over, press 1. To add more, press 2.", vars: ["letters"] },
  catalog_ending: { group: "Catalog (key 8)", label: "Email: choose the ending", text: "Now choose the ending. For at gmail dot com, press 1. For at outlook dot com, press 2. For at yahoo dot com, press 3. For at icloud dot com, press 4. For a different ending, press 5." },
  catalog_domain: { group: "Catalog (key 8)", label: "Email: a different ending", text: "Please give us the ending, after the at symbol. To type it, start pressing keys now. To say it, wait for the tone. When you're finished, press pound." },
  catalog_final: { group: "Catalog (key 8)", label: "Email: final check", text: "Your email address is {email}. If that's correct, press 1. To start over, press 2.", vars: ["email"] },
  catalog_emailed: { group: "Catalog (key 8)", label: "Email: done", text: "We just emailed you our catalog! Check your inbox for a variety of attractions and endless fun for your entire family. Thank you for choosing Hup Up Attractions! To hear the main menu, press star. Otherwise, you may hang up." },
  vm9_greeting: {
    group: "Voicemail",
    label: "Key 9 greeting (general voicemail: feedback and comments)",
    text: "Thank you for your time. We want to hear from you, your feedback helps us improve our service. Please share your comments after the tone. If you would like a callback, please say your name and phone number. When you're finished, you may hang up or press the pound key.",
  },
  vm9_sent: { group: "Voicemail", label: "Key 9 message sent (after pressing 1)", text: "Thank you for your feedback! We truly appreciate it. Goodbye!" },
  vm_options: {
    group: "Voicemail",
    label: "Options after the caller presses #",
    text: "Thank you!\nTo send your message, press 1.\nTo listen to it, press 2.\nTo delete and re-record, press 3.",
  },
  vm_after_hours: {
    group: "Voicemail",
    label: "After-hours greeting (approved by Abraham, Nov 13, 2026)",
    text: "Thank you for calling Hup Up Attractions! Our office is closed right now. Please leave your name, phone number, and a short message after the tone, and we'll call you back as soon as we open. To see our rentals anytime, visit hupupattractions.com. Have a wonderful day!",
  },
  vm_rerecord: { group: "Voicemail", label: "Before the tone when re-recording (press 3)", text: "Please re-record your message. When you're finished, press pound." },
  vm_none_retry: { group: "Voicemail", label: "Nothing was recorded (Abraham)", text: "We didn't receive a message. To try again, press 3. Otherwise, you may hang up." },
  vm_closed: {
    group: "Voicemail",
    label: "Greeting when the office is closed (every box except key 9; same hours as the website and key 7)",
    text: "Thank you for calling Hup Up Attractions. Our office is closed right now. Please leave a message after the tone and we will get back to you as soon as possible. When you are finished, you may hang up or press the pound key.",
  },
  vm_sent: { group: "Voicemail", label: "Message sent (after pressing 1)", text: "Thank you! Your message has been sent. We will get back to you as soon as possible. Goodbye!" },
  voicemail_prompt: { group: "Voicemail", label: "Before the beep (no longer played; replaced by the Greeting)", text: "Please leave your name, phone number, and a short message after the beep. Press pound when you're done." },
  voicemail_thanks: { group: "Voicemail", label: "After the message (no longer played; replaced by Message sent)", text: "Thanks! We got your message and will call you back soon. Bye for now!" },
  voicemail_none: { group: "Voicemail", label: "Caller didn't leave a message", text: "We didn't get a message. Please call back anytime. Bye for now!" },

  // Spoken answers typed up and read back (Abraham approved the wording Nov 13, 2026; not active until he approves
  // speech to text and its price)
  spoken_readback: {
    group: "Checkout",
    label: "Read back a spoken answer (speech to text, Google voice)",
    text: "We got {text}. If that's correct, press 1. To say it again, press 2.",
    vars: ["text"],
    pending: true, // Abraham, Nov 13, 2026: still a draft; plays only in the preview test of speech to text
  },

  // Staff announcement when a staff phone answers (Abraham). Each extension can still have its own in Phone settings.
  staff_whisper: { group: "Ringing staff", label: "Staff hear when they answer (extensions with a number)", text: "Call from Hup Up Attractions, extension {number}, {name}. Press 1 to accept, or press 2 to reject.", vars: ["number", "name"] },
  staff_whisper_no_number: { group: "Ringing staff", label: "Staff hear when they answer (Schools and Corporate, no extension number)", text: "Call from Hup Up Attractions, {name} extension. Press 1 to accept, or press 2 to reject.", vars: ["name"] },

  // Texts and emails the phone system sends (Abraham, Nov 13, 2026: every word on this page)
  msg_catalog_text: { group: "Texts and emails", message: true, label: "Catalog by text (key 8 and texting CATALOG)", text: "Hup Up Attractions: Here is our catalog: hupupattractions.com/#rentals To book, call (845) 777-7585." },
  msg_catalog_email_subject: { group: "Texts and emails", message: true, label: "Catalog email: subject (key 8 and info@ Catalog)", text: "Hup Up Attractions catalog" },
  msg_catalog_email_top: { group: "Texts and emails", message: true, label: "Catalog email: before the list of rentals", text: "Thank you for your interest in Hup Up Attractions!\n\nHere is our catalog:" },
  msg_catalog_email_bottom: { group: "Texts and emails", message: true, label: "Catalog email: after the list of rentals", text: "See our rentals: hupupattractions.com/#rentals\nTo book, call (845) 777-7585." },
  msg_payment_link_subject: { group: "Texts and emails", message: true, label: "Payment link email: subject", text: "Hup Up Attractions order #{number}", vars: ["number"] },
  msg_payment_link: { group: "Texts and emails", message: true, label: "Payment link (text and email) after a phone order", text: "Hup Up Attractions order #{number}: {items}. Rentals ${rentals} + delivery ${delivery} + sales tax ${tax} = total ${total}. Pay securely within {minutes} minutes to confirm: {link}", vars: ["number", "items", "rentals", "delivery", "tax", "total", "minutes", "link"] },
  msg_receipt_subject: { group: "Texts and emails", message: true, label: "Receipt email after a phone payment: subject", text: "Hup Up Attractions receipt for order #{number}", vars: ["number"] },
  msg_receipt_body: { group: "Texts and emails", message: true, label: "Receipt email after a phone payment", text: "{greeting}\n\nThank you for your payment! Here is your receipt.\n\nOrder number: {number}\nPaid on: {paid_on}\nAmount: ${amount}\nCard: ending in {last4}\n\nYour rentals are booked. If you have any questions, call us at (845) 777-7585 or reply to this email.\n\nHup Up Attractions\nhupupattractions.com", vars: ["greeting", "number", "paid_on", "amount", "last4"] },
  msg_payment_received: { group: "Texts and emails", message: true, label: "Payment received (one rental day; text, and email for website payments)", text: "Hup Up Attractions: payment received for order #{number}. You're all set for {date}! We'll deliver that day and pick up {pickup}.", vars: ["number", "date", "pickup"] },
  msg_payment_received_days: { group: "Texts and emails", message: true, label: "Payment received (several rental days)", text: "Hup Up Attractions: payment received for order #{number}. You're all set for {dates}! We'll deliver and pick up on the days you chose.", vars: ["number", "dates"] },
  msg_terms_link: { group: "Texts and emails", message: true, label: "Terms and Conditions link by text (during checkout)", text: "Hup Up Attractions Terms and Conditions: {link}", vars: ["link"] },
} satisfies Record<string, PromptDef>;

/** Old lines no longer played anywhere (kept so nothing is lost; shown as "Not used"). */
export const RETIRED_PROMPTS = new Set<string>(["instr_intro", "menu_cart", "menu_operator", "menu_speech", "menu_repeat", "category_intro", "back_to_menu", "book_intro", "date_prompt", "date_confirm_day", "sold_out", "sold_out_options_cart", "sold_out_options", "after_add", "cart_summary", "consent_marketing_sent", "consent_marketing_yes", "consent_marketing_no", "transfer_failed", "menu_voicemail", "voicemail_offer", "voicemail_prompt", "voicemail_thanks", "voicemail_none"]);

/** The extension (or part of the call) each group of lines belongs to, for the Admin filter. New groups fall into "Other". */
export const PROMPT_AREAS: Record<string, string> = {
  "Welcome & main menu": "Main menu",
  "Errors & retries": "Wrong key, hold and timeouts",
  "Booking by item (key 1)": "Key 1: Bookings",
  Browsing: "Key 1: Bookings",
  "Date & quantity": "Key 1: Bookings",
  Cart: "Key 1: Bookings",
  Checkout: "Key 1: Bookings",
  "Text message consent": "Key 1: Bookings",
  "Promo texts by phone (keys only)": "Key 1: Bookings",
  "Pay by keypad": "Key 1: Bookings",
  "Key 2: Instructions": "Key 2: Instructions",
  "Key 4: Learn about our rentals": "Key 4: Learn about our rentals",
  "Talk to a person": "Keys 0, 3, 5, 6 and Schools: ringing staff",
  "Ringing staff": "Keys 0, 3, 5, 6 and Schools: ringing staff",
  "Catalog (key 8)": "Key 8: Catalog",
  Voicemail: "Voicemail (every box) and Key 9",
  "Texts and emails": "Texts and emails",
};
export const promptArea = (group: string) => PROMPT_AREAS[group] ?? "Other";

export type PromptKey = keyof typeof PROMPTS;
export type PromptOverride = { text: string | null; audioUrl: string | null; recordingId?: number | null; approvedAt?: Date | null; googleRecordingId?: number | null };
export type PromptOverrides = Partial<Record<PromptKey, PromptOverride>>;

export async function loadPromptOverrides(): Promise<PromptOverrides> {
  try {
    const rows = await db.select().from(schema.voicePrompts);
    const out: PromptOverrides = {};
    for (const r of rows) {
      if (r.key in PROMPTS) out[r.key as PromptKey] = { text: r.text, audioUrl: r.audioUrl, recordingId: r.recordingId, approvedAt: r.approvedAt };
    }
    // Google voice recordings made when a wording was approved: played instead of the live voice, but only while the
    // wording is still exactly the one recorded (an edit falls back to the live voice until it's recorded again)
    const google = await db
      .select({ id: schema.promptRecordings.id, key: schema.promptRecordings.promptKey, wording: schema.promptRecordings.wording })
      .from(schema.promptRecordings)
      .where(and(eq(schema.promptRecordings.source, "google"), eq(schema.promptRecordings.complete, true)))
      .orderBy(desc(schema.promptRecordings.createdAt));
    for (const g of google) {
      if (!(g.key in PROMPTS)) continue;
      const k = g.key as PromptKey;
      const o = (out[k] ??= { text: null, audioUrl: null });
      if (o.googleRecordingId) continue;
      if (g.wording === (o.text?.trim() || PROMPTS[k].text)) o.googleRecordingId = g.id;
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

/** Lines with changing parts (names, emails, dates, totals) and consent lines always stay live Google voice. */
export function promptRecordable(key: PromptKey): boolean {
  const def = PROMPTS[key] as PromptDef;
  return !def.vars?.length && !def.textOnly;
}

/** Waiting for Abraham's OK: never plays on the phone line until he approves it in Admin. */
export function promptWaiting(overrides: PromptOverrides, key: PromptKey): boolean {
  return Boolean((PROMPTS[key] as PromptDef).pending) && !overrides[key]?.approvedAt;
}

/** A text or email wording from Hotline prompts (Admin edits included), filled in. */
export async function messageText(key: PromptKey, vars?: Record<string, string | number>) {
  return promptText(await loadPromptOverrides(), key, vars);
}

/** Recorded audio for a prompt: Abraham's upload (Phone Recordings) if one is chosen, else none (the live Google voice). */
export function promptAudio(overrides: PromptOverrides, key: PromptKey): string | null {
  if (!promptRecordable(key)) return null;
  const o = overrides[key];
  if (o?.recordingId) return promptRecordingLink(o.recordingId); // Abraham's upload
  if (o?.googleRecordingId) return promptRecordingLink(o.googleRecordingId); // the Google voice recording of this wording
  return o?.audioUrl || null;
}

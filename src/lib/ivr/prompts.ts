import { promptRecordingLink } from "@/lib/signed-link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { wordSlotsFor } from "@/lib/spoken-words";

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
  /** A spoken prompt of several lines (the main menu): one line per sentence, new lines allowed, up to 1,200 characters. */
  lines?: boolean;
};

export const PROMPTS = {
  // Welcome & main menu
  // Start of the call (Abraham, Nov 16, 2026): separate prompts, in this order. Greeting (always), call recording
  // notice (only when call recording is on), office closed (only when closed), catalog offer (always), main menu.
  greeting: { group: "Welcome & main menu", label: "Greeting (start of every call)", text: "Hi, thank you for calling Hup Up Attractions! Bringing something special to every occasion!" },
  catalog_offer: { group: "Welcome & main menu", label: "Catalog offer (start of every call, before the main menu)", text: "To receive our catalog by text or email, press 8." },
  // Main menu (Abraham, Nov 16, 2026): one prompt, word for word, one line per sentence (a half-second pause between
  // lines when spoken from the text). The same prompt plays every time the menu plays again, without the greeting.
  main_menu: {
    group: "Welcome & main menu",
    label: "Main menu (plays at the start and every time the menu plays again)",
    lines: true,
    text: [
      "If you know your desired extension, you may press it at any time.",
      "For reservations and bookings, press 1.",
      "For instructions and guidance on using our rental equipment, press 2.",
      "For customer service and general inquiries, press 3.",
      "To learn more about our rental attractions and the services we offer, press 4.",
      "For questions or assistance with any issues during your rental, press 5.",
      "For delivery and pickup information, press 6.",
      "To hear our hours of operation, press 7.",
      "To receive our catalog by text or email, press 8.",
      "For feedback and comments, press 9.",
      "To speak with an operator, press 0.",
      "To hear this menu again, press the star key.",
      "Thank you for choosing Hup Up Attractions!",
    ].join("\n"),
  },
  // Bookings menu after pressing 1 (Abraham, Nov 11, 2026), approved word for word; categories come from Admin.
  book_note: { group: "Booking by item (key 1)", label: "Bookings menu: first line (Abraham)", text: "Please note, orders can be placed only through our automated system. For information or questions, press 0 for customer service." },
  book_corporate: { group: "Booking by item (key 1)", label: "Bookings menu key 9 (Abraham)", text: "For schools, corporate events, and organizational bookings, press 9." },
  book_back: { group: "Booking by item (key 1)", label: "Bookings menu: go back (Abraham)", text: "To go back, press star." },
  not_valid: { group: "Welcome & main menu", label: "Any menu: a key that is not a choice (Abraham)", text: "Sorry, that is not a valid selection. Please try again." },
  // Main menu key 2 (Abraham W): instructions for each type of attraction. Editable here like every other prompt.
  attraction_choice: { group: "Key 2: Instructions", label: "Which attraction (keys 2 and 3, Abraham)", text: "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3." },
  instr_menu: { group: "Key 2: Instructions", label: "Key 2 menu (Abraham, Phone Menu v3)", text: "For jumping balloon instructions, press 1. For laser tag, press 2. For paddle boats, press 3. To go back, press star." },
  attraction_menu_back: { group: "Key 2: Instructions", label: "Which attraction: star for the main menu", text: "To go back to the main menu, press the star key." },
  instr_intro: { group: "Key 2: Instructions", label: "Key 2 opening line", text: "We are happy to help you get the most out of your rental." },
  instr_balloons: {
    group: "Key 2: Instructions",
    pending: true, // Abraham (Phone Menu v3): his scripts are coming
    label: "Instructions: jumping balloons",
    text: "Here is how to enjoy your jumping balloon safely. Setup: our team sets it up on a flat, open area, away from trees, fences, power lines and anything sharp. Keep the blower running and its cord and air tube clear the whole time it is in use. Safe use: everyone takes off their shoes, glasses and anything in their pockets. No food, drinks, gum, silly string or sharp toys inside. Keep big and small children apart, and do not overcrowd it. No flips, wrestling or climbing on the walls. Supervision: a responsible adult must watch the jumping balloon at all times while it is in use. Please follow the age and rider limits printed on the unit. Weather: if the wind picks up, if it rains, or if you hear thunder, have everyone get out right away and unplug the blower. Getting ready for pickup: make sure everyone is out, unplug the blower, remove any toys or trash, and leave the unit where it is. We will take care of folding it. Thank you!",
  },
  instr_laser: {
    group: "Key 2: Instructions",
    pending: true, // Abraham (Phone Menu v3): his scripts are coming
    label: "Instructions: laser tag",
    text: "Here is how to enjoy your laser tag safely. Setup: our team sets up the maze and gets the blasters and vests ready. Keep the blower running and its cord clear, and charge the equipment as our team shows you. Safe use: players walk, never run, inside the maze, and no shoes inside the inflatable. Never point the blasters at anyone's eyes up close, and keep vests fastened. No food or drinks inside. Supervision: a responsible adult must supervise the game at all times. Laser tag is best for children around age six and up, and teens and adults love it too. Weather: if it gets windy, starts to rain, or you hear thunder, stop the game, have everyone get out, and unplug the blower. Bring the blasters and vests inside, out of the rain. Getting ready for pickup: collect every blaster and vest, count them, and put them back in their bins. Make sure the maze is empty and unplugged. We will take care of the rest. Thank you!",
  },
  instr_paddle: {
    group: "Key 2: Instructions",
    pending: true, // Abraham (Phone Menu v3): his scripts are coming
    label: "Instructions: paddle boats",
    text: "Here is how to enjoy your paddle boats safely. Setup: our team places the boats in the pool or water area and shows you how they work. Safe use: one rider per boat, unless the boat says otherwise. Riders stay seated, keep their hands and feet inside, and never stand up or bump boats hard. Children who cannot swim should wear a life jacket. Supervision: a responsible adult must watch the water at all times while the boats are in use, and stay close enough to reach a child right away. Please follow the age and weight limits on each boat. Weather: if it gets windy, starts to rain, or you hear thunder, have everyone get out of the water right away. Getting ready for pickup: take the boats out of the water if you can, line them up in one place, and remove any toys or trash. We will take care of the rest. Thank you!",
  },
  attraction_after: { group: "Key 2: Instructions", label: "After instructions or a description: options (keys 2 and 3)", text: "To hear this again, press the star key. To choose another attraction, press 1. To go back to the main menu, press 2." },
  // Main menu key 3 (Abraham W): a description of each type; the items list comes from Admin, so it always matches the website.
  learn_intro: { group: "Key 4: Learn about our rentals", label: "Key 3 opening line", text: "We would love to tell you about our rentals." },
  learn_balloons: {
    group: "Key 4: Learn about our rentals",
    label: "About jumping balloons",
    text: "Our jumping balloons are inflatable bounce houses, and many come with slides or play areas. They are a favorite for birthday parties, family simchas, school events and community celebrations, with options for toddlers and for older kids. Jumping balloons are mostly set up outdoors on grass or a flat, open area. Some smaller units can go indoors in a large room with a high ceiling. Each unit needs open space around it and a nearby power outlet for the blower.",
  },
  learn_laser: {
    group: "Key 4: Learn about our rentals",
    label: "About laser tag",
    text: "Our laser tag comes with blasters and vests, and our inflatable mazes make the game even more exciting. It is a hit with kids around age six and up, teens, and adults, and it is great for parties, schools, camps and group events. Laser tag can be played outdoors, or indoors in a large hall or gym. The maze needs a good amount of open space and a power outlet for the blower.",
  },
  learn_paddle: {
    group: "Key 4: Learn about our rentals",
    label: "About paddle boats",
    text: "Our paddle boats are small, easy-to-steer boats that kids pedal or paddle around the water. They are a fun, special attraction for summer parties, camps and outdoor events. Paddle boats are used outdoors, in a pool or a calm water area with an adult watching. You can rent as many as you need for your space.",
  },
  learn_items: { group: "Key 4: Learn about our rentals", label: "Our items in this category (from Admin)", text: "Our {category} include: {items}.", vars: ["category", "items"] },
  learn_deliver: { group: "Key 4: Learn about our rentals", label: "We deliver (key 3)", text: "We deliver, set up, and pick up, so you can relax and enjoy your event. To book, go back to the main menu and press 1." },
  learn_none: { group: "Key 4: Learn about our rentals", label: "No items in this category right now", text: "We are updating this part of our catalog right now. Please check back with us soon." },
  menu_category: { group: "Welcome & main menu", label: "Menu option for a category", text: "For {category}, press {key}.", vars: ["category", "key"] },
  menu_cart: { group: "Welcome & main menu", label: "Menu option: review cart", text: "Ready to check out? Press 9 to hear your cart." },
  menu_operator: { group: "Welcome & main menu", label: "Menu option: talk to a person", text: "To talk with someone from our team, press 0." },
  menu_speech: { group: "Welcome & main menu", label: "Menu: you can also speak", text: "Or just tell me what you are looking for." },
  menu_repeat: { group: "Welcome & main menu", label: "Menu option: repeat", text: "To hear this again, press star." },
  menu_empty: { group: "Welcome & main menu", label: "No rentals set up yet", text: "We are getting our rentals ready right now. Please call back soon!" },

  // Errors & retries
  idle_warning: { group: "Errors & retries", label: "Inside a booking: 9 minutes with no key (Abraham)", text: "Are you still there? Please press any key to continue. Otherwise, this call will end in one minute." },
  no_input: { group: "Errors & retries", label: "Didn't hear anything", text: "Sorry, I did not catch that. No problem, let us try that again." },
  no_input_final: { group: "Errors & retries", label: "Disconnect line (no key after 3 plays of a menu, or 10 minutes idle in a booking)", text: "It sounds like we got disconnected. You can call us back at any time. Thank you for calling Hup Up Attractions. Bye for now!" },
  tech_error: { group: "Errors & retries", label: "Technical problem", text: "Oops, something went wrong on our end. Please call back in a few minutes. Sorry about that!" },
  went_wrong: { group: "Errors & retries", label: "Something went wrong, back to menu", text: "Sorry, something went wrong. Let us head back to the main menu." },

  // Browsing
  category_intro: { group: "Browsing", label: "Category intro", text: "Awesome, {category}!", vars: ["category"] },
  category_item: { group: "Browsing", label: "Item option in a category", text: "For the {item}, press {key}.", vars: ["item", "key"] },
  back_to_menu: { group: "Browsing", label: "Go back option", text: "To go back to the main menu, press star." },
  category_empty: { group: "Browsing", label: "Category has no items", text: "Sorry, nothing is available in that section right now. Let us head back to the main menu." },
  product_intro: { group: "Browsing", label: "Item intro", text: "Great choice! The {item} is {price}. Delivery is available for an additional fee, and our team will give you the delivery price.", vars: ["item", "price"] },
  product_options: { group: "Browsing", label: "Item options", text: "To hear more about it, press 1. To add it to your cart, press 2. To go back, press star." },
  product_default_desc: { group: "Browsing", label: "Description when an item has none", text: "The {item} is one of our most popular rentals. Kids love it!", vars: ["item"] },

  // Booking by item (Abraham, Nov 9, 2026): category, item, date; if booked, the nearest options
  book_intro: { group: "Booking by item (key 1)", label: "Before the categories", text: "Let us find the right rental for your event." },
  book_category_list: { group: "Booking by item (key 1)", label: "Before the items in a category", text: "Here are our {category}.", vars: ["category"] },
  book_date_prompt: { group: "Booking by item (key 1)", label: "Ask for the event date (keypad)", text: "Please enter your event date: two digits for the month, then two digits for the day. For example, for March 5th, press 0, 3, 0, 5." },
  book_date_entered: { group: "Booking by item (key 1)", label: "Confirm the date", text: "You entered {date}. If that is correct, press pound to continue. To enter a different date, press 1.", vars: ["date"] },
  // Abraham, Nov 15, 2026: unfinished cart from the last call (drafts for his OK)
  // Welcome back (Abraham, Nov 17, 2026), his wording: approved. {items} = "one Castle and one Laser tag set for Tuesday, December 22"
  resume_offer: { group: "Booking by item (key 1)", label: "Welcome back: last call's unfinished cart", text: "Welcome back! On your last call you had in your cart {items}. To check if they are still available, press 1. To start a new order, press 2.", vars: ["items"] },
  // Item taken, whole phone system (Abraham, Nov 17, 2026), his wording
  item_taken: { group: "Booking by item (key 1)", label: "Item not available (whole phone system)", text: "The {item} is no longer available for {date}. For the nearest options, press {key}.", vars: ["item", "date", "key"] },
  taken_options: { group: "Booking by item (key 1)", label: "Item not available: same date or nearest date", text: "For the same date, press 1. For the nearest date this item is free, press 2." },
  booked_intro: { group: "Booking by item (key 1)", label: "Item booked that day", text: "I am sorry, the {item} is already booked on {date}.", vars: ["item", "date"] },
  booked_closest: { group: "Booking by item (key 1)", label: "Closest options intro", text: "Here are the closest options for that day." },
  booked_bigger: { group: "Booking by item (key 1)", label: "Next size up", text: "For the next size up, the {item}, press 1.", vars: ["item"] },
  booked_smaller: { group: "Booking by item (key 1)", label: "Next size down", text: "For the next size down, the {item}, press 2.", vars: ["item"] },
  booked_keep: { group: "Booking by item (key 1)", label: "Keep the item, choose another date", text: "To keep the {item} and choose a different date, press 3.", vars: ["item"] },
  altdate_before: { group: "Booking by item (key 1)", label: "Available the day before", text: "The {item} is available on {date}, the day before. To choose that day, press 1.", vars: ["item", "date"] },
  altdate_after_also: { group: "Booking by item (key 1)", label: "Also available the day after", text: "It is also available on {date}, the day after. To choose that day, press 2.", vars: ["date"] },
  altdate_after: { group: "Booking by item (key 1)", label: "Available the day after (only)", text: "The {item} is available on {date}, the day after. To choose that day, press 2.", vars: ["item", "date"] },
  altdate_not_near: { group: "Booking by item (key 1)", label: "Not available the day before or after", text: "The {item} is not available the day before or after.", vars: ["item"] },
  altdate_nearest_before: { group: "Booking by item (key 1)", label: "Nearest date before", text: "The nearest date before your date is {date}. To choose it, press 1.", vars: ["date"] },
  altdate_nearest_after: { group: "Booking by item (key 1)", label: "Nearest date after", text: "The nearest date after your date is {date}. To choose it, press 2.", vars: ["date"] },
  altdate_other: { group: "Booking by item (key 1)", label: "Try a different date", text: "To try a different date, press 3." },

  // Date & quantity
  date_prompt: { group: "Date & quantity", label: "Ask for the party date", text: "What day is your party? Just say the date, like November 8th. Or type the month and day on your keypad. For November 8th, that is 1, 1, 0, 8." },
  date_past: { group: "Date & quantity", label: "Date already passed", text: "Hmm, that date has already passed. Let us pick another one." },
  date_too_far: { group: "Date & quantity", label: "Date too far ahead", text: "We can book up to one year ahead. Let us pick a date a little sooner." },
  date_unclear: { group: "Date & quantity", label: "Didn't understand the date", text: "Sorry, I did not quite get that date. Let us try that again." },
  date_confirm_day: { group: "Date & quantity", label: "Confirm the date (whole rental day, delivery and pickup times)", text: "Got it, {date}! We will deliver that day between 9 AM and noon, and pick up on {pickup}. Please have the rental outside your door by 9 AM that morning. If that is right, press pound to continue. To pick a different date, press 1.", vars: ["date", "pickup"] },
  sold_out: { group: "Date & quantity", label: "Item booked up", text: "Oh no, the {item} is all booked up on {date}.", vars: ["item", "date"] },
  sold_out_options_cart: { group: "Date & quantity", label: "Booked-up options (has cart)", text: "To look at other rentals, press 1. To hear your cart, press 9. For the main menu, press star." },
  sold_out_options: { group: "Date & quantity", label: "Booked-up options (no cart)", text: "To try a different date, press 1. To look at other rentals, press 2. For the main menu, press star." },
  qty_prompt: { group: "Date & quantity", label: "Ask how many", text: "Good news, we have {count} available on {date}! How many would you like? Press a number from 1 to {max}.", vars: ["count", "date", "max"] },
  qty_invalid: { group: "Date & quantity", label: "Bad quantity", text: "Let us try that again. Please press a number from 1 to 9." },
  only_some_left: { group: "Date & quantity", label: "Fewer left than asked", text: "Oh, only {count} are left for that date.", vars: ["count"] },
  just_booked: { group: "Date & quantity", label: "Someone just booked it", text: "Oh no, someone just grabbed the last {item} for that date.", vars: ["item"] },

  // Cart
  // Item added, whole phone system (Abraham, Nov 17, 2026), his wording
  item_added: { group: "Cart", label: "Item added to cart (every time)", text: "This item is successfully added to your cart." },
  keep_shopping: { group: "Cart", label: "After an item is added: keep shopping or the cart", text: "To keep shopping, press 1. To go to your shopping cart, press 0." },
  another_day: { group: "Cart", label: "After an item is added: book another day (Abraham)", text: "To book another day, press 2." },
  // Ocean balls after every jumping balloon (Abraham, Nov 17, 2026), his wording ("#" is said as pound)
  ocean_balls: { group: "Cart", label: "Ocean balls (after every jumping balloon)", text: "Would you like to add ocean balls? To add 200 balls for $10, press 1. To add 500 balls for $15, press 2. To add 700 balls for $20, press 3. To skip, press pound." },
  // Laser tag extra packs (Abraham, Nov 17, 2026): offered after a maze or guns, like ocean balls. Approved word for word.
  laser_packs: { group: "Cart", label: "Extra laser gun packs (after a maze or guns; sheet box 25b, approved)", text: "Would you like to add more laser guns? To add a 6-pack of laser guns for $75, press 1. To add a 4-pack of laser guns for $50, press 2. To skip, press pound." },
  added: { group: "Cart", label: "Item added to cart", text: "Woohoo! I added {items} to your cart for {date}. It is saved just for you while we are on the phone.", vars: ["items", "date"] },
  after_add: { group: "Cart", label: "After adding", text: "To keep shopping, press 1. To check out, press 9." },
  cart_empty: { group: "Cart", label: "Cart is empty (Abraham, Phone Menu v3)", text: "Your cart is empty. Let us start shopping!" },
  bounce_water_note: { group: "Cart", label: "Before a bounce house is added (Abraham, Phone Menu v3)", text: "Please note, our bounce houses are not for water use." },
  checkout_tax_note: { group: "Cart", label: "Before checkout (Abraham, Phone Menu v3)", text: "Taxes will be calculated after checkout." },
  cart_summary: { group: "Cart", label: "Cart summary", text: "Here is your cart: {items}, for {date}. Your rental total is {total}, plus delivery and sales tax.", vars: ["items", "date", "total"] },
  // Key 1 booking, several days on one call (Abraham, Nov 8, 2026). day_choice and cart_key are Abraham's exact lines.
  day_choice: { group: "Cart", label: "After an item: same day or another day (Abraham)", text: "For the same day, press 1. For another day, press 2." },
  cart_key: { group: "Cart", label: "Booking menus: go to the cart (Abraham)", text: "To go to your shopping cart, press 0." },
  cart_intro: { group: "Cart", label: "Cart: opening line", text: "Here is your cart." },
  cart_day: { group: "Cart", label: "Cart: one rental day", text: "For {date}: {items}.", vars: ["date", "items"] },
  cart_total: { group: "Cart", label: "Cart: rental total", text: "Your rental total is {total}, plus delivery and sales tax.", vars: ["total"] },
  cart_options: { group: "Cart", label: "Cart options", text: "To check out, press 1. To keep shopping, press 2. To start over with an empty cart, press 3." },
  cart_cleared: { group: "Cart", label: "Cart emptied", text: "All set, your cart is empty. Let us start fresh!" },
  cart_expired: { group: "Cart", label: "Cart timed out", text: "Sorry, your cart timed out. Let us start again." },

  // Checkout
  ask_name: { group: "Checkout", label: "Ask for name", text: "Awesome, let us get you booked! Please say your first and last name." },
  ask_address: { group: "Checkout", label: "Ask for address", text: "Thanks! Now please say the delivery address, with the house number, street, and town." },
  // Delivery address in steps (Abraham, Nov 17, 2026; replaces the single address question, box 32). Step 1 and the
  // retry line are approved; steps 2 to 7 are drafts: the steps run on preview only until he approves them.
  addr_street: { group: "Checkout", label: "Address step 1: street name (approved)", text: "Thanks! Please say the street name of the delivery address after the tone. Or press star to type it on your keypad." },
  retry_spoken: { group: "Checkout", label: "Any spoken answer not understood (approved; the step's own line is not repeated)", text: "Sorry, we did not catch that. Please try again." },
  addr_house: { group: "Checkout", label: "Address step 2: house number (draft)", text: "Now, with your keypad, please enter the house number. When you are finished, please press pound.", pending: true },
  addr_unit: { group: "Checkout", label: "Address step 3: apartment or unit (draft)", text: "Thanks! Please say the apartment or unit number after the tone. Or press star to type it on your keypad. If there is no apartment or unit number, please press pound.", pending: true },
  addr_zip: { group: "Checkout", label: "Address step 4: zip code (draft)", text: "Thanks! To continue with Monroe, New York, one zero nine five zero, press 1. To enter a different zip code, press 2.", pending: true },
  addr_zip_enter: { group: "Checkout", label: "Address step 4: enter a zip code (draft)", text: "Please enter the 5-digit zip code. When you are finished, please press pound.", pending: true },
  addr_zip_bad: { group: "Checkout", label: "Address step 4: not 5 digits (draft)", text: "We are sorry, that is not a valid zip code. Please enter the 5-digit zip code again. When you are finished, please press pound.", pending: true },
  addr_outside: { group: "Checkout", label: "Address step 5: outside Orange County (draft)", text: "We are sorry, we do not serve this area. We deliver only in Orange County, New York. To enter a different zip code, press 1.", pending: true },
  addr_not_found: { group: "Checkout", label: "Address step 5: not found on the map, back to step 1 (draft)", text: "We are sorry, we could not find that address. Let us try again.", pending: true },
  addr_readback: { group: "Checkout", label: "Address step 6: read-back (draft; the unit part is left out when there is none)", text: "Thanks! I have {house} {street}, {unit}, {town}, New York, {zip}. If that is correct, press 1. To enter the address again, press 2.", vars: ["house", "street", "unit", "town", "zip"], pending: true },
  addr_price: { group: "Checkout", label: "Address step 7: delivery price (draft)", text: "Thanks! Delivery to {town}, New York, is {price} dollars.", vars: ["town", "price"], pending: true },
  // Abraham, Nov 15, 2026: optional directions for the driver after the address (drafts for his OK)
  ask_directions: { group: "Checkout", label: "Ask for delivery directions (optional)", text: "Is there anything our delivery team should know, like a gate code, where to park, or where to set up? Please say it now. To skip, press pound.", pending: true },
  directions_saved: { group: "Checkout", label: "Delivery directions saved", text: "Thank you, we saved that for our delivery team.", pending: true },
  // Abraham, Nov 15, 2026: payment can never be skipped; no texts and no email means the email is required
  ask_email_required: { group: "Checkout", label: "Ask for email (required: no texts)", text: "To send your secure payment link, we need your email address. Please say your email address, like john at gmail dot com." },
  ask_email: { group: "Checkout", label: "Ask for email", text: "Almost done! Please say your email address for your receipt, like john at gmail dot com. Or press pound to skip." },
  // Call recording notice (Abraham O): PROPOSED wording, not approved yet; plays only if the Owner turns recording on.
  recording_notice: { group: "Welcome & main menu", label: "Call recording notice (after the greeting; plays only when call recording is on)", text: "This call may be monitored and recorded for quality and training purposes." },
  // Keypad typing (Abraham L; proposed wording approved under P, Nov 8, 2026)
  // Abraham, Nov 17, 2026: every question that asks for information ends with this; pound ends the answer. Approved
  // with "please" added.
  press_pound_done: { group: "Checkout", label: "After every information question: press pound when finished", text: "When you are finished, please press pound." },
  type_hint: { group: "Checkout", label: "Typing: how to switch", text: "To type it on your keypad instead, press star." },
  type_instructions: { group: "Checkout", label: "Typing: how to type", text: "To type, press each key until you reach the letter: press 2 once for A, twice for B, three times for C, and the same for every key. To type two letters on the same key, press star once between them. For example, A then B is 2, star, 2 2. Press star twice for a space. When you are finished, please press pound." },
  type_email_symbols: { group: "Checkout", label: "Typing: email symbols", text: "For a dot, press 1 once. For the at sign, press 1 twice." },
  typed_back: { group: "Checkout", label: "Typing: read back", text: "You typed: {value}. If that is right, press pound to continue. To try again, press 1.", vars: ["value"] },
  heard: { group: "Checkout", label: "Read back what we heard", text: "I heard: {value}. If that is right, press pound to continue. To try again, press 1.", vars: ["value"] },
  field_unclear: { group: "Checkout", label: "Didn't catch it", text: "Sorry, I did not catch that. No problem, let us try that again." },
  email_unclear: { group: "Checkout", label: "Didn't catch the email", text: "Sorry, I could not quite catch that email. Let us try that again." },
  email_skip: { group: "Checkout", label: "Skipping email", text: "No problem, we will skip the email." },
  field_trouble: { group: "Checkout", label: "Having trouble hearing", text: "I am having a little trouble hearing you." },
  phone_confirm: { group: "Checkout", label: "Confirm texting number", text: "We will text your secure payment link to the number you are calling from, ending in {last4}. Press 1 to use this number, or 2 to enter a different one.", vars: ["last4"] },
  phone_enter: { group: "Checkout", label: "Type a cell number", text: "Sure thing! Please type your 10 digit cell phone number, starting with the area code." },
  phone_bad: { group: "Checkout", label: "Bad phone number", text: "Hmm, that does not look like a 10 digit number. Let us try again." },
  phone_heard: { group: "Checkout", label: "Read back phone number", text: "I have {number}. If that is right, press pound to continue. To type it again, press 1.", vars: ["number"] },
  thanks_order: { group: "Checkout", label: "Order placed", text: "You are all set, {name}! Your order number is {number}.", vars: ["name", "number"] },
  link_sent: { group: "Checkout", label: "Payment link texted (Abraham, Nov 13, 2026)", text: "We just texted you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay. After that, they go back into stock, and you will need to book them again.", vars: ["minutes"] },
  link_failed: { group: "Checkout", label: "Couldn't text the link", text: "We could not send the text, so someone from our team will call you back shortly to finish up." },
  goodbye_order_days: { group: "Checkout", label: "Goodbye after ordering several days", text: "We will deliver and pick up on the days you chose. Thanks so much for choosing Hup Up Attractions. Have an amazing party, bye for now!" },
  goodbye_order: { group: "Checkout", label: "Goodbye after ordering", text: "We will deliver on {date} and pick up on {pickup}. Thanks so much for choosing Hup Up Attractions. Have an amazing party, bye for now!", vars: ["date", "pickup"] },

  // Text message consent (A2P 10DLC). The exact text spoken is stored with every consent record.
  consent_transactional: {
    group: "Text message consent",
    label: "Ask for order and service texts (transactional)",
    textOnly: true,
    text: "Can Hup Up Attractions text you at this number about your reservation, order, payment, delivery, pickup, and customer service? By agreeing, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Message frequency varies. Message and data rates may apply. You can reply STOP to opt out, or HELP for help, at any time. Our text message terms and privacy policy are on our website. To agree, press 1. If not, press 2.",
  },
  consent_marketing: {
    group: "Text message consent",
    label: "Ask for promotional texts (marketing)",
    textOnly: true,
    text: "One more question. Would you like to receive promotional text messages from Hup Up Attractions at this number? By agreeing, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. You can reply STOP to opt out, or HELP for help, at any time. To agree, press 1. To skip, press 2.",
  },
  consent_marketing_v2: {
    group: "Text message consent",
    label: "Ask for promotional texts, long version (no longer played; replaced by the keys-only steps)",
    textOnly: true,
    text: "One more question. Would you like promotional text messages from Hup Up Attractions at this number: seasonal offers, discount codes, and rental deals, up to 6 per calendar year? If you say yes, we will text you a confirmation, and you will be signed up only after you reply YES to that text within 24 hours. Agreeing is never required to book or buy. Message and data rates may apply. You can reply NOPROMO to stop promos, STOP to stop all texts, or HELP for help, at any time. To get the confirmation text, press 1. To skip, press 2.",
  },
  consent_marketing_sent: {
    group: "Text message consent",
    label: "Promotional confirmation text sent (SMS v3)",
    text: "Thank you. We just texted you a confirmation. Reply YES to that text within 24 hours to sign up for promotional texts.",
  },
  // Promo texts by phone, keys only (Abraham, Nov 10, 2026): replaces consent_marketing_v2, which is no longer played.
  promo_ask: { group: "Promo texts by phone (keys only)", label: "Step 1: after the order", text: "To get seasonal offers, discounts, and deals by text, up to 6 a year, press 1. To skip, press pound." },
  promo_which: { group: "Promo texts by phone (keys only)", label: "Step 2: which number", text: "To get texts at the number you are calling from, press 1. To use a different phone number, press 2." },
  promo_enter: { group: "Promo texts by phone (keys only)", label: "Step 3: enter a number", text: "Please enter the 10-digit mobile number. When you are finished, please press pound." },
  promo_heard: { group: "Promo texts by phone (keys only)", label: "Step 3: read the number back", text: "You entered {number}. If that is right, press pound to continue. To enter it again, press 1.", vars: ["number"] },
  promo_bad: { group: "Promo texts by phone (keys only)", label: "Step 3: not 10 digits", text: "Sorry, that number did not work. Please try again." },
  promo_final: { group: "Promo texts by phone (keys only)", label: "Final line", text: "Thanks! We just sent a text. Reply YES within 24 hours to finish signing up." },
  promo_disclosure: { group: "Promo texts by phone (keys only)", label: "Disclosure line (right after the Final line)", text: "Message and data rates may apply, and you are signed up only after you reply YES to our confirmation text." },
  consent_unclear: { group: "Text message consent", label: "Didn't understand the answer", text: "Sorry, I did not get that. Please press 1 for yes, or 2 for no." },
  consent_stopped: { group: "Text message consent", label: "Number replied STOP before", text: "This number has opted out of our text messages, so we will not text you. To get our texts again, text the word START to this hotline number." },
  consent_marketing_yes: { group: "Text message consent", label: "Signed up for promotional texts", text: "Thank you, you are signed up for promotional texts. We just texted you a confirmation." },
  consent_marketing_no: { group: "Text message consent", label: "Said no to promotional texts", text: "No problem, you will not get promotional texts." },
  // No booking on Shabbes or Yom Tov (Abraham, Nov 14, 2026): the day and time booking opens again
  // The whole hotline on Shabbes and Yom Tov (Abraham, Nov 14, 2026, choice A): drafts for his OK; then the tone, general voicemail
  closed_shabbos_greeting: { group: "Welcome & main menu", label: "Whole hotline on Shabbes: closed greeting (approved Nov 16)", text: "Thank you for calling Hup Up Attractions. We are closed now for Shabbes, and we will be open again on {day} at {time}. Please leave your name, phone number, and a short message after the tone, and we will call you back after Shabbes. Good Shabbes!", vars: ["day", "time"] },
  closed_yomtov_greeting: { group: "Welcome & main menu", label: "Whole hotline on Yom Tov: closed greeting (approved Nov 16)", text: "Thank you for calling Hup Up Attractions. We are closed now for Yom Tov, and we will be open again on {day} at {time}. Please leave your name, phone number, and a short message after the tone, and we will call you back after Yom Tov. Good Yom Tov!", vars: ["day", "time"] },
  office_closed: { group: "Welcome & main menu", label: "Office closed (after the greeting, only when the office is closed; also key 7)", text: "Our office is closed right now, but you can book anytime using our automated system." },
  date_closed: { group: "Date & quantity", label: "Chosen date is a closed day", text: "Sorry, we are closed on {date} for {reason}. Let us pick another date.", vars: ["date", "reason"] },
  address_outside_area: { group: "Checkout", label: "Address outside the delivery area", text: "Sorry, we only deliver in Kiryas Joel and nearby Orange County towns. Please say a delivery address in our area." },
  address_not_found: { group: "Checkout", label: "Address not found on the map", text: "Sorry, we could not find that address. Please say the full address again: the house number, the street, and the town.", pending: true },
  checkout_total: { group: "Checkout", label: "Order total read-back", text: "Your total is {total}. That is {items} for the rentals, {delivery} for delivery, and {tax} sales tax.", vars: ["total", "items", "delivery", "tax"] },
  terms_notice: {
    group: "Checkout",
    label: "Terms notice (press #)",
    textOnly: true,
    text: "By pressing #, you agree to our Terms and Conditions. To review them, go to hupupattractions.com/terms. To get the link by text message, press 1. To continue, press #.",
  },
  terms_link_sent: { group: "Checkout", label: "Terms link texted", text: "We just texted you the link to our Terms and Conditions." },
  terms_link_no_text: { group: "Checkout", label: "Can't text the Terms link (no text consent)", text: "We cannot text you, because you did not agree to text messages, but you can read our Terms at hupupattractions.com/terms." },
  terms_required: { group: "Checkout", label: "Terms not accepted", text: "To finish your booking, you need to accept our Terms and Conditions. Please call us back anytime. Goodbye!" },
  link_emailed: { group: "Checkout", label: "Payment link emailed (caller said no to texts; Abraham, Nov 13, 2026)", text: "No problem, we will not text you. We just emailed you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay. After that, they go back into stock, and you will need to book them again.", vars: ["minutes"] },
  link_emailed_consented: {
    group: "Checkout",
    label: "Payment link emailed (caller agreed to texts, texting not live yet). Approved by Abraham, Nov 12, 2026",
    text: "We just emailed you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay. After that, they go back into stock, and you will need to book them again.",
    vars: ["minutes"],
  },
  // Pay by keypad through Stripe (Abraham, Nov 12, 2026). Wording approved Nov 13, 2026; still owner test only.
  // Sola PhonePay (Abraham, Nov 14, 2026): drafts until he approves them; they play only on his own test calls until then
  phonepay_choice: { group: "Pay by card (Sola PhonePay)", label: "Pay now or get a link", text: "Press 1 to pay now by card. Press 2 to get a secure payment link instead." }, // approved Nov 14
  // Abraham approved the wording (Nov 14, 2026). No recording is made until he picks the voice and approves the audio;
  // until then the lines play in the live voice and PhonePay stays on his own test calls only.
  // Abraham, Nov 17, 2026: card on the call stays the default; this offers a link by text instead. Approved with "press 0".
  phonepay_link_option: { group: "Pay by card (Sola PhonePay)", label: "Before the card: get a payment link by text instead", text: "To pay by card now, please stay on the line. To get a secure payment link by text instead, press 0." },
  // Payment flow on the phone (Abraham, Nov 17, 2026, sheet boxes 140 to 146): approved word for word
  pay_card_line: { group: "Pay by card (Sola PhonePay)", label: "Box 140: card line (no key: the payment line; 0: a payment link)", text: "To pay with a credit or debit card, please stay on the line to connect to our secure payment line. To get a payment link instead, press 0." },
  pay_link_how: { group: "Pay by card (Sola PhonePay)", label: "Box 141: payment link by text or email", text: "To receive the payment link by text, press 1. To receive by email, press 2." },
  pay_link_sent: { group: "Pay by card (Sola PhonePay)", label: "Box 146: payment link sent", text: "Done! We just sent you the payment link. To keep your booking, please complete your payment within the next ten minutes. Otherwise, the booking will be released. Thank you for choosing Hup Up Attractions!" },
  phonepay_intro: { group: "Pay by card (Sola PhonePay)", label: "PhonePay connect", text: "Thank you. Please hold for a moment while we connect you to our secure payment line." }, // approved Nov 14
  phonepay_back: { group: "Pay by card (Sola PhonePay)", label: "Back from the payment line", text: "Thank you. Let us finish your order." }, // approved Nov 14 ("Let's", spelled out by the standing rule)
  phonepay_paid: { group: "Pay by card (Sola PhonePay)", label: "Payment found", text: "Your payment was received. You are all set!" }, // approved Nov 14 ("You're", spelled out)
  phonepay_not_found: { group: "Pay by card (Sola PhonePay)", label: "Payment not found", text: "We could not confirm your payment yet. We will send you a secure payment link, and our team will call you back if needed." }, // approved Nov 14 (spelled out)
  phonepay_unclear: { group: "Pay by card (Sola PhonePay)", label: "Box 147: payment could not be confirmed", text: "Sorry, we could not confirm your payment. To try again, press 1." }, // approved Nov 18, 2026 (box 147)
  phonepay_retry: { group: "Pay by card (Sola PhonePay)", label: "Card did not go through (tries 1 to 4)", text: "Your card did not go through. To try again, press 1." }, // approved Nov 15
  phonepay_retry_last: { group: "Pay by card (Sola PhonePay)", label: "Card did not go through (try 5, last chance)", text: "Your card did not go through. You have one more chance to try. To try again, press 1." }, // approved Nov 15
  phonepay_failed: { group: "Pay by card (Sola PhonePay)", label: "Card did not go through (try 6, call ends)", text: "Sorry, your card did not go through. Please call us back to try again. Goodbye." }, // approved Nov 15
  pay_start: { group: "Pay by keypad", label: "Before the card steps", text: "Let us take care of your payment now. Please have your card ready." },
  pay_card_number: { group: "Pay by keypad", label: "Card number", text: "Please enter your card number on your keypad. When you are finished, please press pound." },
  pay_expiration: { group: "Pay by keypad", label: "Expiration date", text: "Please enter the expiration date, two digits for the month and two digits for the year. When you are finished, please press pound." },
  pay_security_code: { group: "Pay by keypad", label: "Security code", text: "Please enter the security code on your card. When you are finished, please press pound." },
  pay_postal_code: { group: "Pay by keypad", label: "Billing ZIP code", text: "Please enter the billing ZIP code for your card. When you are finished, please press pound." },
  pay_processing: { group: "Pay by keypad", label: "While the payment goes through", text: "One moment while we process your payment." },
  pay_success: { group: "Pay by keypad", label: "Payment approved (Abraham)", text: "Payment received, thank you!" },
  pay_declined: { group: "Pay by keypad", label: "Card declined: try again or link", text: "Sorry, that card did not go through. To try again, press 1. To get a secure payment link by email instead, press 2." },
  link_call_back: { group: "Checkout", label: "No texts and no email", text: "No problem, we will not text you. Someone from our team will call you shortly to finish your payment." },

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
  vma_pin: { group: "Voicemail", label: "Staff access: ask for the password (Abraham, word for word)", text: "Please enter your password." },
  vma_wrong: { group: "Voicemail", label: "Staff access: wrong password", text: "Sorry, that password is not right. Please try again." },
  vma_locked: { group: "Voicemail", label: "Staff access: locked", text: "Voicemail access is locked for now. Please try again later. Goodbye." },
  vma_box: { group: "Voicemail", label: "Staff access: choose a box or call out", text: "Please enter the number of the voicemail box. For the main box, press 1. To call a customer, press 0. To charge a custom amount, press 7. To change your password, press star." },
  vma_out_enter: { group: "Voicemail", label: "Staff access: call out, enter the number (Abraham, word for word)", text: "Please enter the phone number." },
  vma_out_bad: { group: "Voicemail", label: "Staff access: call out, not a valid number (Abraham)", text: "It is not a valid phone number. Please try again." },
  // Owner custom charge (Abraham, Nov 14, 2026): owner voicemail menu, key 7; wording approved (no recording until he picks the voice)
  vma_charge_amount: { group: "Voicemail", label: "Owner custom charge: enter the amount", text: "Enter the amount in dollars and cents. For example, for 125 dollars, press 1 2 5 0 0. When you are finished, please press pound." }, // approved Nov 14
  vma_charge_readback: { group: "Voicemail", label: "Owner custom charge: read the amount back", text: "You entered {dollars} dollars and {cents} cents. Press 1 to confirm, or 2 to enter it again.", vars: ["dollars", "cents"] }, // approved Nov 14
  vma_charge_note: { group: "Voicemail", label: "Owner custom charge: optional order number", text: "To add an order number, enter it now. When you are finished, please press pound. To skip, just press pound." }, // approved Nov 14
  vma_charge_bad: { group: "Voicemail", label: "Owner custom charge: amount not allowed", text: "That amount is not allowed. Please try again." }, // approved Nov 14
  vma_charge_back: { group: "Voicemail", label: "Owner custom charge: back in the menu", text: "You are back in the owner menu." }, // approved Nov 14
  vma_count: { group: "Voicemail", label: "Staff access: how many messages", text: "You have {count} messages, newest first.", vars: ["count"] },
  vma_none: { group: "Voicemail", label: "Staff access: empty box", text: "There are no messages in this box." },
  vma_message: { group: "Voicemail", label: "Staff access: before each message", text: "Message {n}, from {number}, on {date} at {time}.", vars: ["n", "number", "date", "time"] },
  vma_options: { group: "Voicemail", label: "Staff access: after each message", text: "To replay this message, press 1. For the next message, press 2. To mark it as heard, press 3. To call this person back, press 4. To choose another box, press star." },
  vma_heard: { group: "Voicemail", label: "Staff access: marked as heard", text: "Marked as heard." },
  vma_end: { group: "Voicemail", label: "Staff access: no more messages", text: "That was the last message. To choose another box, press star, or hang up." },
  vma_calling: { group: "Voicemail", label: "Staff access: calling back", text: "Calling them back now." },
  vma_newpin: { group: "Voicemail", label: "Staff access: change the password, step 1", text: "Please enter your new password, 4 to 8 digits. When you are finished, please press pound." },
  vma_newpin_again: { group: "Voicemail", label: "Staff access: change the password, step 2", text: "Please enter the new password again. When you are finished, please press pound." },
  vma_newpin_saved: { group: "Voicemail", label: "Staff access: password changed", text: "Your password was changed." },
  vma_newpin_bad: { group: "Voicemail", label: "Staff access: new password not accepted", text: "The passwords did not match, or it was not 4 to 8 digits. Please try again." },
  vma_no_number: { group: "Voicemail", label: "Staff access: no number to call", text: "Sorry, there is no number we can call back for this message." },
  // Key 9 (Abraham, Nov 11, 2026, word for word): feedback and comments only.
  // Key 8 catalog (Abraham, Phone Menu v3), approved word for word.
  catalog_menu: { group: "Catalog (key 8)", label: "Text or email", text: "To receive our catalog by text, press 1. To get it by email, press 2. To go back, press star." },
  // Every phone flow that texts the caller (payment link, key 8 catalog, promo texts): boxes 142 to 144 (Abraham,
  // Nov 17, 2026), approved word for word. They replace the old key 8 lines. The caller's number is never read out.
  text_which: { group: "Texts to the caller (every flow)", label: "Box 142: which number", text: "To text it to the number you are calling from, press 1. To enter a different number, press 2." },
  text_enter: { group: "Texts to the caller (every flow)", label: "Box 143: enter a different number", text: "Please enter the 10-digit phone number. When you are finished, please press pound." },
  text_heard: { group: "Texts to the caller (every flow)", label: "Box 144: read the number back", text: "I have {number}. If that is correct, press 1. To enter a different number, press 2.", vars: ["number"] },
  catalog_text_which: { group: "Catalog (key 8)", label: "Text: which number", text: "We will text it to the number you are calling from. To use this number, press 1. To enter a different number, press 2." },
  catalog_text_enter: { group: "Catalog (key 8)", label: "Text: enter a number", text: "Please enter the 10-digit phone number, then press pound." },
  catalog_text_heard: { group: "Catalog (key 8)", label: "Text: read the number back", text: "I have {number}. If that is correct, press pound to continue. To try again, press 1.", vars: ["number"] },
  catalog_texted: { group: "Catalog (key 8)", label: "Text: done", text: "Done! We just texted you our catalog. Thank you for choosing Hup Up Attractions!" },
  catalog_text_not_yet: { group: "Catalog (key 8)", label: "Text: not available yet", text: "Sorry, we cannot send it by text just yet. Let us send it by email instead." },
  catalog_email_info: { group: "Catalog (key 8)", label: "Email: send us an empty email (plays once the info@ auto-reply is on)", text: "You can also send us an empty email to info at hup up attractions dot com, with the subject Catalog, and we will send it right back to you." },
  catalog_email_local: { group: "Catalog (key 8)", label: "Email step 1: the first part", text: "Please enter the first part of your email address, up to the at symbol. To type it, start pressing keys on your keypad now. To say it, wait for the tone, then say it letter by letter. When you are finished, please press pound." },
  catalog_keypad_help: { group: "Catalog (key 8)", label: "Email: keypad directions (when the caller starts typing)", text: "To type, press each key once, twice, or three times for its letter. For example, press 2 once for A, twice for B, or three times for C. To type another letter on the same key, press star once first. To erase the last letter, press star twice. To go back, press star three times. For a dot, press 1 once. For an underscore, press 1 twice. For a dash, press 1 three times. To switch between letters and numbers, press 0. When you are finished, please press pound." },
  catalog_got: { group: "Catalog (key 8)", label: "Email: read back what we got", text: "We got {letters}. To continue, press pound. To start over, press 1. To add more, press 2.", vars: ["letters"] },
  catalog_ending: { group: "Catalog (key 8)", label: "Email: choose the ending", text: "Now choose the ending. For at gmail dot com, press 1. For at outlook dot com, press 2. For at yahoo dot com, press 3. For at icloud dot com, press 4. For a different ending, press 5." },
  catalog_domain: { group: "Catalog (key 8)", label: "Email: a different ending", text: "Please give us the ending, after the at symbol. To type it, start pressing keys now. To say it, wait for the tone. When you are finished, please press pound." },
  catalog_final: { group: "Catalog (key 8)", label: "Email: final check", text: "Your email address is {email}. If that is correct, press pound to continue. To start over, press 1.", vars: ["email"] },
  catalog_emailed: { group: "Catalog (key 8)", label: "Email: done", text: "We just emailed you our catalog! Check your inbox for a variety of attractions and endless fun for your entire family. Thank you for choosing Hup Up Attractions! To hear the main menu, press star. Otherwise, you may hang up." },
  vm9_greeting: {
    group: "Voicemail",
    label: "Key 9 greeting (general voicemail: feedback and comments)",
    text: "Thank you for your time. We want to hear from you, your feedback helps us improve our service. Please share your comments after the tone. If you would like a callback, please say your name and phone number. When you are finished, you may hang up or press the pound key.",
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
    text: "Thank you for calling Hup Up Attractions! Our office is closed right now. Please leave your name, phone number, and a short message after the tone, and we will call you back as soon as we open. To see our rentals anytime, visit hupupattractions.com. Have a wonderful day!",
  },
  vm_rerecord: { group: "Voicemail", label: "Before the tone when re-recording (press 3)", text: "Please re-record your message. When you are finished, please press pound." },
  vm_none_retry: { group: "Voicemail", label: "Nothing was recorded (Abraham)", text: "We did not receive a message. To try again, press 3. Otherwise, you may hang up." },
  vm_closed: {
    group: "Voicemail",
    label: "Greeting when the office is closed (every box except key 9; same hours as the website and key 7)",
    text: "Thank you for calling Hup Up Attractions. Our office is closed right now. Please leave a message after the tone and we will get back to you as soon as possible. When you are finished, you may hang up or press the pound key.",
  },
  vm_sent: { group: "Voicemail", label: "Message sent (after pressing 1)", text: "Thank you! Your message has been sent. We will get back to you as soon as possible. Goodbye!" },
  voicemail_prompt: { group: "Voicemail", label: "Before the beep (no longer played; replaced by the Greeting)", text: "Please leave your name, phone number, and a short message after the beep. Press pound when you are done." },
  voicemail_thanks: { group: "Voicemail", label: "After the message (no longer played; replaced by Message sent)", text: "Thanks! We got your message and will call you back soon. Bye for now!" },
  voicemail_none: { group: "Voicemail", label: "Caller didn't leave a message", text: "We did not get a message. Please call back anytime. Bye for now!" },

  // Spoken answers typed up and read back (Abraham approved the wording Nov 13, 2026; not active until he approves
  // speech to text and its price)
  spoken_readback: {
    group: "Checkout",
    label: "Read back a spoken answer (speech to text, Google voice)",
    // Abraham's wording, Nov 15, 2026 (approved): pound confirms, 1 records it again
    text: "We got {text}. If that is correct, press pound to continue. To say it again, press 1.",
    vars: ["text"],
  },

  // Staff announcement when a staff phone answers (Abraham). Each extension can still have its own in Phone settings.
  staff_whisper: { group: "Ringing staff", label: "Staff hear when they answer (extensions with a number)", text: "Call from Hup Up Attractions, extension {number}, {name}. Press 1 to accept, or press 2 to reject.", vars: ["number", "name"] },
  staff_whisper_no_number: { group: "Ringing staff", label: "Staff hear when they answer (Schools and Corporate, no extension number)", text: "Call from Hup Up Attractions, {name} extension. Press 1 to accept, or press 2 to reject.", vars: ["name"] },

  // Texts and emails the phone system sends (Abraham, Nov 13, 2026: every word on this page)
  msg_catalog_text: { group: "Texts and emails", message: true, label: "Catalog by text (key 8 and texting CATALOG)", text: "Hup Up Attractions: Here is our {Catalog Name}! You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1." }, // approved Nov 18, 2026; {Catalog Name} from Admin, Catalog email & text
  msg_catalog_email_subject: { group: "Texts and emails", message: true, label: "Catalog email: subject (key 8 and info@ Catalog)", text: "Hup Up Attractions catalog" },
  msg_catalog_email_top: { group: "Texts and emails", message: true, label: "Catalog email: before the list of rentals", text: "Thank you for your interest in Hup Up Attractions!\n\nHere is our catalog:" },
  msg_catalog_email_bottom: { group: "Texts and emails", message: true, label: "Catalog email: after the list of rentals", text: "See our rentals: hupupattractions.com/#rentals\nTo book, call (845) 777-7585." },
  msg_payment_link_subject: { group: "Texts and emails", message: true, label: "Payment link email: subject", text: "Hup Up Attractions order #{number}", vars: ["number"] },
  msg_payment_link: { group: "Texts and emails", message: true, label: "Payment link (text and email) after a phone order", text: "Hup Up Attractions order #{number}: {items}. Rentals ${rentals} + delivery ${delivery} + sales tax ${tax} = total ${total}. Pay securely within {minutes} minutes to confirm: {link}", vars: ["number", "items", "rentals", "delivery", "tax", "total", "minutes", "link"] },
  msg_receipt_subject: { group: "Texts and emails", message: true, label: "Receipt email after a phone payment: subject", text: "Hup Up Attractions receipt for order #{number}", vars: ["number"] },
  msg_receipt_body: { group: "Texts and emails", message: true, label: "Receipt email after a phone payment", text: "{greeting}\n\nThank you for your payment! Here is your receipt.\n\nOrder number: {number}\nPaid on: {paid_on}\nAmount: ${amount}\nCard: ending in {last4}\n\nYour rentals are booked. If you have any questions, call us at (845) 777-7585 or reply to this email.\n\nHup Up Attractions\nhupupattractions.com", vars: ["greeting", "number", "paid_on", "amount", "last4"] },
  msg_payment_received: { group: "Texts and emails", message: true, label: "Payment received (one rental day; text, and email for website payments)", text: "Hup Up Attractions: payment received for order #{number}. You are all set for {date}! We will deliver that day and pick up {pickup}.", vars: ["number", "date", "pickup"] },
  msg_payment_received_days: { group: "Texts and emails", message: true, label: "Payment received (several rental days)", text: "Hup Up Attractions: payment received for order #{number}. You are all set for {dates}! We will deliver and pick up on the days you chose.", vars: ["number", "dates"] },
  msg_terms_link: { group: "Texts and emails", message: true, label: "Terms and Conditions link by text (during checkout)", text: "Hup Up Attractions Terms and Conditions: {link}", vars: ["link"] },
} satisfies Record<string, PromptDef>;

/** Old lines no longer played anywhere (kept so nothing is lost; shown as "Not used"). */
export const RETIRED_PROMPTS = new Set<string>(["instr_intro", "menu_cart", "menu_operator", "menu_speech", "menu_repeat", "category_intro", "back_to_menu", "book_intro", "date_prompt", "date_confirm_day", "sold_out", "sold_out_options_cart", "sold_out_options", "after_add", "cart_summary", "consent_marketing_sent", "consent_marketing_yes", "consent_marketing_no", "transfer_failed", "menu_voicemail", "voicemail_offer", "voicemail_prompt", "voicemail_thanks", "voicemail_none", "catalog_text_which", "catalog_text_enter", "catalog_text_heard", "phonepay_link_option", "phone_confirm", "phone_enter", "phone_heard", "phone_bad", "ask_email", "ask_email_required", "email_skip", "link_sent", "link_emailed", "link_emailed_consented", "link_call_back", "promo_enter", "promo_heard"]);

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
  "Pay by card (Sola PhonePay)": "Key 1: Bookings",
  "Key 2: Instructions": "Key 2: Instructions",
  "Key 4: Learn about our rentals": "Key 4: Learn about our rentals",
  "Talk to a person": "Keys 0, 3, 5, 6 and Schools: ringing staff",
  "Ringing staff": "Keys 0, 3, 5, 6 and Schools: ringing staff",
  "Catalog (key 8)": "Key 8: Catalog",
  "Texts to the caller (every flow)": "Texts to the caller (every flow)",
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
    // Hark's recordings for pieces, numbers, letters and rental names (Abraham, Nov 15, 2026), and the Owner's
    // "Achird for the whole line" switch: used to put lines with changing parts together (see composeClips)
    const clips: Record<string, number> = {};
    for (const r of rows) if (r.recordingId && !(r.key in PROMPTS)) clips[r.key] = r.recordingId;
    const [sw] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "achirdWholeLine")).limit(1);
    const [gl] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "googleLiveVoice")).limit(1);
    const items = (await db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products)).map((p) => ({ id: p.id, name: p.name }));
    EXTRAS.set(out, { clips, achird: sw?.value === true, googleLive: gl?.value === true && Boolean(process.env.GOOGLE_TTS_API_KEY), items });
    return out;
  } catch (e) {
    console.error("Could not load prompt overrides, using defaults", e);
    return {};
  }
}

type Extras = { clips: Record<string, number>; achird: boolean; googleLive: boolean; items: { id: number; name: string }[] };
const EXTRAS = new WeakMap<PromptOverrides, Extras>();
/** Option B is on (Owner switch on, and GOOGLE_TTS_API_KEY in Vercel). */
export const googleLiveOn = (overrides: PromptOverrides) => Boolean(EXTRAS.get(overrides)?.googleLive);

/**
 * A line with changing parts, put together from Hark's recordings: each fixed piece, then each changing part as
 * numbers, letters, words or a rental name. Only when the Owner has turned on "Achird for the whole line" and every
 * part has a recording; otherwise null, and the line is spoken in the live voice as before.
 */
export function composeClips(overrides: PromptOverrides, key: PromptKey, vars: Record<string, string | number> = {}): string[] | null {
  const x = EXTRAS.get(overrides);
  if (!x?.achird) return null;
  const template = overrides[key]?.text?.trim() || PROMPTS[key].text;
  const parts = template.split(/(\{[a-z0-9_]+\})/i).map((p) => p.trim()).filter((p) => p && (/^\{/.test(p) || /[a-z]/i.test(p)));
  const urls: string[] = [];
  let piece = 0;
  for (const p of parts) {
    const v = /^\{([a-z0-9_]+)\}$/i.exec(p);
    if (!v) {
      piece++;
      const id = x.clips[`${key}#${piece}`];
      if (!id) return null;
      urls.push(promptRecordingLink(id));
      continue;
    }
    const words = wordSlotsFor(String(vars[v[1]] ?? ""), x.items);
    if (!words) return null;
    for (const w of words) {
      const id = x.clips[w];
      if (!id) return null;
      urls.push(promptRecordingLink(id));
    }
  }
  return urls;
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

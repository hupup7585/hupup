import { promptRecordingLink } from "@/lib/signed-link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { pluralName, wordSlotsFor } from "@/lib/spoken-words";

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
  /** Put together only from recordings of other slots (pieces and shared pieces), never its own recording. */
  parts?: string[];
};

/**
 * Shared pieces (Abraham, Nov 22, 2026): one recording used inside several lines ("for" in box 17, box 18 and box 25;
 * "one, item" for a cart with one item). Listed once in Admin, under their own key.
 */
export const SHARED_PIECES: { key: string; group: string; label: string; text: string }[] = [
  { key: "piece:for", group: "Date & quantity", label: "Shared piece: for (box 17, box 18 and box 25)", text: "for" },
  { key: "piece:one_item", group: "Cart", label: "Cart - one item", text: "one, item" },
];
/** A line's own piece that plays a shared piece instead (the slot is listed once, under the shared key). */
export const PIECE_ALIAS: Record<string, string> = {
  "closed_day_intro#2": "piece:for",
  "box18_book#2": "piece:for",
};

/**
 * Whole menus (Abraham, Nov 26, 2026): one recording for a menu's fixed lines, in this order ("star" = the shared
 * go-back line). It plays instead of the separate lines once a recording is chosen for its slot (whole_<id>) and the
 * menu's lines that call are exactly these; dates, prices, names and totals still play on their own. The separate
 * line slots stay as they are.
 */
export const MENU_COMBOS: Record<string, readonly string[]> = {
  "instr_menu": [
    "instr_menu",
    "star"
  ],
  "attraction_choice": [
    "attraction_choice",
    "star"
  ],
  "catalog_menu": [
    "catalog_menu",
    "star"
  ],
  "text_which": [
    "text_which",
    "star"
  ],
  "catalog_ending": [
    "catalog_ending",
    "star"
  ],
  "box108a_ask": [
    "box108a_ask",
    "star"
  ],
  "catalog_emailed": [
    "catalog_emailed",
    "pause",
    "catalog_main_star",
    "pause",
    "catalog_bye"
  ],
  "cart_key": [
    "cart_key",
    "star"
  ],
  "book_r2": [
    "book_r2",
    "cart_key",
    "star"
  ],
  "product_options": [
    "product_options",
    "cart_key",
    "star"
  ],
  "book_date_prompt": [
    "book_date_prompt",
    "star"
  ],
  "closed_book_it": [
    "closed_book_it",
    "closed_pick_another",
    "star"
  ],
  "box18_other_date": [
    "box18_other_date",
    "star"
  ],
  "stay_on_line": [
    "stay_on_line",
    "star"
  ],
  "skip_pound": [
    "skip_pound",
    "star"
  ],
  "ocean_200": [
    "ocean_200",
    "ocean_500",
    "ocean_700",
    "star"
  ],
  "remove_enter": [
    "remove_enter",
    "star"
  ],
  "lookup_intro": [
    "lookup_intro",
    "lookup_options",
    "star"
  ],
  "lookup_phone_enter": [
    "lookup_phone_enter",
    "pound_done",
    "star"
  ],
  "addr_house": [
    "addr_house",
    "pound_done",
    "star"
  ],
  "addr_unit_ask": [
    "addr_unit_ask",
    "star"
  ],
  "addr_unit": [
    "addr_unit",
    "pound_done",
    "star"
  ],
  "addr_zip": [
    "addr_zip",
    "star"
  ],
  "addr_street_menu": [
    "addr_street_menu",
    "star"
  ],
  "addr_outside": [
    "addr_outside",
    "star"
  ],
  "promo_ask": [
    "promo_ask",
    "pause",
    "skip_pound"
  ],
  "book": [
    "book_r1",
    "book_orders_only",
    "book_r3a",
    "book_r2",
    "book_r3b",
    "star"
  ],
  "book_again": [
    "book_r1",
    "book_r3a",
    "book_r2",
    "book_r3b",
    "star"
  ],
  "after_hours_closed": [
    "after_hours_closed",
    "after_hours_auto",
    "after_hours_message"
  ],
  "hours": [
    "key7_cs_hours"
  ]
};

export const PROMPTS = {
  // Key 7 (Abraham, Nov 26, 2026): the hours as one recording, instead of reading them from the Hours page. Plays only
  // once a recording is chosen; type the exact words here before recording them
  whole_hours: { group: "Whole menus (one recording each)", label: "Whole menu: Key 7 hours (plays instead of the hours read from the Hours page once a recording is chosen)", text: "Our hours, as one recording." },
  whole_instr_menu: { group: "Whole menus (one recording each)", label: "Whole menu: Key 2 menu (instructions) (plays instead of its separate lines once a recording is chosen)", text: "For jumping balloon instructions, press 1. For laser tag, press 2. For paddle boats, press 3. To go back, press star." },
  whole_attraction_choice: { group: "Whole menus (one recording each)", label: "Whole menu: Key 6 menu (learn about our rentals) (plays instead of its separate lines once a recording is chosen)", text: "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3. To go back, press star." },
  whole_catalog_menu: { group: "Whole menus (one recording each)", label: "Whole menu: Key 8 catalog menu (plays instead of its separate lines once a recording is chosen)", text: "To receive our catalog by text, press 1. To get it by email, press 2. To go back, press star." },
  whole_text_which: { group: "Whole menus (one recording each)", label: "Whole menu: Which number to text (plays instead of its separate lines once a recording is chosen)", text: "To text it to the number you are calling from, press 1. To enter a different number, press 2. To go back, press star." },
  whole_catalog_ending: { group: "Whole menus (one recording each)", label: "Whole menu: Catalog sent: ending menu (plays instead of its separate lines once a recording is chosen)", text: "Now choose the ending. For at gmail dot com, press 1. For at outlook dot com, press 2. For at yahoo dot com, press 3. For at icloud dot com, press 4. For a different ending, press 5. To go back, press star." },
  whole_box108a_ask: { group: "Whole menus (one recording each)", label: "Whole menu: Box 108a: save the email (plays instead of its separate lines once a recording is chosen)", text: "To save this email address with your phone number, press 1. To skip, press pound. To go back, press star." },
  whole_catalog_emailed: { group: "Whole menus (one recording each)", label: "Whole menu: Box 109: catalog emailed, ending (plays instead of its separate lines once a recording is chosen)", text: "We just emailed you our catalog! Check your inbox for a variety of attractions and endless fun for your entire family. To go to the main menu, press star. Thank you for calling Hup Up Attractions! Bye for now!" },
  whole_cart_key: { group: "Whole menus (one recording each)", label: "Whole menu: Shared ending: shopping cart (0) and go back (star), after item lists and offers (plays instead of its separate lines once a recording is chosen)", text: "To go to your shopping cart, press 0. To go back, press star." },
  whole_book_r2: { group: "Whole menus (one recording each)", label: "Whole menu: Box 12a: the categories menu (plays instead of its separate lines once a recording is chosen)", text: "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3. To go to your shopping cart, press 0. To go back, press star." },
  whole_product_options: { group: "Whole menus (one recording each)", label: "Whole menu: An item's menu (plays instead of its separate lines once a recording is chosen)", text: "To hear more about it, press 1. To add it to your cart, press 2. To go to your shopping cart, press 0. To go back, press star." },
  whole_book_date_prompt: { group: "Whole menus (one recording each)", label: "Whole menu: The date prompt (plays instead of its separate lines once a recording is chosen)", text: "Using your keypad, please enter your event date: two digits for the month, then two digits for the day. For example, for March fifth, press 0, 3, 0, 5. To go back, press star." },
  whole_closed_book_it: { group: "Whole menus (one recording each)", label: "Whole menu: Box 17: closed day options (plays instead of its separate lines once a recording is chosen)", text: "To book it, press 1. To pick another date, press 2. To go back, press star." },
  whole_box18_other_date: { group: "Whole menus (one recording each)", label: "Whole menu: Box 18: other date and go back (plays instead of its separate lines once a recording is chosen)", text: "To choose a different date, press 3. To go back, press star." },
  whole_stay_on_line: { group: "Whole menus (one recording each)", label: "Whole menu: Laser gun sets: stay on the line and go back (plays instead of its separate lines once a recording is chosen)", text: "Otherwise, stay on the line. To go back, press star." },
  whole_skip_pound: { group: "Whole menus (one recording each)", label: "Whole menu: Laser packs: skip and go back (plays instead of its separate lines once a recording is chosen)", text: "To skip, press pound. To go back, press star." },
  whole_ocean_200: { group: "Whole menus (one recording each)", label: "Whole menu: Ocean balls amounts menu (plays instead of its separate lines once a recording is chosen)", text: "To add 200 balls for $10, press 1. To add 500 balls for $15, press 2. To add 700 balls for $20, press 3. To go back, press star." },
  whole_remove_enter: { group: "Whole menus (one recording each)", label: "Whole menu: Remove an item: how many (plays instead of its separate lines once a recording is chosen)", text: "Using your keypad, please enter the amount you would like to remove. To go back, press star." },
  whole_lookup_intro: { group: "Whole menus (one recording each)", label: "Whole menu: Address lookup menu (plays instead of its separate lines once a recording is chosen)", text: "Next, we need the delivery address. To look it up with the number you are calling from, press 1. To look it up with a different phone number, press 2. To enter the address manually, press 3. To go back, press star." },
  whole_lookup_phone_enter: { group: "Whole menus (one recording each)", label: "Whole menu: Lookup: enter the phone number (plays instead of its separate lines once a recording is chosen)", text: "Please enter a 10-digit phone number, starting with the area code. When you are done, press pound. To go back, press star." },
  whole_addr_house: { group: "Whole menus (one recording each)", label: "Whole menu: Address: house number (plays instead of its separate lines once a recording is chosen)", text: "Now, with your keypad, please enter the house number. When you are done, press pound. To go back, press star." },
  whole_addr_unit_ask: { group: "Whole menus (one recording each)", label: "Whole menu: Address: unit question (plays instead of its separate lines once a recording is chosen)", text: "If this address has a unit number, press 1. If not, press 2. To go back, press star." },
  whole_addr_unit: { group: "Whole menus (one recording each)", label: "Whole menu: Address: unit number (plays instead of its separate lines once a recording is chosen)", text: "Thanks, with your keypad, please enter the unit number. When you are done, press pound. To go back, press star." },
  whole_addr_zip: { group: "Whole menus (one recording each)", label: "Whole menu: Address: zip menu (plays instead of its separate lines once a recording is chosen)", text: "For Monroe, New York, one zero nine five zero, press 1. For Highland Mills, New York, one zero nine three zero, press 2. For Chester, New York, one zero nine one eight, press 3. For Washingtonville, New York, one zero nine nine two, press 4. For Central Valley, New York, one zero nine one seven, press 5. For Harriman, New York, one zero nine two six, press 6. To enter a different zip code, press 7. To go back, press star." },
  whole_addr_street_menu: { group: "Whole menus (one recording each)", label: "Whole menu: Address: street menu (plays instead of its separate lines once a recording is chosen)", text: "To search for the street name by voice, press 1. To search it with your keypad, press 2. To go back, press star." },
  whole_addr_outside: { group: "Whole menus (one recording each)", label: "Whole menu: Address outside the area (plays instead of its separate lines once a recording is chosen)", text: "We are sorry, we do not deliver to this area. We deliver only in Orange County, New York. To enter a different zip code, press 1. To go back, press star." },
  whole_promo_ask: { group: "Whole menus (one recording each)", label: "Whole menu: Promotional texts question (plays instead of its separate lines once a recording is chosen)", text: "To get seasonal offers, discounts, and deals by text, up to 5 a year, press 1. To skip, press pound." },
  whole_book: { group: "Whole menus (one recording each)", label: "Whole menu: Bookings menu (first time) (plays instead of its separate lines once a recording is chosen)", text: "To receive our catalog by text or email, press 8. The fastest way to place an order is with our easy automated system. For information or questions, press 0 for customer service. For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3. For schools, corporate events, and organizational bookings, press 9. To go back, press star." },
  whole_book_again: { group: "Whole menus (one recording each)", label: "Whole menu: Bookings menu (coming back, without line 1b) (plays instead of its separate lines once a recording is chosen)", text: "To receive our catalog by text or email, press 8. For information or questions, press 0 for customer service. For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3. For schools, corporate events, and organizational bookings, press 9. To go back, press star." },
  whole_after_hours_closed: { group: "Whole menus (one recording each)", label: "Whole menu: Bookings key 0 after hours (lines 1, 3, 4) (plays instead of its separate lines once a recording is chosen)", text: "Our customer service is currently closed. For the best availability and fastest booking, please use our easy automated system to ensure your booking today. To get started, press 1. Otherwise, leave a message after the tone, and a customer service representative will return your call on the next open day, and will help you find the best available options for your needs." },
  // Welcome & main menu
  // Start of the call (Abraham, Nov 16, 2026): separate prompts, in this order. Greeting (always), call recording
  // notice (only when call recording is on), office closed (only when closed), catalog offer (always), main menu.
  greeting: { group: "Welcome & main menu", label: "Greeting (start of every call)", text: "Hi, thank you for calling Hup Up Attractions! Bringing something special to every occasion!" },
  // The greeting's catalog offer was removed (Hark for Abraham, Nov 19, 2026): key 8 is in the main menu and the bookings menu
  catalog_offer: { group: "Welcome & main menu", label: "Catalog offer (no longer played: key 8 is in the main menu)", text: "To receive our catalog by text or email, press 8." },
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
      "For questions or assistance with any issues during your rental, press 4.",
      "For delivery and pickup information, press 5.",
      "To learn more about our rental attractions and the services we offer, press 6.",
      "To hear our hours of operation, press 7.",
      "To receive our catalog by text or email, press 8.",
      "For feedback and comments, press 9.",
      "To speak with an operator, press 0.",
      "To hear this menu again, press the star key.",
      "Thank you for choosing Hup Up Attractions!",
    ].join("\n"),
  },
  // Bookings menu after pressing 1 (Abraham, Nov 11, 2026), approved word for word; categories come from Admin.
  // Bookings menu (Hark for Abraham, Nov 19, 2026): three recordings, then the shared star line
  book_r1: { group: "Booking by item (key 1)", label: "Bookings menu, recording 1", text: "To receive our catalog by text or email, press 8." },
  // Abraham, Nov 19, 2026: its own recording, played only the first time the caller reaches the bookings menu
  // Abraham, y, Nov 25, 2026, 2:02 PM: the second line of the bookings menu, first time only
  book_orders_only: { group: "Booking by item (key 1)", label: "Bookings menu, recording 1b: fastest way to order (every time)", text: "The fastest way to place an order is with our easy automated system." },
  book_r2: { group: "Booking by item (key 1)", label: "Bookings menu, recording 2", text: "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3." },
  book_r3a: { group: "Booking by item (key 1)", label: "Bookings menu, recording 3a (customer service)", text: "For information or questions, press 0 for customer service." },
  // Abraham, Nov 26, 2026: right after 3a in the bookings menu only, from its uploaded recording (no Google voice)
  book_r3c: { group: "Booking by item (key 1)", label: "Bookings menu, recording 3c: customer service hours", text: "Our customer service is open Sunday through Thursday, from 11 AM to 2 PM, and at night from 7:30 PM to 10:30 PM." },
  // Bookings menu key 0 outside customer service hours (Abraham: wording y 3:21 PM, order y 3:27 PM, Nov 25, 2026);
  // (the hours line, book_r3c, plays in the bookings menu only: Abraham, Nov 26, 2026)
  after_hours_closed: { group: "Booking by item (key 1)", label: "Bookings key 0 after hours, line 1: customer service closed", text: "Our customer service is currently closed." },
  after_hours_auto: { group: "Booking by item (key 1)", label: "Bookings key 0 after hours, line 3: use the automated system (key 1)", text: "For the best availability and fastest booking, please use our easy automated system to ensure your booking today. To get started, press 1." },
  after_hours_message: { group: "Booking by item (key 1)", label: "Bookings key 0 after hours, line 4: leave a message", text: "Otherwise, leave a message after the tone, and a customer service representative will return your call on the next open day, and will help you find the best available options for your needs." },
  book_r3b: { group: "Booking by item (key 1)", label: "Bookings menu, recording 3b (schools and organizations)", text: "For schools, corporate events, and organizational bookings, press 9." },
  book_note: { group: "Booking by item (key 1)", label: "Bookings menu: first line (replaced by recording 1, Nov 19)", text: "Please note, orders can be placed only through our automated system. For information or questions, press 0 for customer service." },
  book_corporate: { group: "Booking by item (key 1)", label: "Bookings menu key 9 (replaced by recording 3, Nov 19)", text: "For schools, corporate events, and organizational bookings, press 9." },
  // The one shared star line (Nov 19, 2026): taken out of every menu line; played once after every menu with a way back
  book_back: { group: "Welcome & main menu", label: "Shared: go back (plays after every menu with a way back)", text: "To go back, press star." },
  // Abraham, Nov 23, 2026 (approved): no line says "press pound to continue"; every confirm or read-back line ends with
  // this one recording. 1 confirms and moves on, 2 tries that step again.
  // Abraham, Nov 23, 2026 (approved, word for word; recording ready). Not in the call flow until he says where it plays.
  automated_only: { group: "Welcome & main menu", label: "Automated orders only (where it plays is not decided yet)", text: "Please note, orders can only be placed through our automated system." },
  confirm_ending: { group: "Welcome & main menu", label: "Confirm ending (plays after every confirm or read-back line)", text: "If that is correct, press 1. To try again, press 2." },
  not_valid: { group: "Welcome & main menu", label: "Any menu: a key that is not a choice (Abraham)", text: "Sorry, that is not a valid selection." }, // Nov 19, 2026: then the same recording starts over
  // Main menu key 2 (Abraham W): instructions for each type of attraction. Editable here like every other prompt.
  attraction_choice: { group: "Key 2: Instructions", label: "Which attraction (keys 2 and 3, Abraham)", text: "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3." },
  instr_menu: { group: "Key 2: Instructions", label: "Key 2 menu (Abraham, Phone Menu v3)", text: "For jumping balloon instructions, press 1. For laser tag, press 2. For paddle boats, press 3." },
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
  // Laser tag instructions (Abraham, Nov 25, 2026, 1:28 PM, approved): three parts played in a row (replace instr_laser)
  instr_laser_1: { group: "Key 2: Instructions", label: "Instructions: laser tag, part 1", text: "Here is how to use your laser tag set from Hup Up Attractions. First, charge everything. Place each gun upside down in the charging station, and plug a cable into the side of each vest. A full charge takes one to two hours. Before every game, pair each gun with its vest. Turn on the vest first, then the gun. When the gun says, Ready to Pair, aim it at your vest and shoot." },
  instr_laser_2: { group: "Key 2: Instructions", label: "Instructions: laser tag, part 2", text: "Then, within ten seconds, press the Team button on the back of the front piece of the vest to choose your team color. Press plus or minus on the back of the vest to set your lives. Wait until you hear, Setup complete. Good luck. To play, aim at the other player's vest and pull the trigger. When your gun runs out of shots, press the Reload button. Also press Reload after you change weapons. When your lives run out, you are out of the game." },
  instr_laser_3: { group: "Key 2: Instructions", label: "Instructions: laser tag, part 3", text: "For safety, please keep the set dry, do not push or wrestle, and an adult must watch young children. To turn off a gun or vest, hold the power button for three seconds. A full written guide comes with your rental. If you need help, please call us. Thank you for choosing Hup Up Attractions!" },
  instr_paddle: {
    group: "Key 2: Instructions",
    pending: true, // Abraham (Phone Menu v3): his scripts are coming
    label: "Instructions: paddle boats",
    text: "Here is how to enjoy your paddle boats safely. Setup: our team places the boats in the pool or water area and shows you how they work. Safe use: one rider per boat, unless the boat says otherwise. Riders stay seated, keep their hands and feet inside, and never stand up or bump boats hard. Children who cannot swim should wear a life jacket. Supervision: a responsible adult must watch the water at all times while the boats are in use, and stay close enough to reach a child right away. Please follow the age and weight limits on each boat. Weather: if it gets windy, starts to rain, or you hear thunder, have everyone get out of the water right away. Getting ready for pickup: take the boats out of the water if you can, line them up in one place, and remove any toys or trash. We will take care of the rest. Thank you!",
  },
  attraction_after: { group: "Key 2: Instructions", label: "After instructions or a description: options (keys 2 and 3)", text: "To hear this again, press the star key. To choose another attraction, press 1. To go back to the main menu, press 2." },
  // Main menu key 3 (Abraham W): a description of each type; the items list comes from Admin, so it always matches the website.
  learn_intro: { group: "Key 6: Learn about our rentals", label: "Key 6 opening line", text: "We would love to tell you about our rentals." },
  learn_balloons: {
    group: "Key 6: Learn about our rentals",
    label: "About jumping balloons",
    text: "Our jumping balloons are inflatable bounce houses, and many come with slides or play areas. They are a favorite for birthday parties, family simchas, school events and community celebrations, with options for toddlers and for older kids. Jumping balloons are mostly set up outdoors on grass or a flat, open area. Some smaller units can go indoors in a large room with a high ceiling. Each unit needs open space around it and a nearby power outlet for the blower.",
  },
  learn_laser: {
    group: "Key 6: Learn about our rentals",
    label: "About laser tag",
    text: "Our laser tag comes with blasters and vests, and our inflatable mazes make the game even more exciting. It is a hit with kids around age six and up, teens, and adults, and it is great for parties, schools, camps and group events. Laser tag can be played outdoors, or indoors in a large hall or gym. The maze needs a good amount of open space and a power outlet for the blower.",
  },
  learn_paddle: {
    group: "Key 6: Learn about our rentals",
    label: "About paddle boats",
    text: "Our paddle boats are small, easy-to-steer boats that kids pedal or paddle around the water. They are a fun, special attraction for summer parties, camps and outdoor events. Paddle boats are used outdoors, in a pool or a calm water area with an adult watching. You can rent as many as you need for your space.",
  },
  learn_items: { group: "Key 6: Learn about our rentals", label: "Our items in this category (from Admin)", text: "Our {category} include: {items}.", vars: ["category", "items"] },
  learn_deliver: { group: "Key 6: Learn about our rentals", label: "We deliver (key 6)", text: "We deliver, set up, and pick up, so you can relax and enjoy your event. To book, go back to the main menu and press 1." },
  learn_none: { group: "Key 6: Learn about our rentals", label: "No items in this category right now", text: "We are updating this part of our catalog right now. Please check back with us soon." },
  menu_category: { group: "Welcome & main menu", label: "Menu option for a category", text: "For {category}, press {key}.", vars: ["category", "key"] },
  menu_cart: { group: "Welcome & main menu", label: "Menu option: review cart", text: "Ready to check out? Press 9 to hear your cart." },
  menu_operator: { group: "Welcome & main menu", label: "Menu option: talk to a person", text: "To talk with someone from our team, press 0." },
  menu_speech: { group: "Welcome & main menu", label: "Menu: you can also speak", text: "Or just tell me what you are looking for." },
  menu_repeat: { group: "Welcome & main menu", label: "Menu option: repeat", text: "To hear this again, press star." },
  menu_empty: { group: "Welcome & main menu", label: "No rentals set up yet", text: "We are getting our rentals ready right now. Please call back soon!" },

  // Errors & retries
  idle_warning: { group: "Errors & retries", label: "Inside a booking: 9 minutes with no key (Abraham)", text: "Are you still there? Please press any key to continue. Otherwise, this call will end in one minute." },
  no_input: { group: "Errors & retries", label: "Old no-key line (replaced by the no-choice line, Nov 22, 2026)", text: "Sorry, I did not catch that. No problem, let us try that again." },
  // System-wide no key (Abraham, Nov 22, 2026): after 5 seconds, then the same screen again
  no_choice: { group: "Errors & retries", label: "No key pressed (every key menu, after 5 seconds; then the same screen)", text: "We did not get your choice. Please try again." },
  no_input_final: { group: "Errors & retries", label: "Disconnect line (no key after 3 plays of a menu, or 10 minutes idle in a booking)", text: "It sounds like we got disconnected, but you can call us back at any time. Thank you for calling Hup Up Attractions. Bye for now!" },
  tech_error: { group: "Errors & retries", label: "Technical problem", text: "Oops, something went wrong on our end. Please call back in a few minutes. Sorry about that!" },
  went_wrong: { group: "Errors & retries", label: "Something went wrong, back to menu", text: "Sorry, something went wrong. Let us head back to the main menu." },

  // Browsing
  category_intro: { group: "Browsing", label: "Category intro", text: "Awesome, {category}!", vars: ["category"] },
  category_item: { group: "Browsing", label: "Item option in a category", text: "For the {item}, press {key}.", vars: ["item", "key"] },
  back_to_menu: { group: "Browsing", label: "Go back option (replaced by the one shared star line, Nov 19)", text: "To go back, press star." },
  category_empty: { group: "Browsing", label: "Category has no items", text: "Sorry, nothing is available in that section right now. Please check again later." }, // Abraham, Nov 22, 2026: then the bookings menu
  product_intro: { group: "Browsing", label: "Item intro", text: "Great choice! The {item} is {price}. Delivery is available for an additional fee, and our team will give you the delivery price.", vars: ["item", "price"] },
  product_options: { group: "Browsing", label: "Item options", text: "To hear more about it, press 1. To add it to your cart, press 2." },
  product_default_desc: { group: "Browsing", label: "Description when an item has none", text: "The {item} is one of our most popular rentals. Kids love it!", vars: ["item"] },

  // Booking by item (Abraham, Nov 9, 2026): category, item, date; if booked, the nearest options
  book_intro: { group: "Booking by item (key 1)", label: "Before the categories", text: "Let us find the right rental for your event." },
  book_category_list: { group: "Booking by item (key 1)", label: "Before the items in a category", text: "Here are our {category}.", vars: ["category"] },
  book_date_prompt: { group: "Booking by item (key 1)", label: "Ask for the event date (keypad)", text: "Using your keypad, please enter your event date: two digits for the month, then two digits for the day. For example, for March fifth, press 0, 3, 0, 5." },
  // Chanukah and Chol Hamoed (Abraham, Nov 18, 2026). Box 150 and box 149 approved word for word.
  fri_mutze_check: { group: "Booking by item (key 1)", label: "Box 150: Friday date check (Chanukah and Chol Hamoed only)", text: "You entered {date}. If that is correct, press 1. To keep your rental for Mutze Shabbes, press 2. To enter a different date, press 3.", vars: ["date"] }, // approved Nov 25, 2026, 12:16 PM (exact text, recording uploaded) (no pound to continue)
  fri_mutze_price: { group: "Booking by item (key 1)", label: "Box 149: Friday plus Mutze Shabbes", text: "For Friday and Mutze Shabbes, you will be charged for only one and a half days, a total of {price}. Your rental will be picked up on {date}, at 9:00 AM. Please make sure it is ready outside on time.", vars: ["price", "date"] },
  fri_only: { group: "Booking by item (key 1)", label: "Friday only (after pound in box 150), NOT APPROVED yet (Abraham's draft, Nov 19)", text: "For Friday, you will be charged for one full day, a total of {price}. Your rental will be picked up one hour after Shabbes. Please make sure it is ready outside on time.", vars: ["price"], pending: true },
  // Jumping balloons (Abraham, Nov 19, 2026, approved): box 153 menu, box 154 when a balloon is chosen
  // Old-cart item added (Nov 19, 2026)
  // Box 25 for laser tag and paddle boats (Abraham, Nov 22, 2026): a second one while another is free that date
  box25_added: { group: "Booking by item (key 1)", label: "Box 25: Successfully added to your cart (every item)", text: "Successfully added to your cart: {qty} {item}.", vars: ["qty", "item"] }, // Nov 25, 2026, 2:02 PM: no date, no item number
  second_laser: { group: "Booking by item (key 1)", label: "Box 25, laser tag: To add another, press 1 (while another set is free)", text: "To add another, press 1." },
  second_paddle: { group: "Booking by item (key 1)", label: "Box 25, paddle boats: To add a second one, press 1", text: "To add a second one, press 1." },
  stay_on_line: { group: "Booking by item (key 1)", label: "Shared: Otherwise, stay on the line (add-on offers)", text: "Otherwise, stay on the line." },
  box25_keep: { group: "Booking by item (key 1)", label: "Box 25: keep shopping (every item)", text: "To keep shopping, for same day, press 1. For another day, press 2." },
  // Jumping balloons list (Nov 19, 2026, replaces box 153): the opening, then one line per balloon, then the cart line
  // Jumping balloon list (Abraham, Nov 22, 2026): each balloon = 3 fixed recordings: name, full item number, "press N."
  balloon_name_7201: { group: "Booking by item (key 1)", label: "Jumping balloons list: Soft Hop, name", text: "For the Soft-Hop," },
  balloon_num_7201: { group: "Booking by item (key 1)", label: "Jumping balloons list: Soft Hop, item number", text: "item seven two zero one" },
  balloon_name_7202: { group: "Booking by item (key 1)", label: "Jumping balloons list: Sunlight Spot, name", text: "For the Sunlight-Spot," },
  balloon_num_7202: { group: "Booking by item (key 1)", label: "Jumping balloons list: Sunlight Spot, item number", text: "item seven two zero two" },
  balloon_name_7203: { group: "Booking by item (key 1)", label: "Jumping balloons list: Blue Bounce, name", text: "For the Blue-Bounce," },
  balloon_num_7203: { group: "Booking by item (key 1)", label: "Jumping balloons list: Blue Bounce, item number", text: "item seven two zero three" },
  balloon_name_7204: { group: "Booking by item (key 1)", label: "Jumping balloons list: Ball Buster, name", text: "For the Ball-Buster," },
  balloon_num_7204: { group: "Booking by item (key 1)", label: "Jumping balloons list: Ball Buster, item number", text: "item seven two zero four" },
  balloon_name_7205: { group: "Booking by item (key 1)", label: "Jumping balloons list: Rising Joy, name", text: "For the Rising-Joy," },
  balloon_num_7205: { group: "Booking by item (key 1)", label: "Jumping balloons list: Rising Joy, item number", text: "item seven two zero five" },
  balloon_name_7206: { group: "Booking by item (key 1)", label: "Jumping balloons list: Family Fun, name", text: "For the Family-Fun," },
  balloon_num_7206: { group: "Booking by item (key 1)", label: "Jumping balloons list: Family Fun, item number", text: "item seven two zero six" },
  balloon_name_7207: { group: "Booking by item (key 1)", label: "Jumping balloons list: Adventure Zone, name", text: "For the Adventure-Zone," },
  balloon_num_7207: { group: "Booking by item (key 1)", label: "Jumping balloons list: Adventure Zone, item number", text: "item seven two zero seven" },
  balloon_name_7208: { group: "Booking by item (key 1)", label: "Jumping balloons list: Wide Slide, name", text: "For the Wide-Slide," },
  balloon_num_7208: { group: "Booking by item (key 1)", label: "Jumping balloons list: Wide Slide, item number", text: "item seven two zero eight" },
  balloon_name_7209: { group: "Booking by item (key 1)", label: "Jumping balloons list: Amusing Obstacle, name", text: "For the Amusing-Obstacle," },
  balloon_num_7209: { group: "Booking by item (key 1)", label: "Jumping balloons list: Amusing Obstacle, item number", text: "item seven two zero nine" },
  balloon_name_7210: { group: "Booking by item (key 1)", label: "Jumping balloons list: Mega Mountain, name", text: "For the Mega-Mountain," },
  balloon_num_7210: { group: "Booking by item (key 1)", label: "Jumping balloons list: Mega Mountain, item number", text: "item seven two one zero" },
  balloon_name_7211: { group: "Booking by item (key 1)", label: "Jumping balloons list: Wheel Thrill, name", text: "For the Wheel-Thrill," },
  balloon_num_7211: { group: "Booking by item (key 1)", label: "Jumping balloons list: Wheel Thrill, item number", text: "item seven two one one" },
  balloon_name_7212: { group: "Booking by item (key 1)", label: "Jumping balloons list: Bounce Blast, name", text: "For the Bounce-Blast," },
  balloon_num_7212: { group: "Booking by item (key 1)", label: "Jumping balloons list: Bounce Blast, item number", text: "item seven two one two" },
  balloon_key_1: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 1", text: "press 1." },
  balloon_key_2: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 2", text: "press 2." },
  balloon_key_3: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 3", text: "press 3." },
  balloon_key_4: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 4", text: "press 4." },
  balloon_key_5: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 5", text: "press 5." },
  balloon_key_6: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 6", text: "press 6." },
  balloon_key_7: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 7", text: "press 7." },
  balloon_key_8: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 8", text: "press 8." },
  balloon_key_9: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 9", text: "press 9." },
  balloon_key_10: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 10", text: "press 10." },
  balloon_key_11: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 11", text: "press 11." },
  balloon_key_12: { group: "Booking by item (key 1)", label: "Jumping balloons list: press 12", text: "press 12." },
  // Laser tag item list (box 13b, Abraham, Nov 22, 2026): no opening line; then the shared cart and star lines
  laser_item_1: { group: "Booking by item (key 1)", label: "Laser tag list, key 1", text: "For the inflatable maze with a six-pack of laser guns, press 1." },
  laser_item_2: { group: "Booking by item (key 1)", label: "Laser tag list, key 2", text: "For the inflatable maze with a four-pack of laser guns, press 2." },
  laser_item_3: { group: "Booking by item (key 1)", label: "Laser tag list, key 3", text: "For a six-pack of laser guns without the maze, press 3." },
  laser_item_4: { group: "Booking by item (key 1)", label: "Laser tag list, key 4", text: "For a four-pack of laser guns without the maze, press 4." },
  balloons_open: { group: "Booking by item (key 1)", label: "Jumping balloons list: opening", text: "Here are our jumping balloons. Please note, our jumping balloons are not for water use." },
  // Laser tag and paddle boats lists (Nov 19, 2026): openings not final; slots only, not on the live line yet
  laser_open: { group: "Booking by item (key 1)", label: "Laser tag list: opening", text: "Here are our laser tag sets." },
  paddle_open: { group: "Booking by item (key 1)", label: "Paddle boat list: opening", text: "Here are our paddle boat packages." },
  box153: { group: "Booking by item (key 1)", label: "Box 153: jumping balloons menu (replaced by the new list, Nov 19)", text: "For Soft Hop, item seven two zero one, press 1. For Sunlight Spot, item seven two zero two, press 2. For Blue Bounce, item seven two zero three, press 3. For Ball Buster, item seven two zero four, press 4. For Rising Joy, item seven two zero five, press 5. For Family Fun, item seven two zero six, press 6. For Adventure Zone, item seven two zero seven, press 7. For Wide Slide, item seven two zero eight, press 8. For Amusing Obstacle, item seven two zero nine, press 9. For Mega Mountain, item seven two one zero, press 1 0. For Bounce Blast, item seven two one one, press 1 1. For Wheel Thrill, item seven two one two, press 1 2. To go back, press star." },
  box154: { group: "Booking by item (key 1)", label: "Box 154: jumping balloon chosen", text: "{item}, item {number}, {price}. To add it to your shopping cart, press 1. For description and dimensions, press 2.", vars: ["item", "number", "price"] },
  box155: { group: "Booking by item (key 1)", label: "Box 155: balloon description (from the Catalog) and dimensions", text: "{description} The {item} measures {length} feet long, {width} feet wide, and {height} feet tall. To add it to your shopping cart, press 1.", vars: ["description", "item", "length", "width", "height"] }, // approved Nov 18, 2026
  // Box 156 (Abraham, Nov 19, 2026, approved): before payment, only when the customer has a discount from the Owner
  box156: { group: "Checkout", label: "Box 156: discount applied (only when the customer has a discount)", text: "The total of your order is {amount}. We are happy to let you know that a discount of {discount} has been applied to your order. Your new total is {newtotal}.", vars: ["amount", "discount", "newtotal"] },
  book_date_entered: { group: "Booking by item (key 1)", label: "Confirm the date", text: "You entered {date}.", vars: ["date"] }, // Nov 23, 2026: ends with the shared Confirm ending (no pound to continue)
  // Abraham, Nov 15, 2026: unfinished cart from the last call (drafts for his OK)
  // Welcome back (Abraham, Nov 17, 2026), his wording: approved. {items} = "one Castle and one Laser tag set for Tuesday, December 22"
  resume_offer: { group: "Booking by item (key 1)", label: "Welcome back: last call's unfinished cart", text: "Welcome back! On your last call you had in your cart {items} for {date}. To check if they are still available, press 1. To start a new order, press 2.", vars: ["items", "date"] },
  // Item taken, whole phone system (Abraham, Nov 17, 2026), his wording
  // Item booked, whole system (Nov 19, 2026): replaces the bigger and smaller size screen
  // Item taken (Abraham, Nov 19, 2026, 10:25 PM): ONE prompt for the whole phone system, also when someone just booked the
  // last one while the caller was choosing. Then the shared cart line and the shared star line.
  // Abraham's approved line (Nov 27, 2026, 12:01 AM): one recording, no changing parts
  item_not_available: { group: "Booking by item (key 1)", label: "Item taken (whole phone system, one recording)", text: "Sorry, that item is not available on that day. To hear the closest sizes, press 1. To hear the nearest days for this item, press 2." },
  item_taken: { group: "Booking by item (key 1)", label: "Old item-taken line (replaced by item_not_available, Nov 27, 2026)", text: "We are sorry, the {item} is no longer available for {date}. To check the closest available {category} on the same date, press 1. For the nearest available date, press 2.", vars: ["item", "date", "category"] },
  // Key 2 on item taken: NOT APPROVED yet (draft for Abraham), on preview only; the live line goes to the date prompt
  // Item taken, nearest options (Abraham, Nov 25, 2026, 8:08 PM). Waiting for his OK on the wording: until then the
  // live voice says this exact text (the feature works now); recordings go in these slots
  taken_size_down: { group: "Booking by item (key 1)", pending: true, label: "Item taken, key 1: the next size down", text: "For the next size down, the {item}, press 1.", vars: ["item"] },
  taken_size_up: { group: "Booking by item (key 1)", pending: true, label: "Item taken, key 1: the next size up", text: "For the next size up, the {item}, press 2.", vars: ["item"] },
  taken_day_before: { group: "Booking by item (key 1)", pending: true, label: "Item taken, key 2: the day before", text: "The {item} is available on {date}, the day before. To choose that day, press 1.", vars: ["item", "date"] },
  taken_day_after: { group: "Booking by item (key 1)", pending: true, label: "Item taken, key 2: also the day after", text: "It is also available on {date}, the day after. To choose that day, press 2.", vars: ["date"] },
  taken_day_after_only: { group: "Booking by item (key 1)", pending: true, label: "Item taken, key 2: only the day after", text: "The {item} is available on {date}, the day after. To choose that day, press 2.", vars: ["item", "date"] },
  taken_nearest_before: { group: "Booking by item (key 1)", pending: true, label: "Item taken, key 2: the nearest date before", text: "The nearest date before your date is {date}. To choose it, press 1.", vars: ["date"] },
  taken_nearest_after: { group: "Booking by item (key 1)", pending: true, label: "Item taken, key 2: the nearest date after", text: "The nearest date after your date is {date}. To choose it, press 2.", vars: ["date"] },
  nearest_date: { group: "Booking by item (key 1)", label: "Item taken, key 2: the nearest available date (NOT APPROVED yet)", text: "The {item} is available on {date}. To book it for that date, press 1. Otherwise, please pick another date.", vars: ["item", "date"], pending: true },

  // Date & quantity
  date_prompt: { group: "Date & quantity", label: "Ask for the party date", text: "What day is your party? Just say the date, like November 8th. Or type the month and day on your keypad. For November 8th, that is 1, 1, 0, 8." },
  date_past: { group: "Date & quantity", label: "Date already passed", text: "The date you picked has already passed. Please pick another date." },
  date_too_far: { group: "Date & quantity", label: "Date too far ahead", text: "We can book with you right now for the next three months. Please pick another date." },
  date_unclear: { group: "Date & quantity", label: "Did not understand the date", text: "Sorry, I did not get that date. Please try that again." },
  date_confirm_day: { group: "Date & quantity", label: "Confirm the date (whole rental day, delivery and pickup times)", text: "Got it, {date}! We will deliver that day between 9 AM and noon, and pick up on {pickup}. Please have the rental outside your door by 9 AM that morning. If that is right, press pound to continue. To pick a different date, press 1.", vars: ["date", "pickup"] },
  sold_out: { group: "Date & quantity", label: "Item booked up", text: "Oh no, the {item} is all booked up on {date}.", vars: ["item", "date"] },
  sold_out_options_cart: { group: "Date & quantity", label: "Booked-up options (has cart)", text: "To look at other rentals, press 1. To hear your cart, press 9." }, // star line approved Nov 18, 2026
  sold_out_options: { group: "Date & quantity", label: "Booked-up options (no cart)", text: "To try a different date, press 1. To look at other rentals, press 2." }, // star line approved Nov 18, 2026
  only_some_left: { group: "Date & quantity", label: "Fewer left than asked", text: "Oh, only {count} are left for that date.", vars: ["count"] },
  just_booked: { group: "Date & quantity", label: "Someone just booked it", text: "Oh no, someone just grabbed the last {item} for that date.", vars: ["item"] },

  // Cart
  // Item added, whole phone system (Abraham, Nov 17, 2026), his wording
  item_added: { group: "Cart", label: "Item added to cart (every time)", text: "This item is successfully added to your cart." },
  keep_shopping: { group: "Cart", label: "After an item is added: keep shopping or the cart", text: "To keep shopping, press 1." },
  another_day: { group: "Cart", label: "After an item is added: book another day (Abraham)", text: "To book another day, press 2." },
  // Ocean balls after every jumping balloon (Abraham, Nov 17, 2026), his wording ("#" is said as pound)
  // Ocean balls v2 (Abraham, Nov 25, 2026, 14:08-14:12): once per call after the first jumping balloon, 9 opens the
  // amounts menu; the cart offers it while a balloon is in the cart. Each line its own slot.
  ocean_offer: { group: "Cart", label: "Ocean balls: offer after the first jumping balloon of the call", text: "To add ocean balls, press 9." },
  ocean_200: { group: "Cart", label: "Ocean balls menu: 200 balls", text: "To add 200 balls for $10, press 1." },
  ocean_500: { group: "Cart", label: "Ocean balls menu: 500 balls", text: "To add 500 balls for $15, press 2." },
  ocean_700: { group: "Cart", label: "Ocean balls menu: 700 balls", text: "To add 700 balls for $20, press 3." },
  cart_ocean: { group: "Cart", label: "Cart: add ocean balls (while a jumping balloon is in the cart)", text: "To add ocean balls, press 9." },
  ocean_balls: { group: "Cart", label: "Ocean balls (after every jumping balloon)", text: "Would you like to add ocean balls? To add 200 balls for $10, press 1. To add 500 balls for $15, press 2. To add 700 balls for $20, press 3." }, // then the shared skip line (Nov 19, 2026)
  // The one shared skip recording (Abraham, Nov 19, 2026): after every add-on offer with a skip
  skip_pound: { group: "Cart", label: "Shared: skip (after ocean balls, laser guns, delivery directions, promo texts)", text: "To skip, press pound." },
  // Laser tag extra packs (Abraham, Nov 17, 2026): offered after a maze or guns, like ocean balls. Approved word for word.
  // Abraham, Nov 24, 2026: add ocean balls from the cart. DRAFT wording (Abraham approves the exact text, Hark records it)
  cart_add_balls: { group: "Cart", label: "Cart: add ocean balls (draft, waiting for Abraham's wording)", text: "To add ocean balls, press 5.", pending: true },
  // Laser tag extra gun sets (Abraham, Nov 25, 2026, 14:06 and 14:41): after the 1st extra set, then after the 2nd
  laser_second_set: { group: "Cart", label: "Box 25b: after the first extra gun set (key 1 = one more of the same)", text: "To add a second one, press 1." },
  laser_third_set: { group: "Cart", label: "Box 25b: after the second extra gun set, the third at half price (the price is said between the two pieces)", text: "To add a third gun set for half price, only {price}, press 1.", vars: ["price"] },
  // Key 9 "add another laser set" (Abraham, Nov 26, 2026, approved word for word): right after any laser set is added
  lset_nomaze_second_6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 1. Without maze: second six-pack", text: "To add a second six-pack of laser guns for $110, press 9." },
  lset_nomaze_second_4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 2. Without maze: second four-pack", text: "To add a second four-pack of laser guns for $75, press 9." },
  lset_nomaze_third_6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 3. Without maze: third six-pack, half price", text: "To add a third six-pack of laser guns for half price, only $55, press 9." },
  lset_nomaze_third_4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 4. Without maze: third four-pack, half price", text: "To add a third four-pack of laser guns for half price, only $37.50, press 9." },
  lset_nomaze_second_no6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 5. Without maze, second set: six-packs sold out, a four-pack instead", text: "We have no more six-packs to add for that day. To add a four-pack of laser guns for $75, press 9." },
  lset_nomaze_second_no4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 6. Without maze, second set: four-packs sold out, a six-pack instead", text: "We have no more four-packs to add for that day. To add a six-pack of laser guns for $110, press 9." },
  lset_nomaze_third_no6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 7. Without maze, third set: six-packs sold out, a four-pack at half price", text: "We have no more six-packs to add for that day. To add a four-pack of laser guns for half price, only $37.50, press 9." },
  lset_nomaze_third_no4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 8. Without maze, third set: four-packs sold out, a six-pack at half price", text: "We have no more four-packs to add for that day. To add a six-pack of laser guns for half price, only $55, press 9." },
  lset_maze_second_6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 9. With maze: second six-pack", text: "To add a second six-pack of laser guns for $75, press 9." },
  lset_maze_second_4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 10. With maze: second four-pack", text: "To add a second four-pack of laser guns for $50, press 9." },
  lset_maze_third_6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 11. With maze: third six-pack, half price", text: "To add a third six-pack of laser guns for half price, only $37.50, press 9." },
  lset_maze_third_4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 12. With maze: third four-pack, half price", text: "To add a third four-pack of laser guns for half price, only $25, press 9." },
  lset_maze_second_no6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 13. With maze, second set: six-packs sold out, a four-pack instead", text: "We have no more six-packs to add for that day. To add a four-pack of laser guns for $50, press 9." },
  lset_maze_second_no4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 14. With maze, second set: four-packs sold out, a six-pack instead", text: "We have no more four-packs to add for that day. To add a six-pack of laser guns for $75, press 9." },
  lset_maze_third_no6: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 15. With maze, third set: six-packs sold out, a four-pack at half price", text: "We have no more six-packs to add for that day. To add a four-pack of laser guns for half price, only $25, press 9." },
  lset_maze_third_no4: { group: "Laser tag extra sets (key 9)", label: "Box 25 laser offer 16. With maze, third set: four-packs sold out, a six-pack at half price", text: "We have no more four-packs to add for that day. To add a six-pack of laser guns for half price, only $37.50, press 9." },
  laser_packs: { group: "Cart", label: "Laser guns add-on (only right after an inflatable maze is added)", text: "Would you like to add more laser guns? To add a six-pack laser tag for $75, press 1. To add a four-pack laser tag for $50, press 2." }, // Nov 19, 2026: only after an inflatable maze; then the shared skip line
  added: { group: "Cart", label: "Item added to cart", text: "Woohoo! I added {items} to your cart for {date}. It is saved just for you while we are on the phone.", vars: ["items", "date"] },
  after_add: { group: "Cart", label: "After adding", text: "To keep shopping, press 1. To check out, press 9." },
  cart_empty: { group: "Cart", label: "Cart is empty (0 in an item list; then the same list again)", text: "Your shopping cart is empty right now. Let's start shopping!" }, // "Let's": Abraham's one approved short form (Nov 22, 2026)
  bounce_water_note: { group: "Cart", label: "Before a bounce house is added (Abraham, Phone Menu v3)", text: "Please note, our bounce houses are not for water use." },
  checkout_tax_note: { group: "Cart", label: "Before checkout (Abraham, Phone Menu v3)", text: "Taxes will be calculated after checkout." },
  cart_summary: { group: "Cart", label: "Cart summary", text: "Here is your cart: {items}, for {date}. Your rental total is {total}, plus delivery and sales tax.", vars: ["items", "date", "total"] },
  // Key 1 booking, several days on one call (Abraham, Nov 8, 2026). day_choice and cart_key are Abraham's exact lines.
  day_choice: { group: "Cart", label: "After an item: same day or another day (Abraham)", text: "For the same day, press 1. For another day, press 2." },
  cart_key: { group: "Cart", label: "Shared cart line: every booking step before the cart or checkout (not after row 11)", text: "To go to your shopping cart, press 0." },
  cart_intro: { group: "Cart", label: "Cart: opening line", text: "Here is your cart." },
  // The cart (Abraham, Nov 19 and 22, 2026): "For {date}, {Qnt} {item}, and {Qnt} {item}." one line per rental day
  cart_day: { group: "Cart", label: "Cart: one rental day (each item with its number; and before the second item on)", text: "For {date}, {items}.", vars: ["date", "items"] },
  cart_total: { group: "Cart", label: "Cart: rental total", text: "Your rental total is {total}, plus delivery and sales tax.", vars: ["total"] },
  cart_options: { group: "Cart", label: "Cart options (then the shared star line; no cart line)", text: "To check out, press 1. To keep shopping, press 2. To remove an item from your cart, press 3. To refresh your cart and start over, press 4." },
  // Remove an item (box 29b and 29a, Abraham, Nov 22, 2026)
  remove_count_one: { group: "Cart", label: "Remove an item: one item in the cart (You have in your cart, then the shared piece one, item)", text: "You have in your cart one, item.", parts: ["remove_count#1", "piece:one_item"] },
  remove_count: { group: "Cart", label: "Remove an item: how many items", text: "You have in your cart {amount} items.", vars: ["amount"] },
  remove_item: { group: "Cart", label: "Remove an item: one line per item", text: "To remove the {item}, press {key}.", vars: ["item", "key"] },
  remove_item_date: { group: "Cart", label: "Remove an item: the same item on two days (with its date)", text: "To remove {item} for {date}, press {key}.", vars: ["item", "date", "key"] },
  remove_qty: { group: "Cart", label: "Remove an item: more than one of it", text: "You have {qty} {item}.", vars: ["qty", "item"] },
  remove_enter: { group: "Cart", label: "Remove an item: how many to remove", text: "Using your keypad, please enter the amount you would like to remove." },
  removed: { group: "Cart", label: "Item removed", text: "Successfully removed from your cart: {qty} {item} for {date}.", vars: ["qty", "item", "date"] },
  cart_updated: { group: "Cart", label: "Item removed: the updated cart (then the cart from its date line)", text: "Here is your updated cart." },
  cart_cleared: { group: "Cart", label: "Cart emptied (cart key 4: the cart was just cleared)", text: "Your cart has been cleared. It is now empty. Let's start shopping." }, // Abraham, Nov 26, 2026, 11:32 PM; words Nov 27, 12:01 AM
  cart_expired: { group: "Cart", label: "Cart timed out", text: "Sorry, your cart timed out. Let us start again." },

  // Checkout
  ask_name: { group: "Checkout", label: "Ask for name", text: "Let us complete your booking. Please say your first and last name after the tone." }, // Abraham, Nov 24, 2026 (approved, word for word)
  ask_address: { group: "Checkout", label: "Ask for address", text: "Thanks! Now please say the delivery address, with the house number, street, and town." },
  // Delivery address in steps (Abraham, Nov 17, 2026; replaces the single address question, box 32). Step 1 and the
  // retry line are approved; steps 2 to 7 are drafts: the steps run on preview only until he approves them.
  addr_street: { group: "Checkout", label: "Address step 2 - street name (say it after the tone; then type_hint)", text: "Please say the street name of the delivery address after the tone." }, // Abraham, Nov 24, 2026: then type_hint (9 types it, star goes back)
  retry_spoken: { group: "Checkout", label: "Any spoken answer not understood (approved; the step's own line is not repeated)", text: "Sorry, we did not catch that. Please try again." },
  addr_house: { group: "Checkout", label: "Address step 1 - house number", text: "Now, with your keypad, please enter the house number." },
  pound_done: { group: "Checkout", label: "Shared - When you are done, press pound", text: "When you are done, press pound." },
  // The street step (Abraham, Nov 24, 2026, final): search the street by voice or keypad in the zip's street list
  addr_street_menu: { group: "Checkout", label: "Address street step - voice or keypad search", text: "To search for the street name by voice, press 1. To search it with your keypad, press 2." },
  street_keys_intro: { group: "Checkout", label: "Street keypad search - first four letters (draft)", text: "Please enter the first four letters of the street name, then press pound.", pending: true },
  street_pick_item: { group: "Checkout", label: "Street keypad search - one of several streets (draft)", text: "For {street}, press {key}.", vars: ["street", "key"], pending: true },
  street_none: { group: "Checkout", label: "Street keypad search - no street found (draft)", text: "We could not find a street that starts with those letters. To try again, press 1. To search by voice, press 2.", pending: true },
  // Unit question for an address not in the directory (Abraham, Nov 24, 2026, 8:38 PM, approved)
  addr_unit_ask: { group: "Checkout", label: "Unit question (address not in the directory): has a unit, press 1; not, press 2", text: "If this address has a unit number, press 1. If not, press 2." },
  addr_unit: { group: "Checkout", label: "Address step 3 - unit number", text: "Thanks, with your keypad, please enter the unit number." },
  addr_unit_skip: { group: "Checkout", label: "Address step 3 - no unit, press pound to skip", text: "If there is no unit number, press pound to skip." },
  addr_zip: { group: "Checkout", label: "Slot C - Zip menu, all towns, press 1 to 7 (one take)", text: "For Monroe, New York, one zero nine five zero, press 1. For Highland Mills, New York, one zero nine three zero, press 2. For Chester, New York, one zero nine one eight, press 3. For Washingtonville, New York, one zero nine nine two, press 4. For Central Valley, New York, one zero nine one seven, press 5. For Harriman, New York, one zero nine two six, press 6. To enter a different zip code, press 7." },
  addr_zip_enter: { group: "Checkout", label: "Address step 4: enter a zip code", text: "Please enter the 5-digit zip code. When you are finished, please press pound." },
  addr_zip_bad: { group: "Checkout", label: "Address step 4: zip code not valid", text: "The zip code you entered is not valid. Please try again." },
  addr_outside: { group: "Checkout", label: "Address step 5 - outside service area", text: "We are sorry, we do not deliver to this area. We deliver only in Orange County, New York. To enter a different zip code, press 1." },
  addr_not_found: { group: "Checkout", label: "Address step 5: address not found (back to the house number)", text: "We are sorry, we could not find that address. Please try again." },
  // Step 6 (Abraham, Nov 22, 2026, final): the address is read live between the recorded lines
  // Phone-number address lookup (Abraham, Nov 23, 2026, approved): on preview until he approves the test call
  lookup_intro: { group: "Checkout", label: "Lookup screen 1: Next, we need the delivery address.", text: "Next, we need the delivery address." },
  lookup_options: { group: "Checkout", label: "Lookup screen 1: the three choices", text: "To look it up with the number you are calling from, press 1. To look it up with a different phone number, press 2. To enter the address manually, press 3." },
  lookup_hold: { group: "Checkout", label: "Lookup: Please hold a moment while we look up the address.", text: "Please hold a moment while we look up the address." },
  lookup_phone_enter: { group: "Checkout", label: "Lookup: enter a 10-digit phone number", text: "Please enter a 10-digit phone number, starting with the area code." },
  phone_invalid: { group: "Checkout", label: "Lookup: phone number not valid", text: "The phone number you entered is not valid. Please try again." },
  lookup_one: { group: "Checkout", label: "Lookup found: Here is the name and address we found for this phone number.", text: "Here is the name and address we found for this phone number." },
  lookup_many: { group: "Checkout", label: "Slot A - Shared number found: Here is what we found for this phone number.", text: "Here is what we found for this phone number." },
  lookup_for: { group: "Checkout", label: "Shared number found: For {last name}, {first name}, before each family (the name is said live)", text: "For {name},", vars: ["name"] },
  lookup_many_options: { group: "Checkout", label: "Slot B - Shared number found, one take: To try a different phone number, press 3. To enter the address manually, press 4.", text: "To try a different phone number, press 3. To enter the address manually, press 4." },
  lookup_press: { group: "Checkout", label: "Lookup found (shared number): press {key} after each family", text: "press {key}.", vars: ["key"] },
  lookup_try: { group: "Checkout", label: "Lookup: To try a different phone number, press {key}", text: "To try a different phone number, press {key}.", vars: ["key"] },
  lookup_manual: { group: "Checkout", label: "Lookup: To enter the address manually, press {key}", text: "To enter the address manually, press {key}.", vars: ["key"] },
  lookup_none: { group: "Checkout", label: "Lookup not found: We could not find an address for this phone number.", text: "We could not find an address for this phone number." },
  addr_rb_intro: { group: "Checkout", label: "Address step 6 - Here is the address you entered", text: "Here is the address you entered." },
  addr_rb_address: { group: "Checkout", label: "Address step 6 - the address (live: house, street, unit, town New York, zip)", text: "{address}.", vars: ["address"] },
  addr_rb_correct: { group: "Checkout", label: "Address step 6 - If that is correct, press 1", text: "If that is correct, press 1." },
  addr_rb_again: { group: "Checkout", label: "Address step 6 - To enter the address again, press 2", text: "To enter the address again, press 2." },
  addr_price: { group: "Checkout", label: "Step 7 - Delivery to {town} is {price}", text: "Delivery to {town} is {price}.", vars: ["town", "price"] },
  addr_saved: { group: "Checkout", label: "Step 7 - Thank you. Your delivery address has been saved.", text: "Thank you. Your delivery address has been saved." },
  // Abraham, Nov 15, 2026: optional directions for the driver after the address (drafts for his OK)
  // Box 34 (Abraham, Nov 21, 2026, 23:26 and 23:27; Nov 24, 20:51): delivery instructions as a recorded message
  box34_menu: { group: "Checkout", label: "Box 34: delivery instructions menu", text: "To add any special delivery instructions, press 1. To skip, press pound. To go back, press star." },
  box34_record: { group: "Checkout", label: "Box 34 after key 1: leave the message after the tone (then the shared pound_done line)", text: "Please leave a clear and detailed message with all your delivery instructions after the tone." },
  box34_thanks: { group: "Checkout", label: "Box 34 after pound: saved", text: "Thank you. We have saved your delivery instructions." },
  // Abraham, Nov 25, 2026, 12:08: its own short line after box 34, right before box 56 (not part of box 35)
  almost_done: { group: "Checkout", label: "After box 34, right before box 56", text: "Almost done!" },
  // Box 35 (Abraham, Nov 25, 2026, 11:51): after a paid phone card payment, right after box 148 (no star on this screen)
  box35_receipt: { group: "Pay by card (Sola PhonePay)", label: "Box 35: receipt by email, after the payment is approved (1 = the email steps, pound = skip)", text: "To receive a receipt by email, press 1. To skip, press pound." },
  // Menu 2 (Abraham, Nov 24, 2026, 20:56): one line right after the address is confirmed; town and price are live parts
  addr_saved_price: { group: "Checkout", label: "Menu 2: address saved, delivery to {town} is {price}", text: "Your delivery address has been saved, delivery to {town} is {price}.", vars: ["town", "price"] },
  ask_directions: { group: "Checkout", label: "Ask for delivery directions (optional)", text: "Is there anything our delivery team should know, like a gate code, where to park, or where to set up? Please say it now.", pending: true },
  directions_saved: { group: "Checkout", label: "Delivery directions saved", text: "Thank you, we saved that for our delivery team.", pending: true },
  // Abraham, Nov 15, 2026: payment can never be skipped; no texts and no email means the email is required
  ask_email_required: { group: "Checkout", label: "Ask for email (required: no texts)", text: "To send your secure payment link, we need your email address. Please say your email address, like john at gmail dot com." },
  ask_email: { group: "Checkout", label: "Ask for email", text: "Almost done! Please say your email address for your receipt, like john at gmail dot com. Or press pound to skip." },
  // Call recording notice (Abraham O): PROPOSED wording, not approved yet; plays only if the Owner turns recording on.
  recording_notice: { group: "Welcome & main menu", label: "Call recording notice (after the greeting; plays only when call recording is on)", text: "This call may be monitored or recorded for quality and training purposes." },
  // Keypad typing (Abraham L; proposed wording approved under P, Nov 8, 2026)
  // Abraham, Nov 17, 2026: every question that asks for information ends with this; pound ends the answer. Approved
  // with "please" added.
  press_pound_done: { group: "Checkout", label: "After every information question: press pound when finished", text: "When you are finished, please press pound." },
  type_hint: { group: "Checkout", label: "Typing: how to switch (after every spoken question)", text: "To type it with your keypad, press 9." }, // Abraham, Nov 24, 2026
  type_instructions: { group: "Checkout", label: "Typing: how to type", text: "Press 2 once for A, twice for B, three times for C, and so on for all keys. If two letters in a row use the same key, press star between them. To type a number, press the key one more time. To go back, press star twice. Press 0 once for a space, and twice for number 0. Press 1 once for number 1, twice for a dot, three times for a dash, and four times for an underscore. When you are finished, press the pound key." }, // Abraham, Nov 24, 2026, word for word (the one decoder: multitap.ts)
  type_email_symbols: { group: "Checkout", label: "Typing: email symbols", text: "For a dot, press 1 once. For the at sign, press 1 twice." },
  typed_back: { group: "Checkout", label: "Typing: read back", text: "You typed: {value}.", vars: ["value"] }, // Nov 23, 2026: ends with the shared Confirm ending (no pound to continue)
  heard: { group: "Checkout", label: "Read back what we heard", text: "I heard: {value}.", vars: ["value"] }, // Nov 23, 2026: ends with the shared Confirm ending (no pound to continue)
  // ONE shared did-not-catch line (Abraham, Nov 22, 2026): name, address, email, keypad typing, catalog email part
  field_unclear: { group: "Checkout", label: "Shared: did not catch it (name, address, email, typing, catalog email)", text: "Sorry, I did not catch that. Let's try again." },
  email_unclear: { group: "Checkout", label: "Didn't catch the email", text: "Sorry, I could not quite catch that email. Let us try that again." },
  email_skip: { group: "Checkout", label: "Skipping email", text: "No problem, we will skip the email." },
  field_trouble: { group: "Checkout", label: "Having trouble hearing", text: "I am having a little trouble hearing you." },
  phone_confirm: { group: "Checkout", label: "Confirm texting number", text: "We will text your secure payment link to the number you are calling from, ending in {last4}. Press 1 to use this number, or 2 to enter a different one.", vars: ["last4"] },
  phone_enter: { group: "Checkout", label: "Type a cell number", text: "Sure thing! Please type your 10 digit cell phone number, starting with the area code." },
  phone_bad: { group: "Checkout", label: "Bad phone number", text: "Hmm, that does not look like a 10 digit number. Let us try again." },
  // Box 48 (Abraham, Nov 25, 2026): "We have {number}." (digits one at a time), then the box 144 ending recording
  phone_heard: { group: "Checkout", label: "Box 48: We have {number} (then: If that is correct, press 1. To enter a different number, press 2.)", text: "We have {number}.", vars: ["number"] },
  thanks_order: { group: "Checkout", label: "Order placed", text: "You are all set, {name}! Your order number is {number}.", vars: ["name", "number"] },
  link_sent: { group: "Checkout", label: "Payment link texted (Abraham, Nov 13, 2026)", text: "We just texted you a secure payment link. Your party rentals are saved for {minutes} minutes while you pay. After that, they go back into stock, and you will need to book them again.", vars: ["minutes"] },
  link_failed: { group: "Checkout", label: "Couldn't text the link", text: "We could not send the text, so someone from our team will call you back shortly to finish up." },
  goodbye_order_days: { group: "Checkout", label: "Old goodbye after ordering several days (no longer played after payment, Nov 26, 2026)", text: "We will deliver and pick up on the days you chose. Thanks so much for choosing Hup Up Attractions. Have an amazing party, bye for now!" },
  goodbye_order: { group: "Checkout", label: "Old goodbye after ordering (no longer played after payment, Nov 26, 2026)", text: "We will deliver on {date} and pick up on {pickup}. Thanks so much for choosing Hup Up Attractions. Have an amazing party, bye for now!", vars: ["date", "pickup"] },

  // Text message consent (A2P 10DLC). The exact text spoken is stored with every consent record.
  // Box 49 (Abraham, Nov 24, 2026): the only line; key 1 agrees, no key 2, no long disclosure (the first text carries it)
  consent_transactional: {
    group: "Text message consent",
    label: "Box 49: text updates about your reservation (press 1)",
    text: "To receive text updates to your phone number, about your reservation, press 1.",
  },
  consent_tx_thanks: {
    group: "Text message consent",
    label: "Box 49 after key 1: thank you (the number is spoken between the two recordings)",
    text: "Thank you. You will get text updates about your reservation, to {number}. Message and data rates may apply.",
    vars: ["number"],
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
    text: "One more question. Would you like promotional text messages from Hup Up Attractions at this number: seasonal offers, discount codes, and rental deals, up to 5 per calendar year? If you say yes, we will text you a confirmation, and you will be signed up only after you reply YES to that text within 24 hours. Agreeing is never required to book or buy. Message and data rates may apply. You can reply NOPROMO to stop promos, STOP to stop all texts, or HELP for help, at any time. To get the confirmation text, press 1. To skip, press 2.",
  },
  consent_marketing_sent: {
    group: "Text message consent",
    label: "Promotional confirmation text sent (SMS v3)",
    text: "Thank you. We just texted you a confirmation. Reply YES to that text within 24 hours to sign up for promotional texts.",
  },
  // Promo texts by phone, keys only (Abraham, Nov 10, 2026): replaces consent_marketing_v2, which is no longer played.
  // Abraham, Nov 26, 2026 (approved): asked after a paid order, before the goodbye; 1 = promotional texts only
  // Abraham, Nov 26, 2026, 15:00 ET (exact words, recording approved): replaces the earlier Line 8 (no pound key any more)
  paid_promo_offer: { group: "Promo texts by phone (keys only)", label: "After payment, Line 8 (step 1): seasonal offers by text. 1 signs up; any other key or no key moves on to the goodbye", text: "To stay informed, join our seasonal offers by text. You will never miss a deal, a special, or a new rental, with up to 5 messages a year. To sign up, press 1. To stop, you can reply stop at any time." },
  // Abraham, Nov 26, 2026, 15:00 ET (exact words, recording approved): after the number is chosen, then Line 7
  promo_joined: { group: "Promo texts by phone (keys only)", label: "After payment, Line 8 (step 3): joined the seasonal offers (then Line 7 and the call ends)", text: "You have now joined our seasonal offers! You will stay informed about new rentals and special deals. Thank you!" },
  // Box 30, the cart hold ran out (Abraham, Nov 26, 2026, 13:11 ET, approved word for word; Puck until recorded)
  cart_hold_check: { group: "Checkout", label: "Box 30: cart hold ran out, a caller with items who stopped responding (any key = keep the items, back to the same step)", text: "It sounds like we got disconnected. To keep the items in your cart, press any key to continue." },
  cart_hold_released: { group: "Checkout", label: "Box 30: no key, the items are released (then the two goodbye pieces)", text: "The items in your cart will now be released. You can call us back at any time." },
  goodbye_thanks_calling: { group: "Checkout", label: "Goodbye before payment, piece 1 (a cut of the main-menu greeting)", text: "Thank you for calling Hup Up Attractions" },
  goodbye_bye_for_now: { group: "Checkout", label: "Goodbye before payment, piece 2", text: "Bye for now!" },
  disconnect_check: { group: "Checkout", label: "Disconnect check: a caller with items in the cart was silent (any key = back to the same step; no key = the disconnect line and the call ends)", text: "It sounds like we got disconnected. To continue, press any key." },
  disconnect_goodbye: { group: "Checkout", label: "After payment, Line 7: the last line of a paid call, after Line 8 (never on silent or dropped calls)", text: "We look forward serving you again. You can call us back at any time. Thank you for choosing Hup Up Attractions! Bye for now!" },
  promo_ask: { group: "Promo texts by phone (keys only)", label: "Step 1: after the order", text: "To get seasonal offers, discounts, and deals by text, up to 5 a year, press 1." },
  promo_which: { group: "Promo texts by phone (keys only)", label: "Step 2: which number", text: "To get texts at the number you are calling from, press 1. To use a different phone number, press 2." },
  promo_enter: { group: "Promo texts by phone (keys only)", label: "Step 3: enter a number", text: "Please enter the 10-digit mobile number. When you are finished, please press pound." },
  promo_heard: { group: "Promo texts by phone (keys only)", label: "Step 3: read the number back", text: "You entered {number}.", vars: ["number"] }, // Nov 23, 2026: ends with the shared Confirm ending (no pound to continue)
  promo_bad: { group: "Promo texts by phone (keys only)", label: "Step 3: not 10 digits", text: "Sorry, that number did not work. Please try again." },
  promo_final: { group: "Promo texts by phone (keys only)", label: "Final line", text: "Thanks! We just sent a text. Reply YES within 24 hours to finish signing up." },
  promo_disclosure: { group: "Promo texts by phone (keys only)", label: "Disclosure line (right after the Final line)", text: "Message and data rates may apply, and you are signed up only after you reply YES to our confirmation text." },
  consent_unclear: { group: "Text message consent", label: "Didn't understand the answer", text: "Sorry, I did not get that. Please press 1 for yes, or 2 for no." },
  consent_stopped: { group: "Text message consent", label: "Number replied STOP before", text: "This number has opted out of our messages. To get messages again, text the word START to 8 4 5 4 1 5 7 5 8 5." }, // approved Nov 24, 2026, 8:38 PM (one recording)
  // Lookup screen 1, key 4 (Abraham, Nov 25, 2026: approved and recorded); NOT on the menu yet, what it does is pending
  lookup_hall: { group: "Checkout", label: "Lookup screen 1: key 4 hall line (not on the menu yet)", text: "To find an address for a hall, press 4." },
  consent_marketing_yes: { group: "Text message consent", label: "Signed up for promotional texts", text: "Thank you, you are signed up for promotional texts. We just texted you a confirmation." },
  consent_marketing_no: { group: "Text message consent", label: "Said no to promotional texts", text: "No problem, you will not get promotional texts." },
  // No booking on Shabbes or Yom Tov (Abraham, Nov 14, 2026): the day and time booking opens again
  // The whole hotline on Shabbes and Yom Tov (Abraham, Nov 14, 2026, choice A): drafts for his OK; then the tone, general voicemail
  // Abraham, Nov 26, 2026, 11:51 PM (words approved Nov 27, 12:05 AM): the booking cut-off before Shabbes, in 3 parts:
  // piece 1 (slot shabbes_cutoff_saved#1), the saved-until clock time from the number recordings (time only, no
  // date), piece 2 (slot shabbes_cutoff_saved#2). It ends the call (no other goodbye after it).
  shabbes_cutoff_saved: { group: "Welcome & main menu", label: "Shabbes cut-off, items saved (piece 1, the time, piece 2; ends the call)", text: "Shabbes is starting soon, so we cannot finish your booking right now. We will save your items until one hour after Shabbes, Saturday night, at {time} PM. Please call us back right after Shabbes to finish your order. Thank you for calling Hup Up Attractions, a good Shabbes.", vars: ["time"] },
  closed_shabbos_greeting: { group: "Welcome & main menu", label: "Whole hotline on Shabbes: closed greeting (approved Nov 16)", text: "Thank you for calling Hup Up Attractions. We are closed now for Shabbes, and we will be open again on {day} at {time}. Please leave your name, phone number, and a short message after the tone, and we will call you back after Shabbes. Good Shabbes!", vars: ["day", "time"] },
  closed_yomtov_greeting: { group: "Welcome & main menu", label: "Whole hotline on Yom Tov: closed greeting (approved Nov 16)", text: "Thank you for calling Hup Up Attractions. We are closed now for Yom Tov, and we will be open again on {day} at {time}. Please leave your name, phone number, and a short message after the tone, and we will call you back after Yom Tov. Good Yom Tov!", vars: ["day", "time"] },
  // Main menu key 7 (Abraham, Nov 26, 2026): the customer service hours with Friday, instead of the office hours
  key7_cs_hours: { group: "Welcome & main menu", label: "Main menu key 7: customer service hours with Friday", text: "Our customer service is open Sunday through Thursday, from 11 AM to 2 PM, and at night from 7:30 PM to 10:30 PM. Friday, from 10:30 AM till chatzos." },
  office_closed: { group: "Welcome & main menu", label: "Office closed (after the greeting, only when the office is closed; also key 7)", text: "Our office is closed right now, but you can still book anytime using our automated system." },
  // Abraham, Nov 27, 2026, 12:19 AM: same-day bookings. Draft wording (Abraham is confirming; Hark records): waits for
  // approval on the live line
  same_day_closed: { group: "Date & quantity", label: "Today asked after the same-day cut-off (draft, waiting for Abraham)", text: "Sorry, it is too late to book for today. Please pick another date.", pending: true },
  same_day_notice: { group: "Date & quantity", label: "Same-day delivery notice (draft, waiting for Abraham)", text: "Please note, a same-day delivery may take longer, about two and a half to three and a half hours. If you need it sooner, please contact customer service, or after hours leave a message, and we will try our best.", pending: true },
  date_closed: { group: "Date & quantity", label: "Chosen date is a closed day (no offer: the day before or after is closed too)", text: "Sorry, we are closed on {date} for {reason}. Let us pick another date.", vars: ["date", "reason"] },
  // Abraham, Nov 20, 2026: a closed day with the day before and the day after both open (then the date prompt and back line)
  // Box 17, closed day (Abraham, Nov 22, 2026): played as recorded pieces with the live parts between them
  closed_day_intro: { group: "Date & quantity", label: "Box 17: We are closed on {date} for {reason}", text: "We are closed on {date} for {reason}.", vars: ["date", "reason"] },
  closed_day_get: { group: "Date & quantity", label: "Box 17: get it the day before", text: "You can get it the day before, on {before}, and keep it until {after}, at 9:00 AM, for a total of {price}.", vars: ["before", "after", "price"] },
  closed_book_it: { group: "Date & quantity", label: "Box 17: To book it, press 1", text: "To book it, press 1." },
  closed_pick_another: { group: "Date & quantity", label: "Box 17: To pick another date, press 2", text: "To pick another date, press 2." },
  // Box 18, confirm the date (Abraham, Nov 22, 2026): recorded pieces; off the line until the second-day rules are in
  box18_book: { group: "Date & quantity", label: "Box 18: To book the {item} for {date} press 1", text: "To book the {item} for {date}, press 1.", vars: ["item", "date"] },
  box18_second: { group: "Date & quantity", label: "Box 18: To add it also for {weekday} for only {price} more, press 2", text: "To add it also for {weekday}, for only {price} more, press 2.", vars: ["weekday", "price"] },
  box18_other_date: { group: "Date & quantity", label: "Box 18: To choose a different date, press 3", text: "To choose a different date, press 3." },
  address_outside_area: { group: "Checkout", label: "Address outside the delivery area", text: "Sorry, we only deliver in Kiryas Joel and nearby Orange County towns. Please say a delivery address in our area." },
  address_not_found: { group: "Checkout", label: "Address not found on the map", text: "Sorry, we could not find that address. Please say the full address again: the house number, the street, and the town.", pending: true },
  // Box 56 (Abraham, Nov 24, 2026, 21:02, approved): order number, total, the breakdown by rental type, then the hold line
  checkout_order_number: { group: "Checkout", label: "Your order number is {number} (not played before payment: the order number is said only after the payment is approved, Abraham)", text: "Your order number is {number}.", vars: ["number"] },
  checkout_total: { group: "Checkout", label: "Box 56: Your total is {total}", text: "Your total is {total}.", vars: ["total"] },
  checkout_includes: { group: "Checkout", label: "Box 56: That includes {amount} {type} (once per rental type), {delivery} for delivery, and {tax} sales tax", text: "That includes {amount} {type}, {delivery} for delivery, and {tax} sales tax.", vars: ["amount", "type", "delivery", "tax"] },
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
  pay_card_line: { group: "Pay by card (Sola PhonePay)", label: "Box 140: card line (no key: the hold line, then the payment line; 0: a payment link)", text: "If you would like to pay by credit or debit card, please stay on the line. To receive a payment link instead, press 0." }, // approved Nov 24, 2026
  pay_link_how: { group: "Pay by card (Sola PhonePay)", label: "Box 141: payment link by text or email", text: "To receive the payment link by text, press 1. To receive by email, press 2." },
  pay_link_sent: { group: "Pay by card (Sola PhonePay)", label: "Box 146: payment link sent", text: "Done! We just sent you the payment link. To keep your booking, please complete your payment within the next ten minutes. Otherwise, the booking will be released. Thank you for calling Hup Up Attractions!" },
  // Box 56's last line (Abraham, Nov 25, 2026, approved): one recording, right before the secure payment line
  pay_hold_secure: { group: "Pay by card (Sola PhonePay)", label: "Box 56: connecting to the secure payment line", text: "We will now connect you to our secure payment line. All card information is processed securely and directly by our provider, to ensure your card details remain private and protected. This may take a few moments. Please stay on the line while we connect you. Once your payment has been processed, please remain on the line to receive your booking confirmation." },
  phonepay_back: { group: "Pay by card (Sola PhonePay)", label: "Back from the payment line", text: "Thank you. Let us finish your order." }, // approved Nov 14 ("Let's", spelled out by the standing rule)
  phonepay_paid: { group: "Pay by card (Sola PhonePay)", label: "Payment found", text: "Your payment was received. You are all set!" }, // approved Nov 14 ("You're", spelled out)
  phonepay_not_found: { group: "Pay by card (Sola PhonePay)", label: "Payment not found", text: "We could not confirm your payment yet. We will send you a secure payment link, and our team will call you back if needed." }, // approved Nov 14 (spelled out)
  phonepay_third_decline: { group: "Pay by card (Sola PhonePay)", label: "Third decline on a call (not active yet)", text: "Not active yet: Abraham will send this line.", pending: true }, // Nov 18, 2026: wording to come; the approved "card did not go through" line plays until then
  phonepay_blocked: { group: "Pay by card (Sola PhonePay)", label: "Card payment blocked for this number (not active yet)", text: "Not active yet: Abraham will send this line.", pending: true }, // Nov 18, 2026: wording to come; the caller gets the payment link until then
  // Box 148 (Abraham, Nov 25, 2026, 00:29): no name; four recordings around the order number (one digit at a time)
  phonepay_approved: { group: "Pay by card (Sola PhonePay)", label: "After payment, Line 1: payment approved and the order number (the order number is spoken only here, after the payment is approved)", text: "Thank you! Your payment was approved, and your booking is confirmed. Your order number is {number}.", vars: ["number"] },
  // Abraham dictated Nov 25, 2026, 4:43 PM; held until he approves the exact words (5:50 PM): not played yet
  pay_approved_dates: { group: "Pay by card (Sola PhonePay)", label: "After payment, Line 2: delivery and pickup dates (piece 1 is Line 2a, piece 2 is Line 2b; the dates are spoken by the system)", text: "We will deliver on {date} and pick up on {pickup}.", vars: ["date", "pickup"] },
  // Abraham, Nov 26, 2026, 01:28 ET (approved): right after the dates line, only when it plays
  pay_approved_pickup_note: { group: "Pay by card (Sola PhonePay)", label: "After payment, Line 3: rental ready outside by 9 AM for pickup", text: "Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup." },
  phonepay_approved_star: { group: "Pay by card (Sola PhonePay)", label: "After payment, line 3: star replays lines 1 and 2 (about 3 seconds for a key)", text: "To hear it again, press star." },
  // Hark for Abraham, Nov 26, 2026, 3:56 PM ET (exact words, recordings already made): line 5 and its sub-menu
  pay_confirm_offer: { group: "Pay by card (Sola PhonePay)", label: "After payment, line 5: confirmation and receipt by text or email (no wait: key 1 works while it plays, else straight on)", text: "To get your confirmation and receipt by text or email, press 1." },
  pay_confirm_how: { group: "Pay by card (Sola PhonePay)", label: "After payment, line 5 sub-menu: 1 text, 2 email, 3 both (then the number or email steps)", text: "For text, press 1. For email, press 2. For both, press 3." },
  pay_texted_receipt: { group: "Pay by card (Sola PhonePay)", label: "After payment, line 5 for callers signed up for text updates (no wait: key 1 = the receipt by email)", text: "We have texted you your order confirmation. To get your receipt by email, press 1." },
  phonepay_approved_text: { group: "Pay by card (Sola PhonePay)", label: "After payment, Line 5a: confirmation by text (callers signed up for order texts; 1 = a different number)", text: "We will text your confirmation to the number you are calling from. To send it to a different number, press 1." },
  phonepay_approved_bye: { group: "Pay by card (Sola PhonePay)", label: "Old after-payment closing (removed Nov 26, 2026; no longer played)", text: "We look forward to serving you again. Thank you for choosing Hup Up Attractions!" },
  // Abraham, Nov 25, 2026, 12:22 (approved): box 148 for callers not signed up for order texts, in place of part B2
  pay_approved_optin: { group: "Pay by card (Sola PhonePay)", label: "After payment, Line 5b: order texts sign-up (callers not signed up for order texts; 1 = sign up the calling number)", text: "To receive your confirmation and order updates by text, press 1." },
  phonepay_approved_join: { group: "Pay by card (Sola PhonePay)", label: "Box 148: confirmation and order updates by text (callers who did not agree to texts; draft)", text: "To receive your confirmation and order updates by text, press 1.", pending: true },
  phonepay_unclear: { group: "Pay by card (Sola PhonePay)", label: "Box 147: payment could not be confirmed", text: "Sorry, we could not confirm your payment. To try again, press 1." }, // approved Nov 18, 2026 (box 147)
  phonepay_retry: { group: "Pay by card (Sola PhonePay)", label: "Card did not go through (tries 1 to 4)", text: "We are sorry, your card did not go through. To try again, press 1." }, // approved Nov 15
  phonepay_retry_last: { group: "Pay by card (Sola PhonePay)", label: "Card did not go through (try 5, last chance)", text: "We are sorry, your card did not go through. You have one more chance. To try again, press 1." }, // approved Nov 15
  phonepay_failed: { group: "Pay by card (Sola PhonePay)", label: "Card did not go through (try 6, call ends)", text: "We are sorry, we were not able to process your card at this time. Please call us back later to complete your order, or you can contact customer service at extension 3 from the main menu. Thank you for calling Hup Up Attractions. Goodbye." }, // approved Nov 15
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
  // Full voicemail by phone (Abraham, Nov 23, 2026): wording approved for the computer voice; Hark records after his y
  vm_box_number: { group: "Voicemail", label: "Full voicemail: enter the box number", text: "Please enter your box number, then press pound." },
  vm_password: { group: "Voicemail", label: "Full voicemail: enter the password", text: "Please enter your password, then press pound." },
  vm_password_wrong: { group: "Voicemail", label: "Full voicemail: wrong password", text: "That password is not correct. Please try again." },
  vm_counts: { group: "Voicemail", label: "Full voicemail: new and saved messages", text: "You have {new} new messages and {saved} saved messages.", vars: ["new", "saved"] },
  vm_main: { group: "Voicemail", label: "Full voicemail: main menu", text: "For new messages, press 1. To send a message, press 2. For saved messages, press 3. For greetings, press 4. For personal options, press 5. For deleted messages, press 6. To exit, press star." },
  vm_shared_key: { group: "Voicemail", label: "Full voicemail: the shared boxes (new line, waiting for Abraham's y)", text: "For the shared voicemail boxes, press 8." },
  vm_shared_menu: { group: "Voicemail", label: "Full voicemail: a shared box (new line, waiting for Abraham's y)", text: "For new messages, press 1. For saved messages, press 3. For deleted messages, press 6." },
  vm_goodbye: { group: "Voicemail", label: "Full voicemail: goodbye", text: "Goodbye." },
  vm_header: { group: "Voicemail", label: "Full voicemail: before each message", text: "Message received {date}, at {time}, from {from}.", vars: ["date", "time", "from"] },
  vm_during: { group: "Voicemail", label: "Full voicemail: keys during a message (once, as the first message starts)", text: "During a message: to go back 5 seconds, press 1. To pause, press 2. To go forward 5 seconds, press 3. To hear the date and number again, press 5. To erase, press 7. To save, press 9. To skip to the end, press pound." },
  vm_paused: { group: "Voicemail", label: "Full voicemail: paused", text: "Paused. To continue, press 2." },
  vm_after: { group: "Voicemail", label: "Full voicemail: after a message", text: "To replay, press 4. For the date and number, press 5. To forward, press 6. To erase, press 7. To reply, press 8. To save, press 9. To keep it as new, press pound." },
  vm_msg_saved: { group: "Voicemail", label: "Full voicemail: message saved", text: "Message saved." },
  vm_msg_erased: { group: "Voicemail", label: "Full voicemail: message erased", text: "Message erased." },
  vm_msg_kept: { group: "Voicemail", label: "Full voicemail: kept as new", text: "Message kept as new." },
  vm_no_more: { group: "Voicemail", label: "Full voicemail: no more messages", text: "You have no more messages." },
  vm_fwd_menu: { group: "Voicemail", label: "Full voicemail: forward", text: "To forward to another voicemail box, press 1. To forward by email, press 2." },
  vm_for_key: { group: "Voicemail", label: "Full voicemail: one box or person in a list", text: "For {name}, press {key}.", vars: ["name", "key"] },
  vm_note_offer: { group: "Voicemail", label: "Full voicemail: forward, add a note", text: "To add a recorded note before the message, press 1. Otherwise, stay on the line." },
  vm_note_record: { group: "Voicemail", label: "Full voicemail: record the note", text: "Please record your note after the tone. When you are finished, press pound." },
  vm_forwarded: { group: "Voicemail", label: "Full voicemail: forwarded", text: "Message forwarded." },
  vm_reply_menu: { group: "Voicemail", label: "Full voicemail: reply", text: "To reply with a voice message, press 1. To call the caller back, press 2." },
  vm_callback_off: { group: "Voicemail", label: "Full voicemail: call back not available", text: "Calling back is not available yet." },
  vm_reply_none: { group: "Voicemail", label: "Full voicemail: no voice reply for an outside caller", text: "This message did not come from a voicemail box, so a voice reply is not available." },
  vm_choose_box: { group: "Voicemail", label: "Full voicemail: send, choose a box", text: "Please choose a box." },
  vm_record_msg: { group: "Voicemail", label: "Full voicemail: record a message", text: "Please record your message after the tone. When you are finished, press pound." },
  vm_send_review: { group: "Voicemail", label: "Full voicemail: send review", text: "To send it, press 1. To listen to it, press 2. To record it again, press 3." },
  vm_msg_sent: { group: "Voicemail", label: "Full voicemail: sent", text: "Message sent." },
  vm_canceled: { group: "Voicemail", label: "Full voicemail: canceled", text: "Message canceled." },
  vm_deleted_count: { group: "Voicemail", label: "Full voicemail: deleted messages", text: "You have {count} deleted messages. They are kept for 30 days.", vars: ["count"] },
  vm_deleted_after: { group: "Voicemail", label: "Full voicemail: after a deleted message", text: "To restore this message to saved messages, press 9. To erase it forever, press 7. For the next message, press pound." },
  vm_erase_confirm: { group: "Voicemail", label: "Full voicemail: erase forever, confirm", text: "To erase this message forever, press 7 again." },
  vm_restored: { group: "Voicemail", label: "Full voicemail: restored", text: "Message restored." },
  vm_erased_forever: { group: "Voicemail", label: "Full voicemail: erased forever", text: "Message erased forever." },
  vm_greet_menu: { group: "Voicemail", label: "Full voicemail: greetings", text: "To listen to your greeting, press 1. To record a personal greeting, press 2. To use the standard greeting, press 3." },
  vm_greet_record: { group: "Voicemail", label: "Full voicemail: record a greeting", text: "Please record your greeting after the tone. When you are finished, press pound." },
  vm_review: { group: "Voicemail", label: "Full voicemail: greeting and name review", text: "To keep it, press 1. To listen to it, press 2. To record it again, press 3." },
  vm_greet_saved: { group: "Voicemail", label: "Full voicemail: greeting saved", text: "Your greeting is saved." },
  vm_greet_standard: { group: "Voicemail", label: "Full voicemail: standard greeting chosen", text: "You are now using the standard greeting." },
  vm_no_greeting: { group: "Voicemail", label: "Full voicemail: no personal greeting yet (new line, waiting for Abraham's y)", text: "You do not have a personal greeting." },
  vm_personal: { group: "Voicemail", label: "Full voicemail: personal options", text: "To change your password, press 1. To record your name, press 2. To turn new message alerts on or off, press 3." },
  vm_newpin: { group: "Voicemail", label: "Full voicemail: new password", text: "Please enter a new password of 4 to 8 digits, then press pound." },
  vm_newpin_again: { group: "Voicemail", label: "Full voicemail: new password again", text: "Please enter the same password again, then press pound." },
  vm_newpin_nomatch: { group: "Voicemail", label: "Full voicemail: passwords did not match", text: "The passwords did not match. Please try again." },
  vm_newpin_saved: { group: "Voicemail", label: "Full voicemail: password changed", text: "Your password is changed." },
  vm_name_record: { group: "Voicemail", label: "Full voicemail: record your name", text: "Please say your name after the tone, then press pound." },
  vm_name_saved: { group: "Voicemail", label: "Full voicemail: name saved (new line, waiting for Abraham's y)", text: "Your name is saved." },
  vm_alerts_on: { group: "Voicemail", label: "Full voicemail: alerts on", text: "New message alerts are now on." },
  vm_alerts_off: { group: "Voicemail", label: "Full voicemail: alerts off", text: "New message alerts are now off." },
  vm_not_valid: { group: "Voicemail", label: "Full voicemail: wrong key", text: "Sorry, that is not a valid selection. Please try again." },
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
  catalog_menu: { group: "Catalog (key 8)", label: "Text or email", text: "To receive our catalog by text, press 1. To get it by email, press 2." },
  // Every phone flow that texts the caller (payment link, key 8 catalog, promo texts): boxes 142 to 144 (Abraham,
  // Nov 17, 2026), approved word for word. They replace the old key 8 lines. The caller's number is never read out.
  text_which: { group: "Texts to the caller (every flow)", label: "Box 142: which number", text: "To text it to the number you are calling from, press 1. To enter a different number, press 2." },
  text_enter: { group: "Texts to the caller (every flow)", label: "Box 143: enter a different number", text: "Please enter the 10-digit phone number. When you are finished, please press pound." },
  text_heard: { group: "Texts to the caller (every flow)", label: "Box 144: read the number back", text: "I have {number}. If that is correct, press 1. To enter a different number, press 2.", vars: ["number"] },
  catalog_text_which: { group: "Catalog (key 8)", label: "Text: which number", text: "We will text it to the number you are calling from. To use this number, press 1. To enter a different number, press 2." },
  catalog_text_enter: { group: "Catalog (key 8)", label: "Text: enter a number", text: "Please enter the 10-digit phone number, then press pound." },
  catalog_text_heard: { group: "Catalog (key 8)", label: "Text: read the number back", text: "I have {number}.", vars: ["number"] }, // Nov 23, 2026: ends with the shared Confirm ending (no pound to continue)
  catalog_texted: { group: "Catalog (key 8)", label: "Text: done", text: "Done! We just texted you our catalog. Thank you for calling Hup Up Attractions!" },
  catalog_text_not_yet: { group: "Catalog (key 8)", label: "Text: the text could not be sent (email instead)", text: "Sorry, we cannot send it by text just yet. Let us send it by email instead." },
  catalog_email_info: { group: "Catalog (key 8)", label: "Email: send us an empty email (plays once the info@ auto-reply is on)", text: "You can also send us an empty email to info at hup up attractions dot com, with the subject Catalog, and we will send it right back to you." },
  catalog_email_local: { group: "Catalog (key 8)", label: "Email step 1: the first part", text: "Please enter the first part of your email address, up to the at symbol. To type it, start pressing keys on your keypad now. To say it, wait for the tone, then say it letter by letter. When you are finished, please press pound." },
  // Box 103 (Abraham, Nov 22, 2026; recorded by Hark, 10 percent faster): every time a caller types an email on the keypad
  catalog_keypad_help: { group: "Catalog (key 8)", label: "Email: keypad directions (when the caller starts typing; every email typed on the keypad, in every flow)", text: "Press a key once for the first letter, twice for the second letter, and three times for the third letter. Example, to type letter C, press 2 three times. To type a number, press it one more time after the last letter. Example, to type number 7, press 7 five times. For 0, press 0 once. For number 1, press 1 once. For a dot, press 1 twice. For a dash, press 1 three times. For an underscore, press 1 four times. If the next letter is on the same key, wait one second first. To go back one letter, press star one time. When you are done, press pound, or you can hang up." },
  // Address typing (Abraham, Nov 22, 2026): the box 103 how-to, the space line, then the pound line
  address_keypad_help: { group: "Checkout", label: "Address: keypad directions", text: "Press a key once for the first letter, twice for the second letter, and three times for the third letter. Example, to type letter C, press 2 three times. To type a number, press it one more time after the last letter. Example, to type number 7, press 7 five times. For 0, press 0 once. For number 1, press 1 once. For a dot, press 1 twice. For a dash, press 1 three times. For an underscore, press 1 four times. If the next letter is on the same key, wait one second first. To go back one letter, press star one time. To add a space between words, press star twice. When you are done, press pound, or you can hang up." },
  catalog_got: { group: "Catalog (key 8)", label: "Email: read back what we got", text: "We got {letters}. To continue, press pound. To start over, press 1. To add more, press 2.", vars: ["letters"] },
  catalog_ending: { group: "Catalog (key 8)", label: "Email: choose the ending", text: "Now choose the ending. For at gmail dot com, press 1. For at outlook dot com, press 2. For at yahoo dot com, press 3. For at icloud dot com, press 4. For a different ending, press 5." },
  catalog_domain: { group: "Catalog (key 8)", label: "Email: a different ending", text: "Please give us the ending, after the at symbol. To type it, start pressing keys now. To say it, wait for the tone. When you are finished, please press pound." },
  catalog_final: { group: "Catalog (key 8)", label: "Email: final check", text: "Your email address is {email}.", vars: ["email"] }, // Nov 23, 2026: ends with the shared Confirm ending (no pound to continue)
  // Box 108a (Abraham, Nov 25, 2026, Batch 2): after the final check, before the catalog is sent
  box108a_ask: { group: "Catalog (key 8)", label: "Box 108a: save the email with the phone number", text: "To save this email address with your phone number, press 1. To skip, press pound." },
  box108a_saved: { group: "Catalog (key 8)", label: "Box 108a after key 1: saved", text: "Thank you. Your email address has been saved." },
  catalog_emailed: { group: "Catalog (key 8)", label: "Email: done", text: "We just emailed you our catalog! Check your inbox for a variety of attractions and endless fun for your entire family." },
  catalog_main_star: { group: "Catalog (key 8)", label: "Email: done, star for the main menu", text: "To go to the main menu, press star." },
  catalog_bye: { group: "Catalog (key 8)", label: "Email: done, goodbye", text: "Thank you for calling Hup Up Attractions! Bye for now!" },
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
    // Nov 23, 2026: the read-back, then the shared Confirm ending (1 confirms, 2 says it again)
    text: "We got {text}.",
    vars: ["text"],
  },

  // Staff announcement when a staff phone answers (Abraham). Each extension can still have its own in Phone settings.
  staff_whisper: { group: "Ringing staff", label: "Staff hear when they answer (extensions with a number)", text: "Call from Hup Up Attractions, extension {number}, {name}. Press 1 to accept, or press 2 to reject.", vars: ["number", "name"] },
  staff_whisper_no_number: { group: "Ringing staff", label: "Staff hear when they answer (Schools and Corporate, no extension number)", text: "Call from Hup Up Attractions, {name} extension. Press 1 to accept, or press 2 to reject.", vars: ["name"] },

  // Texts and emails the phone system sends (Abraham, Nov 13, 2026: every word on this page)
  msg_catalog_text: { group: "Texts and emails", message: true, label: "Catalog by text (key 8 and Admin)", text: "Hup Up Attractions: Here is our {Catalog Name}! You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1." }, // approved Nov 18, 2026; {Catalog Name} from Admin, Catalog email & text
  msg_catalog_email_subject: { group: "Texts and emails", message: true, label: "Catalog email: subject (key 8 and info@ Catalog)", text: "Hup Up Attractions catalog" },
  msg_catalog_email_top: { group: "Texts and emails", message: true, label: "Catalog email: before the list of rentals", text: "Thank you for your interest in Hup Up Attractions!\n\nHere is our catalog:" },
  msg_catalog_email_bottom: { group: "Texts and emails", message: true, label: "Catalog email: after the list of rentals", text: "See our rentals: hupupattractions.com/#rentals\nTo book, call (845) 777-7585." },
  msg_payment_link_subject: { group: "Texts and emails", message: true, label: "Payment link email: subject", text: "Hup Up Attractions order #{number}", vars: ["number"] },
  msg_payment_link: { group: "Texts and emails", message: true, label: "Payment link (text and email) after a phone order", text: "Hup Up Attractions order #{number}: {items}. Rentals ${rentals} + delivery ${delivery} + sales tax ${tax} = total ${total}. Pay securely within {minutes} minutes to confirm: {link}", vars: ["number", "items", "rentals", "delivery", "tax", "total", "minutes", "link"] },
  msg_receipt_subject: { group: "Texts and emails", message: true, label: "Receipt email after a phone payment: subject", text: "Hup Up Attractions receipt for order #{number}", vars: ["number"] },
  msg_receipt_body: { group: "Texts and emails", message: true, label: "Receipt email after a phone payment", text: "{greeting}\n\nThank you for your payment! Here is your receipt.\n\nOrder number: {number}\nPaid on: {paid_on}\nAmount: ${amount}\nCard: ending in {last4}\n\nYour rentals are booked. If you have any questions, call us at (845) 777-7585 or reply to this email.\n\nHup Up Attractions\nhupupattractions.com", vars: ["greeting", "number", "paid_on", "amount", "last4"] },
  msg_payment_received: { group: "Texts and emails", message: true, label: "Payment received (one rental day; text, and email for website payments)", text: "Hup Up Attractions: payment received for order #{number}. You are all set for {date}! We will deliver that day and pick up {pickup}.", vars: ["number", "date", "pickup"] },
  msg_payment_received_days: { group: "Texts and emails", message: true, label: "Payment received (several rental days)", text: "Hup Up Attractions: payment received for order #{number}. You are all set for {dates}! We will deliver and pick up on the days you chose.", vars: ["number", "dates"] },
  // The first text after a phone consent (Abraham, Nov 24, 2026): ends with the required disclosure and the terms link
  msg_first_text_footer: { group: "Texts and emails", message: true, label: "Added to the first text after texting consent", text: "Msg frequency varies. Msg and data rates may apply. Reply STOP to opt out, HELP for help. Terms: {link}", vars: ["link"] },
  msg_terms_link: { group: "Texts and emails", message: true, label: "Terms and Conditions link by text (during checkout)", text: "Hup Up Attractions Terms and Conditions: {link}", vars: ["link"] },
} satisfies Record<string, PromptDef>;

/** Old lines no longer played anywhere (kept so nothing is lost; shown as "Not used"). */
// Hark's audit items 12 and 14 (Nov 24, 2026): lines no step plays any more were still shown as Live
export const RETIRED_PROMPTS = new Set<string>(["book_note", "book_corporate", "box153", "no_input", "idle_warning", "only_some_left", "day_choice", "item_taken", "addr_rb_again", "type_email_symbols", "email_unclear", "thanks_order", "consent_unclear", "attraction_menu_back", "menu_category", "menu_empty", "retry_spoken", "addr_readback", "resume_added", "instr_intro", "menu_cart", "menu_operator", "menu_speech", "menu_repeat", "category_intro", "back_to_menu", "book_intro", "date_prompt", "date_confirm_day", "sold_out", "sold_out_options_cart", "sold_out_options", "after_add", "cart_summary", "consent_marketing_sent", "consent_marketing_yes", "consent_marketing_no", "transfer_failed", "menu_voicemail", "voicemail_offer", "voicemail_prompt", "voicemail_thanks", "voicemail_none", "catalog_text_which", "catalog_text_enter", "catalog_text_heard", "phonepay_link_option", "phone_confirm", "phone_enter", "phone_bad", "ask_email", "ask_email_required", "email_skip", "link_sent", "link_emailed", "link_emailed_consented", "link_call_back", "promo_enter", "promo_heard", "cart_expired", "addr_unit_skip", "ask_directions", "directions_saved", "addr_price", "addr_saved", "vma_charge_amount", "vma_charge_readback", "vma_charge_bad", "address_outside_area", "phonepay_approved_join", "phonepay_back", "ocean_balls", "cart_add_balls", "instr_laser", "automated_only", "nearest_date", "laser_second_set", "second_laser", "laser_third_set", "laser_packs", "whole_hours", "whole_pay_approved_text", "whole_pay_approved_optin"]);

/** The extension (or part of the call) each group of lines belongs to, for the Admin filter. New groups fall into "Other". */
export const PROMPT_AREAS: Record<string, string> = {
  "Welcome & main menu": "Main menu",
  "Whole menus (one recording each)": "Whole menus (one recording each)",
  "Errors & retries": "Wrong key, hold and timeouts",
  "Booking by item (key 1)": "Key 1: Bookings",
  "Laser tag extra sets (key 9)": "Key 1: Bookings",
  Browsing: "Key 1: Bookings",
  "Date & quantity": "Key 1: Bookings",
  Cart: "Key 1: Bookings",
  Checkout: "Key 1: Bookings",
  "Text message consent": "Key 1: Bookings",
  "Promo texts by phone (keys only)": "Key 1: Bookings",
  "Pay by keypad": "Key 1: Bookings",
  "Pay by card (Sola PhonePay)": "Key 1: Bookings",
  "Key 2: Instructions": "Key 2: Instructions",
  "Key 6: Learn about our rentals": "Key 6: Learn about our rentals",
  "Talk to a person": "Keys 0, 3, 4, 5 and Schools: ringing staff",
  "Ringing staff": "Keys 0, 3, 4, 5 and Schools: ringing staff",
  "Catalog (key 8)": "Key 8: Catalog",
  "Texts to the caller (every flow)": "Texts to the caller (every flow)",
  Voicemail: "Voicemail (every box) and Key 9",
  "Texts and emails": "Texts and emails",
};
export const promptArea = (group: string) => PROMPT_AREAS[group] ?? "Other";

export type PromptKey = keyof typeof PROMPTS;
export type PromptOverride = { text: string | null; audioUrl: string | null; recordingId?: number | null; approvedAt?: Date | null; googleRecordingId?: number | null; lineSet?: string | null };

/**
 * The fingerprint of a combined recording's lines (Hark's review 2, item 1): each line in order with its approved
 * words and its recording. Saved when the combined recording is put on the line; if it no longer matches, the lines
 * changed and the separate lines play instead.
 */
export function lineSetFingerprint(id: string, overrides: PromptOverrides): string {
  const parts = MENU_COMBOS[id] ?? [];
  const desc = parts.map((ref) => {
    if (!(ref in PROMPTS)) return ref;
    const o = overrides[ref as PromptKey];
    return `${ref}=${(o?.text?.trim() || PROMPTS[ref as PromptKey].text).replace(/\s+/g, " ")}#${o?.recordingId ?? ""}`;
  });
  let h = 5381;
  const str = desc.join("|");
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return `v1:${parts.length}:${h.toString(36)}`;
}

/** Is the combined recording still made for these lines? An older one with no fingerprint keeps playing (as before). */
export function wholeCurrent(id: string, overrides: PromptOverrides): boolean {
  const saved = overrides[`whole_${id}` as PromptKey]?.lineSet;
  return !saved || saved === lineSetFingerprint(id, overrides);
}
export type PromptOverrides = Partial<Record<PromptKey, PromptOverride>>;

export async function loadPromptOverrides(): Promise<PromptOverrides> {
  try {
    const rows0 = await db.select().from(schema.voicePrompts);
    // Nov 25, 2026 (stray numbers on the live line): a slot plays only a finished upload made FOR THAT SLOT and put on
    // the line with "Use this one". Anything else (another slot's file, an unfinished upload) is ignored here.
    const inUse = rows0.map((r) => r.recordingId).filter((x): x is number => Boolean(x));
    const recs = inUse.length
      ? await db.select({ id: schema.promptRecordings.id, key: schema.promptRecordings.promptKey, complete: schema.promptRecordings.complete, source: schema.promptRecordings.source }).from(schema.promptRecordings).where(inArray(schema.promptRecordings.id, inUse))
      : [];
    const okRec = new Map(recs.map((r) => [r.id, r]));
    const rows = rows0.map((r) => {
      const rec = r.recordingId ? okRec.get(r.recordingId) : undefined;
      const good = Boolean(rec && rec.complete && rec.source === "upload" && rec.key === r.key);
      if (r.recordingId && !good) console.warn(`[voice] slot ${r.key} points at recording #${r.recordingId}, which is not a finished upload for that slot: not played`);
      return good ? r : { ...r, recordingId: null };
    });
    const out: PromptOverrides = {};
    for (const r of rows) {
      if (r.key in PROMPTS) out[r.key as PromptKey] = { text: r.text, audioUrl: r.audioUrl, recordingId: r.recordingId, approvedAt: r.approvedAt, lineSet: r.lineSet ?? null };
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
/**
 * A line put together piece by piece (Abraham, Nov 23, 2026: "use ALL uploaded recordings"): every piece with an
 * uploaded recording plays it; only a piece with no recording is said by the live voice. Null when nothing at all is
 * recorded (the line is then said the usual way).
 */
export type LinePiece = { url: string } | { say: string };
/** What a word slot says in the live voice when it has no recording: "word:twenty five" -> "twenty five", "letter:y" -> "y". */
export function slotSpoken(k: string, items: { id: number; name: string }[] = []): string {
  if (k.startsWith("zip:")) return k.slice(4).split("").join(" ");
  // An item's name slot with no recording: the item's name (Nov 25, 2026: it was said as its database id, "23")
  const item = /^item:(\d+)(:plural)?$/.exec(k);
  if (item) {
    const it = items.find((i) => i.id === Number(item[1]));
    if (it) return item[2] ? pluralName(it.name) : it.name;
  }
  return k.replace(/^[a-z]+:/, "").replace(/^(\d+):plural$/, "$1").replace(/_/g, " ");
}
export function composeMixed(overrides: PromptOverrides, key: PromptKey, vars: Record<string, string | number> = {}): LinePiece[] | null {
  const x = EXTRAS.get(overrides);
  if (!x) return null;
  // Abraham, Nov 24, 2026: a one-piece number ("twenty five") is never glued from "twenty" + "five"; with no recording
  // it is said in the live voice (and listed in the call log)
  const clip = (k: string): string[] | null => {
    const id = x.clips[k];
    return id ? [promptRecordingLink(id)] : null;
  };
  const out: LinePiece[] = [];
  const parts0 = (PROMPTS[key] as PromptDef).parts;
  if (parts0) {
    for (const k of parts0) {
      const id = x.clips[PIECE_ALIAS[k] ?? k];
      if (id) out.push({ url: promptRecordingLink(id) });
      else out.push({ say: overrides[k as PromptKey]?.text?.trim() || (PROMPTS as Record<string, { text: string }>)[k]?.text || "" });
    }
  } else {
    const template = overrides[key]?.text?.trim() || PROMPTS[key].text;
    const parts = template.split(/(\{[a-z0-9_]+\})/i).map((p) => p.trim().replace(/^[,;:]\s*/, "")).filter((p) => p && (/^\{/.test(p) || /[a-z]/i.test(p)));
    let piece = 0;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi];
      const v = /^\{([a-z0-9_]+)\}$/i.exec(p);
      if (!v) {
        piece++;
        // A whole recording stands for this word and the value after it (box 154: "item seven two zero one" for
        // "item {number}", Nov 24, 2026): the word is not said twice
        const next = /^\{([a-z0-9_]+)\}$/i.exec(parts[pi + 1] ?? "");
        const whole = next ? vars[`@${next[1]}`] : undefined;
        if (whole && x.clips[String(whole)] && /^[,\s]*item$/i.test(p)) {
          out.push({ url: promptRecordingLink(x.clips[String(whole)]!) });
          pi++; // the value is in that recording
          continue;
        }
        const id = x.clips[PIECE_ALIAS[`${key}#${piece}`] ?? `${key}#${piece}`];
        out.push(id ? { url: promptRecordingLink(id) } : { say: p });
        continue;
      }
      const value = String(vars[v[1]] ?? "");
      const words = wordSlotsFor(value, x.items);
      // Word by word (Abraham, Nov 24, 2026): every word with a recording plays it; only a missing word is said live
      if (words) words.forEach((w) => {
        const u = clip(w);
        if (u) u.forEach((url) => out.push({ url }));
        else out.push({ say: w.startsWith("item:") ? value : slotSpoken(w, x.items) }); // an item: its name as given, never its id
      });
      else if (value.trim()) out.push({ say: value });
    }
  }
  const merged = out.filter((p) => !("say" in p) || p.say.trim());
  return merged.some((p) => "url" in p) ? merged : null;
}

export function composeClips(overrides: PromptOverrides, key: PromptKey, vars: Record<string, string | number> = {}): string[] | null {
  // Nov 22, 2026: Hark's recordings (Puck) put the line together whenever every part is recorded; the Achird switch
  // stays off until every prompt is recorded (Abraham)
  const x = EXTRAS.get(overrides);
  if (!x) return null;
  const parts0 = (PROMPTS[key] as PromptDef).parts;
  if (parts0) {
    const ids = parts0.map((k) => x.clips[PIECE_ALIAS[k] ?? k]);
    return ids.every(Boolean) ? ids.map((id) => promptRecordingLink(id)) : null;
  }
  const template = overrides[key]?.text?.trim() || PROMPTS[key].text;
  const parts = template.split(/(\{[a-z0-9_]+\})/i).map((p) => p.trim().replace(/^[,;:]\s*/, "")).filter((p) => p && (/^\{/.test(p) || /[a-z]/i.test(p)));
  const urls: string[] = [];
  let piece = 0;
  for (const p of parts) {
    const v = /^\{([a-z0-9_]+)\}$/i.exec(p);
    if (!v) {
      piece++;
      const id = x.clips[PIECE_ALIAS[`${key}#${piece}`] ?? `${key}#${piece}`];
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

/** Words said live (numbers, a key) from Hark's word recordings, when the Owner's Achird switch is on and all are recorded. */
/** Hark's recordings for these slot keys, in order; null when any one is missing (then the computer voice says it). */
export function clipUrls(overrides: PromptOverrides, keys: string[]): string[] | null {
  const x = EXTRAS.get(overrides);
  if (!x || !keys.length) return null;
  const ids = keys.map((k) => x.clips[k]);
  return ids.every(Boolean) ? ids.map((id) => promptRecordingLink(id)) : null;
}

/**
 * Any text played word by word from the recordings (Abraham, Nov 24, 2026: Key 7 hours, and every other place that
 * used to say numbers live): each word with a recording plays it; only a missing word is said live (neighbors joined).
 * Null when nothing at all is recorded (the caller says the whole text live).
 */
export function textPieces(overrides: PromptOverrides, text: string): LinePiece[] | null {
  const x = EXTRAS.get(overrides);
  if (!x) return null;
  const words = wordSlotsFor(text, x.items);
  if (!words) return null;
  const out: LinePiece[] = [];
  for (const w of words) {
    const id = x.clips[w];
    if (id) out.push({ url: promptRecordingLink(id) });
    else {
      const last = out[out.length - 1];
      if (last && "say" in last) last.say = `${last.say} ${slotSpoken(w, x.items)}`;
      else out.push({ say: slotSpoken(w, x.items) });
    }
  }
  return out.some((p) => "url" in p) ? out : null;
}

export function liveClips(overrides: PromptOverrides, text: string): string[] | null {
  const x = EXTRAS.get(overrides);
  if (!x) return null;
  const words = wordSlotsFor(text, x.items);
  if (!words) return null;
  const urls: string[] = [];
  for (const w of words) {
    const id = x.clips[w];
    if (!id) return null;
    urls.push(promptRecordingLink(id));
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
  return !def.vars?.length && !def.textOnly && !def.parts;
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

/*
 * Every phone screen that waits for a key (generated from src/lib/ivr/flow.ts, Nov 26, 2026): the step that plays it,
 * the step that gets the key, its extension (Admin area), the recorded lines it plays (in code order, some only in
 * certain calls) and the keys its code already handles. Used by Admin > Phone > Screens to add lines and keys.
 */
import { PROMPTS, promptArea, type PromptKey } from "@/lib/ivr/prompts";

export type ScreenInfo = { choice: string; lines: readonly string[]; keys: string; combos: readonly string[] };
export const SCREENS: Record<string, ScreenInfo> = {
  "menu": {
    "choice": "menu-choice",
    "lines": [
      "greeting",
      "office_closed",
      "main_menu"
    ],
    "keys": "0123456789",
    "combos": []
  },
  "catalog": {
    "choice": "catalog-choice",
    "lines": [
      "catalog_menu",
      "book_back"
    ],
    "keys": "12",
    "combos": [
      "catalog_menu"
    ]
  },
  "tx-which": {
    "choice": "tx-which-choice",
    "lines": [
      "text_which",
      "book_back"
    ],
    "keys": "12",
    "combos": [
      "text_which"
    ]
  },
  "tx-enter": {
    "choice": "tx-heard",
    "lines": [
      "text_enter"
    ],
    "keys": "123456789",
    "combos": []
  },
  "tx-heard-again": {
    "choice": "tx-confirm",
    "lines": [
      "text_heard"
    ],
    "keys": "12",
    "combos": []
  },
  "catalog-part": {
    "choice": "catalog-key",
    "lines": [
      "type_hint"
    ],
    "keys": "",
    "combos": []
  },
  "catalog-type": {
    "choice": "catalog-typed",
    "lines": [
      "type_instructions"
    ],
    "keys": "",
    "combos": []
  },
  "catalog-got": {
    "choice": "catalog-got-choice",
    "lines": [
      "field_unclear",
      "catalog_got",
      "book_back"
    ],
    "keys": "12",
    "combos": []
  },
  "catalog-ending": {
    "choice": "catalog-ending-choice",
    "lines": [
      "catalog_ending",
      "book_back"
    ],
    "keys": "5",
    "combos": [
      "catalog_ending"
    ]
  },
  "catalog-final": {
    "choice": "catalog-final-choice",
    "lines": [
      "catalog_final",
      "book_back"
    ],
    "keys": "12",
    "combos": []
  },
  "catalog-save": {
    "choice": "catalog-save-choice",
    "lines": [
      "box108a_ask",
      "book_back"
    ],
    "keys": "1",
    "combos": [
      "box108a_ask"
    ]
  },
  "catalog-send": {
    "choice": "catalog-done",
    "lines": [
      "went_wrong",
      "catalog_emailed",
      "catalog_main_star",
      "catalog_bye"
    ],
    "keys": "",
    "combos": [
      "catalog_emailed"
    ]
  },
  "receipt-email": {
    "choice": "receipt-email-choice",
    "lines": [
      "box35_receipt"
    ],
    "keys": "1",
    "combos": []
  },
  "attraction": {
    "choice": "attraction-after",
    "lines": [
      "learn_items",
      "learn_none",
      "learn_deliver",
      "attraction_after"
    ],
    "keys": "12",
    "combos": []
  },
  "attraction-options": {
    "choice": "attraction-after",
    "lines": [
      "attraction_after"
    ],
    "keys": "12",
    "combos": []
  },
  "book": {
    "choice": "book-choice",
    "lines": [
      "not_valid",
      "book_r1",
      "book_orders_only",
      "book_r3a",
      "book_r2",
      "book_r3b"
    ],
    "keys": "0123456789",
    "combos": [
      "book",
      "book_again"
    ]
  },
  "resume": {
    "choice": "resume-choice",
    "lines": [
      "resume_offer",
      "book_back"
    ],
    "keys": "",
    "combos": []
  },
  "resume-added": {
    "choice": "resume-added-choice",
    "lines": [
      "box25_keep",
      "box25_added",
      "ocean_offer",
      "cart_key",
      "book_back"
    ],
    "keys": "0129",
    "combos": [
      "cart_key"
    ]
  },
  "cs-closed": {
    "choice": "cs-closed-key",
    "lines": [],
    "keys": "1",
    "combos": [
      "after_hours_closed"
    ]
  },
  "cats": {
    "choice": "cats-choice",
    "lines": [
      "book_r2",
      "cart_key",
      "book_back"
    ],
    "keys": "01234567",
    "combos": [
      "book_r2"
    ]
  },
  "category": {
    "choice": "category-choice",
    "lines": [
      "category_empty",
      "laser_open",
      "category_item",
      "paddle_open",
      "book_category_list",
      "cart_key",
      "book_back"
    ],
    "keys": "0",
    "combos": [
      "cart_key"
    ]
  },
  "balloons": {
    "choice": "balloon-key",
    "lines": [],
    "keys": "01",
    "combos": []
  },
  "balloon-key": {
    "choice": "balloon-key2",
    "lines": [],
    "keys": "",
    "combos": []
  },
  "balloon": {
    "choice": "balloon-choice",
    "lines": [
      "box154",
      "cart_key",
      "book_back"
    ],
    "keys": "012",
    "combos": [
      "cart_key"
    ]
  },
  "product": {
    "choice": "product-choice",
    "lines": [
      "product_intro",
      "product_options",
      "cart_key",
      "book_back"
    ],
    "keys": "012",
    "combos": [
      "product_options"
    ]
  },
  "date": {
    "choice": "date-heard",
    "lines": [
      "book_date_prompt",
      "book_back"
    ],
    "keys": "",
    "combos": [
      "book_date_prompt"
    ]
  },
  "closed-offer": {
    "choice": "closed-offer-choice",
    "lines": [
      "closed_day_intro",
      "closed_day_get",
      "closed_book_it",
      "closed_pick_another",
      "book_back"
    ],
    "keys": "2",
    "combos": [
      "closed_book_it"
    ]
  },
  "date-ask": {
    "choice": "date-confirm",
    "lines": [
      "fri_mutze_check",
      "box18_book",
      "box18_second",
      "book_date_entered",
      "box18_other_date",
      "book_back"
    ],
    "keys": "2",
    "combos": [
      "box18_other_date"
    ]
  },
  "booked": {
    "choice": "taken-choice",
    "lines": [
      "item_taken",
      "cart_key",
      "book_back"
    ],
    "keys": "012",
    "combos": [
      "cart_key"
    ]
  },
  "taken-size": {
    "choice": "taken-size-choice",
    "lines": [
      "taken_size_down",
      "taken_size_up",
      "cart_key",
      "book_back"
    ],
    "keys": "0",
    "combos": [
      "cart_key"
    ]
  },
  "nearest-date": {
    "choice": "date-heard",
    "lines": [
      "taken_day_before",
      "taken_nearest_before",
      "taken_nearest_after",
      "book_date_prompt",
      "cart_key",
      "book_back"
    ],
    "keys": "",
    "combos": [
      "book_date_prompt",
      "cart_key"
    ]
  },
  "added-second": {
    "choice": "second-choice",
    "lines": [
      "box25_added",
      "laser_second_set",
      "laser_third_set",
      "stay_on_line"
    ],
    "keys": "01",
    "combos": []
  },
  "added-menu": {
    "choice": "after-add",
    "lines": [
      "box25_keep",
      "box25_added",
      "ocean_offer",
      "cart_key",
      "book_back"
    ],
    "keys": "0129",
    "combos": [
      "cart_key"
    ]
  },
  "packs": {
    "choice": "packs-choice",
    "lines": [
      "laser_second_set",
      "laser_third_set",
      "laser_packs",
      "stay_on_line",
      "skip_pound",
      "book_back"
    ],
    "keys": "01",
    "combos": [
      "stay_on_line",
      "skip_pound"
    ]
  },
  "ocean": {
    "choice": "ocean-choice",
    "lines": [
      "ocean_200",
      "ocean_500",
      "ocean_700",
      "book_back"
    ],
    "keys": "0123",
    "combos": [
      "ocean_200"
    ]
  },
  "cart": {
    "choice": "cart-choice",
    "lines": [
      "cart_empty",
      "cart_day",
      "cart_total",
      "cart_options",
      "cart_ocean",
      "book_back"
    ],
    "keys": "12349",
    "combos": []
  },
  "remove": {
    "choice": "remove-choice",
    "lines": [
      "cart_empty",
      "remove_count_one",
      "remove_count",
      "remove_item_date",
      "remove_item",
      "book_back"
    ],
    "keys": "123456789",
    "combos": []
  },
  "remove-qty": {
    "choice": "remove-qty-choice",
    "lines": [
      "remove_qty",
      "remove_enter",
      "book_back"
    ],
    "keys": "123456789",
    "combos": [
      "remove_enter"
    ]
  },
  "ask": {
    "choice": "heard",
    "lines": [
      "field_unclear",
      "type_hint"
    ],
    "keys": "9",
    "combos": []
  },
  "type": {
    "choice": "typed",
    "lines": [
      "type_instructions"
    ],
    "keys": "",
    "combos": []
  },
  "typed": {
    "choice": "confirm",
    "lines": [
      "field_unclear"
    ],
    "keys": "12",
    "combos": []
  },
  "heard": {
    "choice": "confirm",
    "lines": [
      "field_trouble",
      "heard"
    ],
    "keys": "12",
    "combos": []
  },
  "directions": {
    "choice": "directions-choice",
    "lines": [
      "box34_menu",
      "almost_done"
    ],
    "keys": "1",
    "combos": []
  },
  "addr-lookup": {
    "choice": "addr-lookup-choice",
    "lines": [
      "lookup_intro",
      "lookup_options",
      "book_back"
    ],
    "keys": "123",
    "combos": [
      "lookup_intro"
    ]
  },
  "addr-phone": {
    "choice": "addr-phone-heard",
    "lines": [
      "lookup_phone_enter",
      "pound_done",
      "book_back"
    ],
    "keys": "",
    "combos": [
      "lookup_phone_enter"
    ]
  },
  "addr-found": {
    "choice": "addr-found-choice",
    "lines": [
      "lookup_none",
      "lookup_try",
      "lookup_manual",
      "lookup_one",
      "addr_rb_correct",
      "lookup_many",
      "lookup_press",
      "lookup_many_options",
      "book_back"
    ],
    "keys": "1",
    "combos": []
  },
  "addr-house": {
    "choice": "addr-house-heard",
    "lines": [
      "addr_house",
      "pound_done",
      "book_back"
    ],
    "keys": "",
    "combos": [
      "addr_house"
    ]
  },
  "addr-unit-ask": {
    "choice": "addr-unit-ask-choice",
    "lines": [
      "addr_unit_ask",
      "book_back"
    ],
    "keys": "12",
    "combos": [
      "addr_unit_ask"
    ]
  },
  "addr-unit": {
    "choice": "addr-unit-heard",
    "lines": [
      "addr_unit",
      "pound_done",
      "book_back"
    ],
    "keys": "",
    "combos": [
      "addr_unit"
    ]
  },
  "addr-zip": {
    "choice": "addr-zip-choice",
    "lines": [
      "addr_zip",
      "book_back"
    ],
    "keys": "7",
    "combos": [
      "addr_zip"
    ]
  },
  "addr-zip-enter": {
    "choice": "addr-zip-heard",
    "lines": [
      "addr_zip_bad",
      "addr_zip_enter"
    ],
    "keys": "",
    "combos": []
  },
  "addr-street": {
    "choice": "addr-street-choice",
    "lines": [
      "addr_street_menu",
      "book_back"
    ],
    "keys": "12",
    "combos": [
      "addr_street_menu"
    ]
  },
  "addr-street-keys": {
    "choice": "addr-street-typed",
    "lines": [
      "street_keys_intro",
      "type_instructions"
    ],
    "keys": "",
    "combos": []
  },
  "addr-street-pick": {
    "choice": "addr-street-pick-choice",
    "lines": [
      "street_pick_item",
      "book_back"
    ],
    "keys": "123456789",
    "combos": []
  },
  "addr-street-none": {
    "choice": "addr-street-none-choice",
    "lines": [
      "street_none",
      "book_back"
    ],
    "keys": "12",
    "combos": []
  },
  "addr-street-rb": {
    "choice": "addr-street-rb-choice",
    "lines": [],
    "keys": "12",
    "combos": []
  },
  "addr-outside": {
    "choice": "addr-outside-choice",
    "lines": [
      "addr_outside",
      "book_back"
    ],
    "keys": "1",
    "combos": [
      "addr_outside"
    ]
  },
  "addr-readback": {
    "choice": "addr-readback-choice",
    "lines": [
      "addr_rb_intro",
      "book_back"
    ],
    "keys": "12",
    "combos": []
  },
  "readback": {
    "choice": "confirm",
    "lines": [
      "book_back"
    ],
    "keys": "12",
    "combos": []
  },
  "terms": {
    "choice": "terms-answer",
    "lines": [
      "book_back"
    ],
    "keys": "1",
    "combos": []
  },
  "phone": {
    "choice": "phone-choice",
    "lines": [
      "phone_confirm",
      "book_back"
    ],
    "keys": "12",
    "combos": []
  },
  "phone-enter": {
    "choice": "phone-heard",
    "lines": [
      "phone_enter",
      "press_pound_done"
    ],
    "keys": "",
    "combos": []
  },
  "phone-heard": {
    "choice": "phone-confirm",
    "lines": [
      "phone_bad"
    ],
    "keys": "2",
    "combos": []
  },
  "sms-consent": {
    "choice": "sms-consent-answer",
    "lines": [
      "consent_stopped",
      "consent_transactional"
    ],
    "keys": "1",
    "combos": []
  },
  "paylink": {
    "choice": "paylink-choice",
    "lines": [
      "pay_link_how"
    ],
    "keys": "12",
    "combos": []
  },
  "pay-consent": {
    "choice": "pay-consent-answer",
    "lines": [
      "no_choice",
      "consent_transactional"
    ],
    "keys": "",
    "combos": []
  },
  "pay-choice": {
    "choice": "pay-choice-answer",
    "lines": [
      "phonepay_choice"
    ],
    "keys": "1",
    "combos": []
  },
  "phonepay-go": {
    "choice": "phonepay-option",
    "lines": [
      "pay_card_line",
      "phonepay_failed",
      "pay_hold_secure"
    ],
    "keys": "0",
    "combos": []
  },
  "pay-approved": {
    "choice": "pay-approved-choice",
    "lines": [
      "checkout_order_number",
      "phonepay_approved",
      "pay_approved_dates",
      "phonepay_approved_star",
      "phonepay_approved_text",
      "phonepay_approved_bye",
      "pay_approved_optin"
    ],
    "keys": "1",
    "combos": [
      "pay_approved_text",
      "pay_approved_optin"
    ]
  },
  "phonepay-retry": {
    "choice": "phonepay-retry-answer",
    "lines": [
      "phonepay_failed",
      "phonepay_unclear"
    ],
    "keys": "1",
    "combos": []
  },
  "promo-consent": {
    "choice": "promo-consent-answer",
    "lines": [
      "promo_ask",
      "skip_pound"
    ],
    "keys": "1",
    "combos": [
      "promo_ask"
    ]
  },
  "promo-which": {
    "choice": "promo-which-answer",
    "lines": [
      "promo_which"
    ],
    "keys": "12",
    "combos": []
  },
  "promo-enter": {
    "choice": "promo-heard",
    "lines": [
      "text_enter"
    ],
    "keys": "",
    "combos": []
  },
  "promo-heard": {
    "choice": "promo-confirm",
    "lines": [
      "promo_bad",
      "text_heard"
    ],
    "keys": "12",
    "combos": []
  },
  "vma-pin": {
    "choice": "vma-pin-check",
    "lines": [
      "vma_locked",
      "vma_pin"
    ],
    "keys": "",
    "combos": []
  },
  "vma-box": {
    "choice": "vma-box-choice",
    "lines": [],
    "keys": "07",
    "combos": []
  },
  "vma-play": {
    "choice": "vma-box",
    "lines": [
      "vma_end",
      "vma_message"
    ],
    "keys": "",
    "combos": []
  },
  "vma-options": {
    "choice": "vma-choice",
    "lines": [],
    "keys": "1234",
    "combos": []
  },
  "vma-newpin": {
    "choice": "vma-newpin-again",
    "lines": [
      "vma_newpin"
    ],
    "keys": "",
    "combos": []
  },
  "vma-newpin-again": {
    "choice": "vma-newpin-save",
    "lines": [
      "vma_newpin_bad",
      "vma_newpin_again"
    ],
    "keys": "",
    "combos": []
  },
  "vma-charge": {
    "choice": "vma-charge-go",
    "lines": [
      "not_valid",
      "vma_charge_note"
    ],
    "keys": "",
    "combos": []
  },
  "vma-out": {
    "choice": "vma-out-dial",
    "lines": [
      "vma_out_enter"
    ],
    "keys": "",
    "combos": []
  },
  "vm-options": {
    "choice": "vm-option",
    "lines": [
      "vm_options"
    ],
    "keys": "123",
    "combos": []
  },
  "vm-none": {
    "choice": "vm-none-choice",
    "lines": [
      "vm_none_retry"
    ],
    "keys": "3",
    "combos": []
  },
  "instructions": {
    "choice": "attraction-choice",
    "lines": [
      "instr_menu",
      "book_back"
    ],
    "keys": "123",
    "combos": [
      "instr_menu"
    ]
  },
  "learn": {
    "choice": "attraction-choice",
    "lines": [
      "learn_intro",
      "attraction_choice",
      "book_back"
    ],
    "keys": "123",
    "combos": [
      "attraction_choice"
    ]
  },
  "hours": {
    "choice": "",
    "lines": [
      "office_closed",
      "hours_lines"
    ],
    "keys": "",
    "combos": [
      "hours"
    ]
  }
};

/** The screen's extension (Admin area), from its first line of its own (not the shared cart or star lines). */
const AREA_FIX: Record<string, string> = { "cs-closed": "Key 1: Bookings", balloons: "Key 1: Bookings", "balloon-key": "Key 1: Bookings", "addr-street-rb": "Key 1: Bookings", readback: "Key 1: Bookings", terms: "Key 1: Bookings", "vma-box": "Voicemail (every box) and Key 9", "vma-options": "Voicemail (every box) and Key 9" };
export function screenArea(id: string): string {
  if (AREA_FIX[id]) return AREA_FIX[id];
  const k = SCREENS[id]?.lines.find((x) => x !== "book_back" && x !== "cart_key" && x in PROMPTS);
  return k ? promptArea((PROMPTS[k as PromptKey] as { group: string }).group) : "Other";
}

/** A plain name for the screen: its first line's Admin name, else the step name. */
export function screenLabel(id: string): string {
  const k = SCREENS[id]?.lines.find((x) => x !== "book_back" && x !== "cart_key" && x in PROMPTS);
  return k ? `${(PROMPTS[k as PromptKey] as { label: string }).label} (${id})` : id;
}

/** The screen that receives a key at this step (its key-choice step), if any. */
export const SCREEN_BY_CHOICE: Record<string, string> = Object.fromEntries(Object.entries(SCREENS).filter(([, x]) => x.choice).map(([s, x]) => [x.choice, s]));

/** The screen a key at this step belongs to (the key 2 and key 6 menus share one key step). */
export function screenForChoice(action: string, query: URLSearchParams): string | null {
  if (action === "attraction-choice") return query.get("m") === "l" ? "learn" : "instructions";
  return SCREEN_BY_CHOICE[action] ?? null;
}

/** Screens a key can send the caller to (they need nothing from the earlier steps). */
export const GO_TO_SCREENS = ["menu", "book", "cats", "catalog", "instructions", "learn", "cart", "hours"] as const;

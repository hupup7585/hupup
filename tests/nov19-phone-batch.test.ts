import { describe, expect, it } from "vitest";
import { bookingLock, calendarDefaults, SHABBES_EXTRA_MINUTES } from "@/lib/jewish-calendar";
import { MENU_RECORDINGS, menuOrder, setMenuOrder } from "@/lib/ivr/menu-order";
import { PROMPTS } from "@/lib/ivr/prompts";
import { balloonKeyWords } from "@/lib/ivr/balloon-menu";
import { optionParts } from "@/lib/ivr/flow";
import { NUMBER_CLIPS, allSlots } from "@/lib/recording-slots";

/* Hark's phone batch for Abraham, Nov 19, 2026 (parts 1-13) and Abraham's main menu message of the same day. */
const S = calendarDefaults();

describe("Shabbes: closed until 2 minutes after Rabbeinu Tam", () => {
  it("Motzei Shabbes opens 72 + 2 minutes after sunset in Monroe", () => {
    expect(SHABBES_EXTRA_MINUTES).toBe(2);
    const day = bookingLock(new Date("2026-11-21T17:00:00Z"), S);
    expect(day.locked).toBe(true);
    const opens = day.opensAt!;
    expect(bookingLock(new Date(opens.getTime() - 60_000), S).locked).toBe(true);
    expect(bookingLock(new Date(opens.getTime() + 1000), S).locked).toBe(false);
    // 74 minutes after sunset: sunset Nov 21, 2026 in Monroe is about 4:33 PM, so it opens about 5:47 PM
    const et = opens.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    expect(et).toMatch(/^5:4\d PM$/);
  });
});

describe("menu order (Admin)", () => {
  it("default orders; the Owner's order is used only when it holds every recording once", () => {
    const DEF = ["book_r1", "book_orders_only", "book_r2", "book_r3", "book_back"];
    expect(menuOrder("book", "")).toEqual(DEF);
    const stored = setMenuOrder("book", ["book_r2", "book_r1", "book_orders_only", "book_r3", "book_back"], "");
    expect(menuOrder("book", stored)).toEqual(["book_r2", "book_r1", "book_orders_only", "book_r3", "book_back"]);
    expect(menuOrder("balloons", stored)).toEqual([...MENU_RECORDINGS.balloons.keys]);
    expect(() => setMenuOrder("book", ["book_r1"], "")).toThrow();
    expect(menuOrder("book", '{"book":["book_r1","x","book_orders_only","book_r3","book_back"]}')).toEqual(DEF);
    expect(menuOrder("book", "not json")).toEqual(DEF);
  });
});

describe("approved wording", () => {
  it("Abraham's main menu message: recording notice and office closed", () => {
    expect(PROMPTS.recording_notice.text).toBe("This call may be monitored or recorded for quality and training purposes.");
    expect(PROMPTS.office_closed.text).toBe("Our office is closed right now, but you can still book anytime using our automated system.");
    const main = PROMPTS.main_menu.text.split("\n");
    expect(main.indexOf("For questions or assistance with any issues during your rental, press 4.")).toBeGreaterThan(0);
    expect(main.indexOf("For delivery and pickup information, press 5.")).toBe(main.indexOf("For questions or assistance with any issues during your rental, press 4.") + 1);
    expect(main.indexOf("To learn more about our rental attractions and the services we offer, press 6.")).toBe(main.indexOf("For delivery and pickup information, press 5.") + 1);
    expect(main.indexOf("To receive our catalog by text or email, press 8.")).toBe(main.indexOf("To hear our hours of operation, press 7.") + 1);
  });
  it("bookings menu, welcome back, old cart, item booked, balloons", () => {
    expect(PROMPTS.resume_offer.text).toBe("Welcome back! On your last call you had in your cart {items} for {date}. To check if they are still available, press 1. To start a new order, press 2.");
    expect(PROMPTS.item_taken.text).toBe("We are sorry, the {item} is no longer available for {date}. To check the closest available {category} on the same date, press 1. For the nearest available date, press 2.");
    expect(PROMPTS.cart_empty.text).toBe("Your shopping cart is empty right now. Let us start shopping!");
    expect(PROMPTS.box156.text).toBe("The total of your order is {amount}. We are happy to let you know that a discount of {discount} has been applied to your order. Your new total is {newtotal}.");
    expect(PROMPTS.book_r1.text).toBe("To receive our catalog by text or email, press 8.");
    expect(PROMPTS.book_orders_only.text).toBe("Please note, orders can be placed only through our automated system.");
    expect(PROMPTS.not_valid.text).toBe("Sorry, that is not a valid selection.");
    expect(PROMPTS.balloon_7212.text).toBe("For the Wheel Thrill, item seven two");
    expect(PROMPTS.balloon_press.text).toBe("press");
    expect(balloonKeyWords("4")).toBe("4");
    expect(balloonKeyWords("11")).toBe("one one");
  });
});

describe("half-second pause after each option (computer voice)", () => {
  it("a menu line is split after each option", () => {
    expect(optionParts("For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3.")).toEqual(["For jumping balloons, press 1.", "For laser tag, press 2.", "For paddle boats, press 3."]);
    expect(optionParts("To hear this menu again, press the star key. Thank you!")).toEqual(["To hear this menu again, press the star key.", "Thank you!"]);
    expect(optionParts("I am sorry, the Castle is already booked on Monday.")).toHaveLength(1);
  });
});

describe("Admin recording list", () => {
  it("Hark's 33 number clips, each its own row, in his order", () => {
    expect(NUMBER_CLIPS).toHaveLength(33);
    const rows = allSlots().filter((s) => s.group.startsWith("Number clips"));
    expect(rows.map((r) => r.label)).toEqual([...NUMBER_CLIPS]);
    expect(rows.map((r) => r.key).slice(-5)).toEqual(["word:hundred", "word:thousand", "word:dollars", "word:and", "word:cents"]);
    expect(new Set(allSlots().map((s) => s.key)).size).toBe(allSlots().length); // no row twice
  });
  it("shows the text as edited in Admin, and the unused catalog offer row is gone", () => {
    const edited = allSlots([], { recording_notice: "Edited text." });
    expect(edited.find((s) => s.key === "recording_notice")!.text).toBe("Edited text.");
    expect(allSlots().some((s) => s.key === "catalog_offer")).toBe(false);
  });
});

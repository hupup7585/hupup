import { describe, expect, it } from "vitest";
import { bookingLock, calendarDefaults, SHABBES_EXTRA_MINUTES } from "@/lib/jewish-calendar";
import { MENU_RECORDINGS, menuOrder, setMenuOrder } from "@/lib/ivr/menu-order";
import { PROMPTS } from "@/lib/ivr/prompts";
import { balloonKeyWords } from "@/lib/ivr/balloon-menu";

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
    expect(menuOrder("book", "")).toEqual(["book_r1", "book_r2", "book_r3", "book_back"]);
    const stored = setMenuOrder("book", ["book_r2", "book_r1", "book_r3", "book_back"], "");
    expect(menuOrder("book", stored)).toEqual(["book_r2", "book_r1", "book_r3", "book_back"]);
    expect(menuOrder("balloons", stored)).toEqual([...MENU_RECORDINGS.balloons.keys]);
    expect(() => setMenuOrder("book", ["book_r1"], "")).toThrow();
    expect(menuOrder("book", '{"book":["book_r1","x","book_r3","book_back"]}')).toEqual(["book_r1", "book_r2", "book_r3", "book_back"]);
    expect(menuOrder("book", "not json")).toEqual(["book_r1", "book_r2", "book_r3", "book_back"]);
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
    expect(PROMPTS.item_booked.text).toBe("I am sorry, the {item} is already booked on {date}. For the closest {category} on the same date, press 1. For the nearest date this item is free, press 2.");
    expect(PROMPTS.not_valid.text).toBe("Sorry, that is not a valid selection.");
    expect(PROMPTS.balloon_7212.text).toBe("For the Wheel Thrill, item seven two,");
    expect(balloonKeyWords("4")).toBe("4");
    expect(balloonKeyWords("11")).toBe("one one");
  });
});

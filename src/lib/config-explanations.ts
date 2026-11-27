import { PHONE_TIMERS } from "@/lib/ivr/timers";

/**
 * Plain-English explanation of every Admin setting (Abraham, Nov 26, 2026, 3:19 AM build rule): what it does, where the
 * caller or customer meets it, and what happens if it is changed. The current value is shown beside it on the page.
 * Bookkeeping settings (3:20 AM rule) also say where the number comes from, how it is calculated and a worked example
 * with dollar amounts; anything about tax says to ask the accountant. These are Admin explanations only: they do not
 * approve any customer wording or recording.
 */
export type Explanation = {
  /** What it does. */
  what: string;
  /** Where the caller, customer or staff member meets it. */
  where: string;
  /** What happens if it is changed. */
  ifChanged: string;
  /** Bookkeeping: where the number comes from. */
  source?: string;
  /** Bookkeeping: how it is calculated. */
  calculation?: string;
  /** A short worked example (dollar amounts for money settings). */
  example?: string;
  /** Tax question: ask the accountant; this is not tax advice. */
  askAccountant?: boolean;
};

const TIMERS: Record<string, Explanation> = Object.fromEntries(PHONE_TIMERS.map((t) => [t.key, { what: t.what, where: t.where, ifChanged: `${t.ifChanged} Allowed from ${t.min} to ${t.max}; the starting value was ${t.default}.` }]));

const ACCOUNTANT = "This is a tax and bookkeeping question: ask your accountant before changing it. This page does not give tax advice.";

/* ---------- Ring lists (main-menu keys 0, 2, 4, 5, 6 and 8) ---------- */
const LINE_NAMES: Record<string, string> = {
  "0": "the Operator line (extension 0)",
  "2": "the Equipment Instructions and Guidance line (extension 2)",
  "4": "the Customer Service line (extension 3)",
  "5": "the Rental Issues line (extension 4)",
  "6": "the Delivery and Pickup line (extension 5)",
  "8": "the Schools, Corporate Events and Organizations line",
};
/** Who reaches each line (Hark's review M3, Nov 26, 2026: the keys callers really press, from the call flow). */
const REACHED_BY: Record<string, string> = {
  "0": "A caller who presses 0 on the main menu",
  "2": "A caller sent here by a key set in Admin (no built-in key rings this line now; main-menu key 2 plays the instructions menu)",
  "4": "A caller who presses 3 on the main menu, or 0 on the bookings menu during customer service hours",
  "5": "A caller who presses 4 on the main menu",
  "6": "A caller who presses 5 on the main menu",
  "8": "A caller who presses 9 on the bookings menu",
};

function ringFamily(k: string): Record<string, Explanation> {
  const line = LINE_NAMES[k];
  const caller = REACHED_BY[k];
  const out: Record<string, Explanation> = {
    [`ringAttempts${k}`]: {
      what: `How many times the phone line goes through the whole ring list for ${line} before the caller is sent to that line's voicemail.`,
      where: `${caller} hears hold music while staff phones ring. Each round rings every number on the list for its own ring time (usually 25 seconds).`,
      ifChanged: "A higher number keeps the caller waiting longer before voicemail but gives staff more chances to answer. A lower number sends callers to voicemail sooner. For example, 3 rounds of one phone at 25 seconds is about 75 seconds of ringing.",
    },
    [`ringAfterHours${k}`]: {
      what: `Whether ${line} still rings staff phones outside office hours. Off means after-hours callers go straight to voicemail.`,
      where: `${caller} after the office has closed. On Shabbes and Yom Tov nothing rings, whatever this says.`,
      ifChanged: "On: staff phones ring after hours, within the after-hours window below if one is set. Off: after-hours callers hear the closed message and can leave a voicemail.",
    },
    [`ringAfterFrom${k}`]: {
      what: `The earliest time of day (Eastern time, 24-hour clock, for example 08:00) that ${line} rings after hours. Blank means no limit.`,
      where: `Used only when "rings after hours" is on for this line. ${caller}, outside office hours.`,
      ifChanged: "A call before this time goes to voicemail instead of ringing staff. Leave it blank to ring at any after-hours time.",
    },
    [`ringAfterTo${k}`]: {
      what: `The latest time of day (Eastern time, 24-hour clock, for example 22:30) that ${line} rings after hours. Blank means no limit.`,
      where: `Used only when "rings after hours" is on for this line. ${caller}, late in the evening.`,
      ifChanged: "A call after this time goes to voicemail instead of ringing staff.",
    },
    [`ringErevTo${k}`]: {
      what: `On Friday and Erev Yom Tov, the latest time of day (Eastern time, 24-hour clock) that ${line} rings. Blank means the normal rule.`,
      where: `${caller}, on a Friday or Erev Yom Tov afternoon.`,
      ifChanged: "Today the phone uses the later of this time and the minutes-before-candle-lighting limit below (which one should win is being confirmed with the Owner); after that, callers go to voicemail.",
    },
    [`ringErevBefore${k}`]: {
      what: `On Friday and Erev Yom Tov, how many minutes before candle lighting ${line} stops ringing. 0 means no extra limit.`,
      where: `${caller}, close to Shabbes or Yom Tov.`,
      ifChanged: "A bigger number stops ringing earlier in the afternoon. For example, 60 stops ringing one hour before candle lighting.",
    },
    [`ringAnnounce${k}`]: {
      what: `The words a staff member hears when they pick up a call forwarded from ${line}, before they accept it. Blank uses the standard announcement.`,
      where: "Staff only: customers never hear this. It plays on the staff member's phone when they answer.",
      ifChanged: "Staff hear the new words on the next forwarded call. It does not change anything the caller hears.",
    },
    [`ringName${k}`]: {
      what: `The name of ${line} that staff hear in the call announcement and see in missed-call and voicemail alerts. Blank uses the standard name.`,
      where: "Staff only: in the announcement when answering, in alert texts and emails, and in the Admin call log.",
      ifChanged: "The new name shows on the next call and alert. Callers do not hear it.",
    },
  };
  if (k !== "0") {
    Object.assign(out, {
      [`ringTargets${k}`]: {
        what: `The staff phones that ring for ${line}, one per line, written as "Name | phone number | ring seconds". Blank means it rings the Operator list (key 0) instead.`,
        where: `${caller} during ringing hours. Edited on the Phone settings page.`,
        ifChanged: "The next call rings the new list. A wrong number means a staff phone will not ring, so test a call after changing it.",
      },
      [`ringMode${k}`]: {
        what: `How the phones on the ${line} list ring: "sequential" rings them one after another in order; "simultaneous" rings them all at once and the first to accept gets the call.`,
        where: `${caller} hears hold music either way.`,
        ifChanged: "Simultaneous reaches someone faster but rings everyone; sequential lets the first person on the list answer first.",
      },
      [`ringAccept${k}`]: {
        what: `Whether the staff member must press 1 to accept a call from ${line}. This stops a personal voicemail from picking up the customer's call.`,
        where: "Staff only: the staff member hears the announcement and presses 1. The caller keeps hearing hold music until then.",
        ifChanged: "Off: the call connects as soon as the staff phone answers, even if it is a personal voicemail. Keep it on unless there is a reason.",
      },
    });
  }
  return out;
}

const RING: Record<string, Explanation> = Object.assign({}, ...["0", "2", "4", "5", "6", "8"].map(ringFamily), {
  ringName9: {
    what: "The name of the key 9 voicemail box (feedback and comments) shown in alerts. Blank uses \"Feedback and Comments\".",
    where: "Staff only: in voicemail alert texts and emails and in the Admin voicemail list.",
    ifChanged: "New alerts show the new name. Callers do not hear it.",
  },
});

/* ---------- Bookkeeping (deeper explanations) ---------- */
const BOOKS: Record<string, Explanation> = {
  solaFeePercent: {
    what: "The percent Sola (the card processor) keeps from each card payment. It is used only to estimate the fee and the amount that lands in the bank.",
    where: "Staff only: Bookkeeping, Payment fees and payouts, and the bank-match step. Customers never see it and are never charged it.",
    source: "Copy it from your monthly Sola statement (the processing rate line).",
    calculation: "Estimated fee = payment × this percent ÷ 100, plus the fixed fee per payment below. Estimated deposit = payment minus the estimated fee.",
    example: "A $300.00 payment at 2.9 percent plus 30 cents: 300 × 2.9 ÷ 100 = $8.70, plus $0.30 = $9.00 fee, so about $291.00 is expected in the bank.",
    ifChanged: "Fee estimates and expected deposits are worked out with the new rate from then on, so the bank match looks for different amounts. Payments already taken are not changed.",
  },
  solaFeeCents: {
    what: "The fixed fee in cents that Sola keeps from each card payment, on top of the percent. 30 means 30 cents.",
    where: "Staff only: Bookkeeping, Payment fees and payouts, and the bank-match step.",
    source: "Copy it from your Sola statement (the per-transaction fee).",
    calculation: "Added once to every payment's estimated fee: payment × percent ÷ 100 + this amount.",
    example: "Ten payments of $100.00 at 2.9 percent plus 30 cents: each fee is $2.90 + $0.30 = $3.20, so $32.00 in fees and $968.00 expected in the bank.",
    ifChanged: "Changes the estimated fee and expected deposit for each payment from then on. Nothing is charged to anyone.",
  },
  bookReminderDays: {
    what: "How many days before a due date (a bill, a sales tax filing or an estimated tax payment) the reminder shows on the Bookkeeping overview.",
    where: "Staff only: Bookkeeping overview, Reminders list.",
    source: "Your own choice. 7 means one week ahead.",
    calculation: "A reminder shows when today is on or after the due date minus this many days.",
    example: "With 7, a $450.00 insurance bill due March 15 shows under Reminders from March 8.",
    ifChanged: "A bigger number shows reminders earlier; a smaller number shows them later. Due dates themselves do not change.",
    askAccountant: true,
  },
  bookOpeningCashCents: {
    what: "The money in the business bank account on the day the books start, in cents. 1250000 means $12,500.00.",
    where: "Staff only: the balance sheet and cash reports in Bookkeeping.",
    source: "The bank statement balance on the opening date below.",
    calculation: "Cash on any later day = this opening amount + money received − money paid out since the opening date.",
    example: "Opening cash $12,500.00, then $3,000.00 of rentals paid and $800.00 of bills paid: the balance sheet shows $14,700.00 cash.",
    ifChanged: "Every balance sheet and cash figure moves by the same difference. Set it once, from the bank statement, and ask your accountant before changing it later.",
    askAccountant: true,
  },
  bookOpeningDate: {
    what: "The day the books start. Money before this date is not counted; the opening cash above is the balance on this day.",
    where: "Staff only: the balance sheet and cash reports in Bookkeeping.",
    source: "Usually the first day of the month or year you start keeping the books here, matching a bank statement.",
    calculation: "Reports add up money received and paid from this date onward.",
    example: "Opening date January 1 with $12,500.00: a $200.00 payment on December 30 is not counted; one on January 2 is.",
    ifChanged: "Moving the date adds or removes earlier money from every report, so the opening cash must match the new date. Ask your accountant first.",
    askAccountant: true,
  },
  glChartApprovedBy: {
    what: "The name of the accountant who approved the list of bookkeeping accounts (the chart of accounts: income, expenses, bank, and so on).",
    where: "Staff only: Bookkeeping, General ledger (the full record of every bookkeeping entry). The ledger stays in set-up mode until this and the date are filled in.",
    source: "Your accountant, after reviewing the account list.",
    calculation: "Not a number. The ledger only checks that it is filled in.",
    example: "Example: \"Approved by Jane Cohen, Certified Public Accountant\". Until then, entries can be drafted but the ledger shows that it is not set up.",
    ifChanged: "Clearing it puts the ledger back into set-up mode. It does not erase entries.",
    askAccountant: true,
  },
  glChartApprovedOn: {
    what: "The date the accountant approved the list of bookkeeping accounts.",
    where: "Staff only: Bookkeeping, General ledger.",
    source: "The date on your accountant's approval.",
    calculation: "Not a number. The ledger only checks that it is filled in.",
    example: "Example: 2027-01-05. Kept with the approval name for your records.",
    ifChanged: "Clearing it puts the ledger back into set-up mode.",
    askAccountant: true,
  },
  glFiscalYearStartMonth: {
    what: "The month the business's bookkeeping year starts (1 = January). Yearly reports and year-end closing use it.",
    where: "Staff only: Bookkeeping reports for \"this year\" and the year-end close.",
    source: "Your accountant or your tax return (most small businesses use January).",
    calculation: "\"This year\" runs from the first day of this month to the day before it comes round again.",
    example: "With 1, the 2027 year is January 1 to December 31, 2027: a $5,000.00 profit in December counts in 2027. With 7, the same December falls in the year July 2027 to June 2028.",
    ifChanged: "Every yearly total is regrouped. Never change it after a year has been closed without your accountant.",
    askAccountant: true,
  },
  glAccountingMethod: {
    what: "Cash or accrual. Cash counts money when it is actually received or paid; accrual counts it when it is earned or owed.",
    where: "Staff only: profit and loss and the other Bookkeeping reports.",
    source: "Your accountant decides, to match how the business files taxes.",
    calculation: "Cash: a rental counts on the day payment comes in. Accrual: it counts on the rental day, even if unpaid.",
    example: "A $500.00 rental on December 30, paid January 3: cash method puts $500.00 in January; accrual puts it in December.",
    ifChanged: "Reports move income and expenses between months and years. Change it only with your accountant.",
    askAccountant: true,
  },
  glBaseCurrency: {
    what: "The currency every amount in the books is kept in. US dollars.",
    where: "Staff only: every Bookkeeping amount.",
    source: "Fixed: the business works in US dollars.",
    calculation: "No conversion is done.",
    example: "$1,000.00 is stored as 100000 cents in US dollars.",
    ifChanged: "Do not change it. Amounts are not converted.",
  },
  glApprovalThresholdCents: {
    what: "Manual bookkeeping entries at or above this amount, in cents, need a second person to approve them before they count. Blank means every entry needs approval.",
    where: "Staff only: Bookkeeping, General ledger, when someone adds a manual entry.",
    source: "Your own choice, with your accountant's advice.",
    calculation: "An entry needs approval when its total is equal to or more than this amount.",
    example: "With 50000 ($500.00): a $120.00 correction posts at once; a $750.00 correction waits for a second person.",
    ifChanged: "A lower amount means more entries wait for approval; a higher amount lets bigger entries post without a second look.",
    askAccountant: true,
  },
};

/* ---------- Everything else ---------- */
const OTHER: Record<string, Explanation> = {
  smsForwardEnabled: {
    what: "Sends the Owner a copy of every text message a customer sends to the hotline.",
    where: "Staff only: the copy goes to the forwarding phone below. Customers notice nothing.",
    ifChanged: "Off: incoming texts are still saved in Admin, Messages, but no copy is sent.",
  },
  smsForwardPhone: {
    what: "The phone number that gets the copies of incoming customer texts. Blank uses the Owner's phone.",
    where: "Staff only: customers never see this number or know a copy was sent.",
    ifChanged: "Copies go to the new number from the next incoming text.",
  },
  voicemailMms: {
    what: "Attaches the voicemail recording as a sound file to the voicemail alert text (a picture message), so it can be played from the phone.",
    where: "Staff only: in voicemail alert texts.",
    ifChanged: "Off: the alert text has only the details and a link to listen in Admin.",
  },
  missedCallAlerts: {
    what: "Sends the Owner an alert when a caller hangs up or is sent to voicemail without reaching anyone.",
    where: "Staff only: an alert text or email.",
    ifChanged: "Off: missed calls are still in the Admin call log, but no alert is sent.",
  },
  incomingTextEmail: {
    what: "Sends an email copy of every text message a customer sends to the hotline.",
    where: "Staff only: the Owner's email inbox.",
    ifChanged: "Off: no email copies; texts stay in Admin, Messages.",
  },
  smsHelpReplyEnabled: {
    what: "Kept from an earlier set-up and not in use now. The automatic answer to a customer who texts HELP is always sent, with the approved words.",
    where: "Nowhere at the moment: nothing reads this switch.",
    ifChanged: "No effect. The HELP answer keeps going out, as phone carriers require.",
  },
  smsHelpText: {
    what: "Kept from an earlier set-up and not in use now. The words of the HELP answer come from the approved texting wording, not from here.",
    where: "Nowhere at the moment: nothing reads this text.",
    ifChanged: "No effect. To change the HELP answer, ask for it to be changed with the Owner's approval of the exact words.",
  },
  supportPhone: {
    what: "A support phone number kept for customer messages. Blank uses the standard hotline and office numbers.",
    where: "Not shown to customers at the moment.",
    ifChanged: "No effect until a message is set up to use it.",
  },
  deliveryFeeKjCents: {
    what: "The delivery fee for Kiryas Joel, in cents. 1000 means $10.00.",
    where: "Customers booking a Kiryas Joel address: on the phone order total, the payment link, the receipt and the staff New booking screen.",
    ifChanged: "New orders use the new fee. Orders already placed keep the fee they were given. Sales tax is worked out on the fee too.",
    askAccountant: true,
  },
  deliveryFeeAreaCents: {
    what: "The delivery fee for the nearby towns (for example Monroe and Highland Mills), in cents. 1500 means $15.00.",
    where: "Customers booking an address in a nearby town: phone order total, payment link, receipt and New booking.",
    ifChanged: "New orders use the new fee; orders already placed keep theirs.",
  },
  deliveryFeeOutsideCents: {
    what: "The delivery fee for the rest of Orange County, outside the colored map areas, in cents. 2000 means $20.00.",
    where: "Customers booking an address farther out in Orange County.",
    ifChanged: "New orders use the new fee; orders already placed keep theirs.",
  },
  deliveryPromoOn: {
    what: "Turns on the free-delivery offer: Kiryas Joel free and the nearby towns $10.00 between the start and end dates below. The farther area keeps its price.",
    where: "Customers booking during the offer dates: the delivery line on their order total.",
    ifChanged: "On: new orders within the dates get the lower delivery fee. Off: normal fees.",
  },
  deliveryPromoStart: {
    what: "The first day of the free-delivery offer (year-month-day, Eastern time). Blank means it starts at once.",
    where: "Customers booking during the offer.",
    ifChanged: "The offer begins on the new day.",
  },
  deliveryPromoEnd: {
    what: "The last day of the free-delivery offer. Blank means no end date.",
    where: "Customers booking during the offer.",
    ifChanged: "The offer ends after the new day.",
  },
  laserThirdSetHalfOn: {
    what: "Laser tag: every third set added to an order is half price (full sets and extra gun sets are counted separately).",
    where: "Callers adding laser tag sets on the phone, the order total, the payment link, and New booking.",
    ifChanged: "Off: every set is full price. Orders already placed keep their price.",
  },
  offerThuSunOn: {
    what: "Offer: keep the rental Thursday to Sunday for 1.5 times the price, picked up Monday.",
    where: "Customers booking a Thursday on the phone and in New booking.",
    ifChanged: "On: the offer is given to qualifying new orders. Offers never combine with each other.",
  },
  offerFourthSundayOn: {
    what: "Offer: rent three Sundays and the fourth Sunday is free (delivery is still charged).",
    where: "Customers booking several Sundays.",
    ifChanged: "On: qualifying new orders get the free Sunday. Offers never combine.",
  },
  offersIntro: {
    what: "The line at the top of the Admin Offers page.",
    where: "Staff only: the Offers page.",
    ifChanged: "Staff see the new line. Customers never see it.",
  },
  catalogTextPicture1: {
    what: "The first catalog picture sent when a customer asks for the catalog by text (sent with the catalog words).",
    where: "Customers who press 8 and choose the catalog by text.",
    ifChanged: "The next catalog text uses the new picture. Blank sends the words only. Edited on the Catalog page.",
  },
  catalogTextPicture2: {
    what: "The second catalog picture, sent as its own message right after the first.",
    where: "Customers who ask for the catalog by text.",
    ifChanged: "The next catalog text uses the new picture. Blank sends only the first message.",
  },
  catalogTextItems: {
    what: "The catalog pictures sent by text, in order, each with its own words.",
    where: "Customers who ask for the catalog by text.",
    ifChanged: "Edited on the Catalog email and text page; the next catalog text follows the new list.",
  },
  catalogTextMissingAt: {
    what: "The last time a customer asked for the catalog by text while no catalog pictures were set. Filled in by the system.",
    where: "Staff only: a warning on the Catalog email and text page.",
    ifChanged: "Nothing to change by hand.",
  },
  catalogName: {
    what: "The catalog's name, added to the subject of the catalog email.",
    where: "Customers who ask for the catalog by email.",
    ifChanged: "The next catalog email uses the new name in its subject.",
  },
  catalogAutoAttach: {
    what: "Attaches the catalog file to the catalog email automatically.",
    where: "Customers who ask for the catalog by email.",
    ifChanged: "Off: the email goes without the catalog file attached.",
  },
  catalogEmailSubjectText: {
    what: "The subject line of the catalog email. Blank uses the approved subject.",
    where: "Customers who ask for the catalog by email.",
    ifChanged: "The next catalog email uses the new subject. Customer words: needs the Owner's approval of the exact text.",
  },
  catalogEmailBodyText: {
    what: "The words of the catalog email. Blank uses the approved words. {Catalog Name} is filled in automatically.",
    where: "Customers who ask for the catalog by email.",
    ifChanged: "The next catalog email uses the new words. Customer words: needs the Owner's approval of the exact text.",
  },
  musicStaffWait: {
    what: "The songs, in order, that callers hear while staff phones ring.",
    where: "Callers waiting to be connected to staff.",
    ifChanged: "Edited on the Music page. The next waiting caller hears the new songs; blank means no music there.",
  },
  musicPayConnect: {
    what: "The songs callers hear while the card payment line is being connected.",
    where: "Callers paying by card on the phone.",
    ifChanged: "Edited on the Music page. Blank means no music there.",
  },
  emailSignature: {
    what: "The signature at the bottom of emails to customers. Blank uses the approved signature.",
    where: "Customers: every email from the business.",
    ifChanged: "New emails carry the new signature. Customer words: needs the Owner's approval.",
  },
  emailMailingAddress: {
    what: "The mailing address printed at the bottom of promotional emails (the law requires one in marketing emails).",
    where: "Customers who get promotional emails.",
    ifChanged: "New promotional emails show the new address.",
  },
  nameSpeakingRate: {
    what: "How fast the phone voice says household names live. 1 is normal speed; 1.1 is 10 percent faster.",
    where: "Callers hearing their name read back on the phone.",
    ifChanged: "A higher number speaks names faster; a lower number slower. Allowed from 0.5 to 2.",
  },
  phoneLinkHoldMinutes: {
    what: "How many minutes a payment link sent from the phone line holds the rentals for the caller.",
    where: "Callers who choose a payment link: the rentals stay reserved for this long while they pay.",
    ifChanged: "New links hold for the new time. The spoken and texted words say the time, so change those words too if they mention it.",
  },
  adminLinkHoldMinutes: {
    what: "How many minutes a payment link sent by staff from New booking holds the rentals.",
    where: "Customers who get a payment link from staff.",
    ifChanged: "New links hold for the new time.",
  },
  salesTaxPercent: {
    what: "The sales tax percent added to every order, including the delivery fee.",
    where: "Customers: the tax line on the phone total, payment link, receipt and invoice. Staff: Bookkeeping sales tax reports.",
    source: "The Orange County, New York rate (8.125 percent).",
    calculation: "Tax = (rentals + delivery fee) × this percent ÷ 100, rounded to the cent.",
    example: "A $200.00 rental plus a $15.00 delivery fee at 8.125 percent: $215.00 × 8.125 ÷ 100 = $17.47 tax, total $232.47.",
    ifChanged: "New orders are taxed at the new rate; orders already placed keep theirs.",
    askAccountant: true,
  },
  zoneKjPlaces: {
    what: "Place names that count as Kiryas Joel for the delivery fee, one per line.",
    where: "Customers whose address matches one of these names get the Kiryas Joel fee when the map areas cannot decide.",
    ifChanged: "Addresses with the added or removed names get a different delivery fee on new orders.",
  },
  zoneAreaPlaces: {
    what: "Town names that count as the nearby-towns zone for the delivery fee, one per line.",
    where: "Customers whose address is in one of these towns, when the map areas cannot decide.",
    ifChanged: "New orders in these towns get the nearby-towns fee.",
  },
  ownerUsername: {
    what: "The Owner's sign-in username for Admin.",
    where: "Staff only: the Admin sign-in screen.",
    ifChanged: "The Owner signs in with the new username from then on.",
  },
  solaPhonePayOn: {
    what: "Lets callers pay by card on the phone through Sola PhonePay.",
    where: "Callers at checkout hear the choice to pay by card now.",
    ifChanged: "Off: callers only get a payment link.",
  },
  solaPhonePayOwnerOnly: {
    what: "Offers pay by card on the phone only to the test numbers below.",
    where: "Callers at checkout.",
    ifChanged: "On: other callers only get a payment link.",
  },
  solaPhonePayNumber: {
    what: "The Sola PhonePay phone number the system calls to take the card payment.",
    where: "Callers paying by card are connected to it.",
    ifChanged: "A wrong number breaks card payments on the phone. Change only on Sola's instruction.",
  },
  solaPhonePayBackup: {
    what: "Sola's backup PhonePay number, used if the main one does not answer.",
    where: "Callers paying by card.",
    ifChanged: "Change only on Sola's instruction.",
  },
  solaPhonePayDigits: {
    what: "The keys the system presses on the Sola call: waits, the merchant password and the amount.",
    where: "Callers paying by card (they hear Sola's voice, not these keys).",
    ifChanged: "Wrong keys stop payments from going through. Change only after a test call.",
  },
  solaPhonePayCustomDigits: {
    what: "The keys pressed for the Owner's custom charge from the Owner voicemail menu.",
    where: "Owner only: the Owner voicemail menu, key 7, when taking a custom card charge.",
    ifChanged: "Change only after a test call.",
  },
  solaPhonePayCustomCapCents: {
    what: "The highest custom charge the Owner can take by phone, in cents. 500000 means $5,000.00.",
    where: "Owner only: the custom card charge from the Owner voicemail menu.",
    ifChanged: "Charges above the new amount are refused.",
  },
  phonePayTriesPerCall: {
    what: "How many times a caller may try a card in one call.",
    where: "Callers paying by card whose card is declined.",
    ifChanged: "After this many tries the caller is offered a payment link instead.",
  },
  phonePayDeclinesPerDay: {
    what: "Older limit, replaced by the calls-per-day limit below. Kept for history.",
    where: "Not used for callers now.",
    ifChanged: "No effect on callers; the calls-per-day limit is the one in use.",
  },
  phonePayCallsPerDay: {
    what: "How many calls with card tries one phone number may make in 24 hours.",
    where: "Callers paying by card.",
    ifChanged: "After this many, the caller is only offered a payment link. Protects against card testing.",
  },
  phonePayDeclineHangupSeconds: {
    what: "After Sola says a card was declined, how many seconds to wait before hanging up the Sola call.",
    where: "Callers whose card is declined: so they do not hear Sola cut off mid-sentence.",
    ifChanged: "Too short cuts Sola off; too long adds silence.",
  },
  phonePaySilenceSeconds: {
    what: "Seconds of silence on the Sola call before the system checks the payment and moves the caller on.",
    where: "Callers paying by card.",
    ifChanged: "Shorter moves on faster but may cut a slow payment.",
  },
  solaListenOn: {
    what: "Uses the listening helper that hangs up the Sola call half a second after Sola stops talking.",
    where: "Callers paying by card.",
    ifChanged: "On: faster return to the caller after the result. Turn on only after a passed test call.",
  },
  paymentTestNumbers: {
    what: "Phone numbers that are treated as test callers for card payments, one per line.",
    where: "Only callers from these numbers when card payment is limited to tests.",
    ifChanged: "The new numbers get the test choices on the next call.",
  },
  phoneCardProvider: {
    what: "Which service takes card payments on the phone: Sola or Stripe.",
    where: "Callers paying by card.",
    ifChanged: "Switches the card service on the next call. Stripe is test numbers only until approved.",
  },
  deliveryAreas: {
    what: "The delivery map areas with their names and prices.",
    where: "Customers: the delivery fee on every order.",
    ifChanged: "Edited on the Delivery settings page by reloading the map.",
  },
  deliveryAreasLoadedAt: {
    what: "When the delivery map was last loaded. Filled in by the system.",
    where: "Staff only: shown on the Delivery settings page.",
    ifChanged: "Nothing to change by hand.",
  },
  localStreets: {
    what: "The Kiryas Joel streets that get the $10.00 delivery fee, one per line.",
    where: "Customers whose delivery address is on one of these streets.",
    ifChanged: "New orders on added or removed streets get a different fee.",
  },
  achirdWholeLine: {
    what: "Builds whole phone lines from recorded pieces (numbers, letters and rental names) whenever every piece is recorded.",
    where: "Callers hearing lines with changing parts.",
    ifChanged: "On: more of the call uses recordings instead of the computer voice.",
  },
  googleLiveVoice: {
    what: "Uses the Google voice for changing parts of phone lines. It costs money, so it stays off.",
    where: "Callers would hear it on lines with changing parts, such as names and prices.",
    ifChanged: "Do not turn on: it is a paid service.",
  },
  smsTestOnly: {
    what: "Sends customer texts only to the test numbers below.",
    where: "Every customer text.",
    ifChanged: "On: real customers get no texts. Off (the normal setting): every customer gets texts, consent rules unchanged.",
  },
  smsTestNumbers: {
    what: "The numbers that still get texts while texting is limited to tests, one per line.",
    where: "Test numbers only.",
    ifChanged: "Used only while the test-only switch is on.",
  },
  calendarEnabled: {
    what: "Closes the phone ringing and bookings for Shabbes and Yom Tov.",
    where: "Callers and customers on Shabbes and Yom Tov.",
    ifChanged: "Protected: cannot be switched off from Admin.",
  },
  calendarLatitude: {
    what: "The location used to work out halachic times (chatzos, candle lighting, nightfall): Monroe, New York.",
    where: "Every closing time on Fridays and holidays.",
    ifChanged: "Times move to match the new location.",
  },
  calendarLongitude: {
    what: "The east-west part of the location used for halachic times.",
    where: "Every closing time on Fridays and holidays.",
    ifChanged: "Times move to match the new location.",
  },
  erevShabbosClose: {
    what: "Erev Shabbes closes at chatzos (halachic midday) or at candle lighting.",
    where: "Callers and customers on Friday afternoons.",
    ifChanged: "Changes when the phone stops ringing and bookings close on Fridays.",
  },
  erevYomTovClose: {
    what: "Erev Yom Tov closes at chatzos or at candle lighting.",
    where: "Callers and customers on the day before Yom Tov.",
    ifChanged: "Changes the closing time on those days.",
  },
  candleLightingMinutes: {
    what: "Minutes before sunset for candle lighting.",
    where: "Every Friday and Erev Yom Tov closing that uses candle lighting.",
    ifChanged: "Closing moves earlier or later.",
  },
  reopenAfter: {
    what: "When the business reopens after Shabbes and Yom Tov: minutes after sunset (72 is Rabbeinu Tam), or nightfall.",
    where: "Callers on Motzei Shabbes and after Yom Tov.",
    ifChanged: "Changes when the phone starts ringing again.",
  },
  closeCholHamoed: { what: "Closes on Chol Hamoed.", where: "Callers and customers during Chol Hamoed.", ifChanged: "Yes: no ringing or deliveries on those days." },
  closeChanukah: { what: "Closes on Chanukah.", where: "Callers and customers during Chanukah.", ifChanged: "Yes: no ringing or deliveries those days." },
  closePurim: { what: "Closes on Purim.", where: "Callers and customers on Purim.", ifChanged: "No: open on Purim." },
  closeTishaBav: { what: "Closes on Tisha B'Av.", where: "Callers and customers on Tisha B'Av.", ifChanged: "No: open on Tisha B'Av." },
  closeMinorFasts: { what: "Closes on the minor fast days.", where: "Callers and customers on fast days.", ifChanged: "Yes: closed on those days." },
  closeLagBaomer: { what: "Closes on Lag Ba'omer.", where: "Callers and customers on Lag Ba'omer.", ifChanged: "Yes: closed that day." },
  calendarOverrides: {
    what: "Dates the Owner opens or closes by hand, one per line, for example \"2027-01-01 closed\".",
    where: "Callers and customers on those dates.",
    ifChanged: "Edited on the Holidays page; the date follows the new rule.",
  },
  hoursSchedules: {
    what: "Every phone line's hours, groups and date changes.",
    where: "Callers: whether staff phones ring, and the hours spoken on key 7.",
    ifChanged: "Edited on the Hours page.",
  },
  hoursMonThu: { what: "Office hours Monday to Thursday.", where: "Website hours and live calls.", ifChanged: "The website and the phone follow the new hours." },
  hoursFridayOpen: { what: "Friday opening time; Friday closing follows the Erev Shabbes rule.", where: "Website hours and live calls.", ifChanged: "Friday opens at the new time." },
  hoursSunday: { what: "Sunday office hours.", where: "Website hours and live calls.", ifChanged: "Sunday follows the new hours." },
  hoursMotzeiOpen: { what: "Motzei Shabbes opening: for example 2 hours after Shabbes ends.", where: "Website hours and live calls on Saturday night.", ifChanged: "Saturday night opens at the new time." },
  hoursMotzeiCloseWinter: { what: "Motzei Shabbes closing time in winter.", where: "Saturday night calls in winter.", ifChanged: "Saturday night closes at the new time." },
  hoursMotzeiCloseSummer: { what: "Motzei Shabbes closing time in summer.", where: "Saturday night calls in summer.", ifChanged: "Saturday night closes at the new time." },
  hoursMotzeiSeason: { what: "Which Motzei Shabbes closing applies: summer while the clocks are on summer time.", where: "Saturday night calls.", ifChanged: "Switches between the winter and summer closing rule." },
  hoursCholHamoed: { what: "Office hours on Chol Hamoed.", where: "Website and live calls during Chol Hamoed.", ifChanged: "Chol Hamoed follows the new hours." },
  hoursChanukah: { what: "Office hours on Chanukah.", where: "Website and live calls during Chanukah.", ifChanged: "Chanukah follows the new hours." },
  hoursWebsiteNote: {
    what: "The note shown under the hours on the website.",
    where: "Website visitors, in the hours section.",
    ifChanged: "Visitors see the new note. Customer words: needs the Owner's approval.",
  },
  operatorTargets: {
    what: "The staff phones that ring when a caller presses 0 to speak to someone, one per line: \"Name | phone number | ring seconds\". Blank rings the Owner's phone.",
    where: "Callers who press 0.",
    ifChanged: "The next call rings the new list. Test a call after changing it.",
  },
  operatorMode: {
    what: "How the key 0 phones ring: one after another (sequential) or all at once (simultaneous).",
    where: "Callers who press 0 hear hold music either way.",
    ifChanged: "Simultaneous reaches someone faster but rings everyone.",
  },
  operatorAcceptPrompt: {
    what: "The staff member must press 1 to accept a key 0 call, so a personal voicemail cannot take it.",
    where: "Staff only: the staff member hears the announcement and presses 1. The caller keeps hearing hold music until then.",
    ifChanged: "Off: calls connect as soon as the staff phone picks up.",
  },
  operatorAcceptText: {
    what: "Older setting for the staff accept words. The announcement now comes from each line's settings.",
    where: "Not used for callers now.",
    ifChanged: "No effect on callers or staff; each line's announcement setting is the one in use.",
  },
  blockedCallers: {
    what: "Phone numbers that are blocked, one per line: an exact number, a pattern, or \"withheld\".",
    where: "Blocked callers hear a busy signal and are not connected.",
    ifChanged: "Takes effect on the next call. A wide pattern can block real customers.",
  },
  sensitiveSwitchGuard: {
    what: "When on, turning on call recording, the paid Google voice, phone card payments or Stripe asks for a fresh code sent to the Owner's own phone and typed words, so none of them can be turned on by a stray click or on a device left signed in.",
    where: "Owner only: the Phone settings, Hotline prompts slots and phone card payment pages, at the moment one of those is turned on. Turning them off is never blocked.",
    ifChanged: "On: those four need the code and the typed words to turn on. Off: they turn on with their own checks only, as before.",
  },
  callRecording: {
    what: "Records calls. Every caller would hear the recording notice first.",
    where: "Every caller.",
    ifChanged: "Stays off until the Owner approves the notice wording.",
  },
  stockAddress: {
    what: "The warehouse address where the delivery run starts and ends.",
    where: "Staff only: route links on the Delivery screen.",
    ifChanged: "Routes start and end at the new address.",
  },
  menuOrders: {
    what: "The order of the recordings in each phone menu.",
    where: "Callers hearing a menu.",
    ifChanged: "Edited on the Menu order page; callers hear the new order.",
  },
  offersStacking: {
    what: "What happens when an order qualifies for more than one saving (a customer discount and the 4th Sunday free). \"best\": only the biggest saving applies (how it has always worked). \"add\": both apply together, on top of the laser tag half price, and the discount is never more than the rentals cost.",
    where: "Customers: the discount on the order total on the phone, the payment link, the receipt and New booking. Thursday to Sunday, holiday weeks and closed-day prices never combine with anything, either way.",
    ifChanged: "New orders are priced with the new rule; orders already placed keep their price.",
    example: "A $300.00 order with a 10 percent customer discount ($30.00) that also gets a 4th Sunday worth $75.00: best takes off $75.00; add takes off $105.00.",
  },
  paidPromoSkipOptedIn: {
    what: "After a card payment, skips Line 8 (the seasonal offers by text question) for a caller whose number already gets promotional texts.",
    where: "Callers who just paid by card on the phone, right before the last goodbye line.",
    ifChanged: "Off: every paying caller hears the offers question, even if already signed up. A number that replied STOP never hears it either way.",
  },
  disconnectSilenceMinutes: {
    what: "How many minutes a caller with items in the cart can stay silent (no key pressed) before the phone asks whether the call got disconnected.",
    where: "Callers in the middle of a booking with items in the cart. Callers with an empty cart keep the usual timing.",
    ifChanged: "A bigger number waits longer before asking; a smaller number asks sooner. Allowed from 1 to 10 minutes.",
  },
  disconnectCheckSeconds: {
    what: "How many seconds the phone waits for a key after asking \"It sounds like we got disconnected. To continue, press any key.\"",
    where: "Callers with items in the cart who stayed silent for the minutes above.",
    ifChanged: "Any key in this time returns the caller to the exact step they were on. With no key, the goodbye line plays and the call ends. Allowed from 1 to 15 seconds.",
  },
  holidayPerDayChanukah: { what: "Chanukah rentals are charged one price per booking day, picked up the next morning.", where: "Customers booking during Chanukah.", ifChanged: "Off: normal pricing during Chanukah." },
  holidayPerDayCholHamoed: { what: "Chol Hamoed rentals are charged one price per booking day, picked up the next morning.", where: "Customers booking during Chol Hamoed.", ifChanged: "Off: normal pricing during Chol Hamoed." },
  holidayNoPromos: { what: "No offers or discounts during Chanukah and Chol Hamoed weeks.", where: "Customers booking those weeks.", ifChanged: "Off: offers can apply those weeks." },
  holidayPickupAfterShabbesMin: { what: "During those weeks, Friday rentals are picked up this many minutes after Shabbes.", where: "Customers with a Friday holiday rental.", ifChanged: "Pickup moves earlier or later." },
  holidayMutzeDeliveryAfterMin: { what: "Motzei Shabbes deliveries start this many minutes after Shabbes ends.", where: "Customers booking for Saturday night.", ifChanged: "Deliveries start earlier or later." },
  holidaySundayPickup: { what: "The pickup time on Sunday morning for holiday rentals.", where: "Customers with a Saturday night holiday rental.", ifChanged: "Pickup moves to the new time." },
  holidayFridayMutzeDays: { what: "How many rental days are charged for Friday plus Motzei Shabbes.", where: "Customers keeping a rental from Friday through Saturday night.", ifChanged: "The price for that booking changes on new orders." },
  holidayMutzeAloneDays: { what: "How many rental days are charged for Motzei Shabbes alone.", where: "Customers booking only Saturday night.", ifChanged: "The price for that booking changes on new orders." },
};

export const CONFIG_EXPLANATIONS: Record<string, Explanation> = { ...OTHER, ...RING, ...BOOKS, ...TIMERS };

/** Plain-English helpers for the page. */
export const ACCOUNTANT_NOTE = ACCOUNTANT;
export function configExplanation(key: string): Explanation | null {
  return CONFIG_EXPLANATIONS[key] ?? null;
}

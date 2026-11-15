# Admin help drafts, batch 1: Bookings

Drafts for Abraham's approval (Nov 15, 2026). Nothing here is live. For each row, answer OK, or change the new text.
"Current text" is what the page says today ("none" = nothing there today). Every word is spelled out (only "it's").

## A. New booking (Owner and Secretary)

| # | Item | Current text | New text (draft) |
|---|---|---|---|
| A1 | Line under the title | none | Use this page to book rentals for a customer who calls the office or comes in. Follow the steps below from top to bottom. |
| A2 | Step guide (top of page) | none | 1. Pick the delivery date. 2. Add the items and how many. 3. Find or add the customer. 4. Check the delivery address; the delivery price appears by itself. 5. Review the total. 6. Choose how the customer pays. 7. Press Book. |
| A3 | Event date, label | Event (delivery) date — pickup is the next open day | Delivery date (required) |
| A4 | Event date, hint | none | The day of the party. We pick up on the next open day (after Shabbes or Yom Tov if needed). Only days we are open can be picked. |
| A5 | Before a date is picked | Pick a date to see what's available. | Pick a delivery date first. Then every item shows how many are free on that day. |
| A6 | Items, hint | none | Press plus to add one. The number on each item is how many are still free on that date. An item showing 0 is fully booked, held for another customer, or in repair: try another date or a similar item. |
| A7 | Full name | placeholder "Full name *" | Label: Customer name (required). Hint: First and last name, for example Yossi Friedman. |
| A8 | Mobile phone | placeholder "Mobile phone" | Label: Mobile phone. Hint: 10 digits, for example (845) 555-0123. The payment link and order texts go to this number. If the customer is already in the system, their details fill in. |
| A9 | Email | placeholder "Email (optional)" | Label: Email (optional). Hint: For the receipt and, if the customer has no text consent, the payment link. |
| A10 | Delivery address | placeholder "Delivery address" | Label: Delivery address (required). Hint: House number, street, town and ZIP, for example 12 Forest Road, Monroe, NY 10950. Add the apartment or unit at the end. The delivery price comes from where the house is on our price map: $10 inside Kiryas Joel, $15 in the nearby areas, $20 outside them. Nobody can change it by hand. |
| A11 | Address not found | none | We could not find this address on the map. Check the house number, street, town and ZIP. |
| A12 | Notes | placeholder "Notes" | Label: Notes for the driver and office. Hint: Gate code, where to set up, the best time to call. The driver sees these notes. |
| A13 | Terms accepted by | Customer accepted the Terms and Conditions by * | Label: How the customer accepted the Terms and Conditions (required). Hint: Read the Terms to the customer or send them, then pick how they said yes. |
| A14 | Text consent boxes | (the approved consent wording) | Hint above the boxes: Read the wording to the customer exactly as written. Check a box only if the customer said yes to it. |
| A15 | Payment choices, hint | none | Payment link: the customer gets a secure link by text and the items are held for 25 minutes. Cash or Check: enter the amount you received now. Pay on delivery: the driver collects; the order stays unpaid until then. |
| A16 | Amount received | placeholder "Amount received" | Label: Amount received. Hint: In dollars, for example 245.00. A smaller amount leaves a balance due on the order. |
| A17 | Book button | Book | Book (the order is saved and the items are held or confirmed) |
| A18 | Shabbes and Yom Tov box | Booking is closed on {Shabbes}. It opens again at {time}. This happens by itself; nothing to switch. | Keep as is. |

## B. Orders (Owner and Secretary)

| # | Item | Current text | New text (draft) |
|---|---|---|---|
| B1 | Line under the title | none | Every booking, from the phone line and from staff. Open an order to see it, take payment, send the payment link, or cancel it. |
| B2 | Search box | Name, phone, address or order number | Keep as is. Hint: For example Friedman, 555-0123, Forest Road or 1438. |
| B3 | Filter "Open" | Open (unpaid, confirmed, out) | Open: not yet paid, confirmed, or out for delivery |
| B4 | Empty list | No orders match. | No orders match your search. Clear the search, or press New booking to add the first one. |
| B5 | Caller in progress | Caller in progress | A caller is booking these items on the phone right now. The items are held until the call ends or 10 minutes pass with no key pressed. |

## C. Order statuses (badges on every page)

| # | Badge | Current text | New tip (draft) |
|---|---|---|---|
| C1 | On hold · in call | none | A caller is booking on the phone right now. The items are held while the call goes on. Nothing to do. |
| C2 | Awaiting payment | none | The customer has a payment link. The items are held until {time}. If no payment comes in by then, the hold ends and the items go back in stock. To keep them, send the link again. |
| C3 | Confirmed | none | Paid. The items are booked for the delivery date. Next: assign a driver on the Deliveries page. |
| C4 | Delivered | none | The driver dropped off the items. Next: pickup on the pickup date. |
| C5 | Picked up | none | Done. The items are back and free for other bookings. |
| C6 | Cancelled | none | This booking is cancelled and the items are free again. If the customer paid, check that the refund was made. |
| C7 | Needs staff attention | (existing box text) | Keep the existing box. |

## D. The order page

| # | Item | Current text | New text (draft) |
|---|---|---|---|
| D1 | Line under the title | none | Everything about this booking: items, delivery, payment, texts, and its full history. |
| D2 | Totals line | Rentals · Delivery · Sales tax | Keep. Hint: The delivery price comes from the house's spot on the price map and can't be changed by hand. Sales tax is the county rate on rentals plus delivery. |
| D3 | Balance due | Balance due {amount} | Keep. Hint: Send the payment link, or record cash or a check below. |
| D4 | Hold time | none | Held until {time}. After that, the items go back in stock. |
| D5 | Send payment link button | (button) | Confirm step: "Send a secure payment link for {amount} to {phone}? The items stay held for 25 minutes." |
| D6 | Cancel button | (button) | Confirm step: "Cancel order {number}? The items go back in stock. If the customer paid, a refund is a separate step (Owner only)." |
| D7 | Refund (Owner only) | (existing panel) | Hint: The money goes back to the same card. A refund can't be undone. Only the Owner can refund. |
| D8 | Phone card tries | Phone card try {n}: {time}, {result} | Keep. Hint: Each try the caller made to pay by card on the phone. Card numbers are never shown or kept. |
| D9 | No delivery price | (the reason) | Keep the reason. It always says what to fix (for example, the address could not be found). |

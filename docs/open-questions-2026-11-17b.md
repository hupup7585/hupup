# Hup Up Attractions: open questions (Nov 17, 2026, second list)

Please write your answer under each question.

## From the New Additions message

**1. Pressing 1 in payment (item 6):** which call was it, and what did you hear right before you pressed 1?
- a) A customer booking: "Your card did not go through. To try again, press 1."
- b) Your own custom charge (voicemail access, then 7): "You entered ... dollars and ... cents. Press 1 to confirm, or 2 to enter it again."
- c) Something else (please write the line you heard)

Answer:

**2. "Please note" line (item 2):** it is the line "Please note, orders can be placed only through our automated system. For information or questions, press 0 for customer service." It plays every time the bookings menu plays, so it also plays when a caller presses 1 to keep shopping.
- a) Take it off only when the caller comes back to add more items (it still plays the first time)
- b) Take it off completely

Answer:

**3. Description and dimensions on the website (item 3):** you told me earlier not to change the landing page. Today the landing page shows the 3 categories, but not the items in them. To show descriptions and dimensions, it needs a list of items under each category.
- Show the item name, description and dimensions? Prices too?
- The label: "Dimensions:" (for example "Dimensions: 15 by 15 feet")?

I will build it on the preview site only and send you a screenshot before it goes live.

Answer:

**4. Discounts (item 8):**
- a) "Website only, not on the phone line": the discount comes off on the payment link page and in Admin, and the phone never mentions it. When the phone reads the total, should it read the total before the discount (the customer then sees the lower amount on the payment page), or the total after it?
- b) Does the discount come off before sales tax (tax on the lower amount)?
- c) A discount for a specific customer: one time only (the next booking), or every booking until you turn it off? Is there an end date?
- d) Can a discount go together with an offer (third laser pack, Thursday to Sunday, 4th Sunday), or only one of them, whichever saves more?

Answer:

**5. Music while ringing (item 5):** today a caller hears normal phone ringing while the staff phones ring. To play music instead, the caller is put on hold (with your music) while the system rings the staff, then connected when someone presses 1. OK to do it that way?

Answer:

**6. Payment music (item 4):** to play music while the system enters the merchant code and the amount, the caller waits on hold with the music while a separate call to Sola enters them, and the two calls are joined when Sola is ready for the card. The cost stays about the same (one call to Sola either way). One change: while entering the card, the caller can no longer press star to come back to our line (the call comes back by itself when Sola finishes or hangs up). OK?

Answer:

**7. Speech input cost (item 1):** Google Speech-to-Text with data logging off costs about 2.4 cents a minute after the first 60 free minutes each month (most answers are a few seconds). This is the paid part you asked for. OK to turn it on?

Answer:

**8. info@ emails by text (item 9):** a long email is cut to fit one text (up to about 1,600 characters, with "... (more in the Admin inbox)"). Texts to 845-777-7585 go out from the hotline number; until Twilio approves texting (A2P), they may not arrive, and the email stays in the Admin inbox as now. OK?

Answer:

## Still open from before

**9. Keypad typing, "wait one second" (address steps item 3):** Twilio sends us all the typed keys at once, with no timing, so the phone cannot tell that a caller waited one second. Please choose:
- a) "If the next letter is on the same key, press 1 first." Everything else as you wrote (star once erases, star twice is a space, pound is done).
- b) Keep pressing star between two letters on the same key (how it works now), and change your instructions to match.

Answer:

**10. Boxes 9 and 10:** the prompt sheet with box numbers is not in the system. Please send the wording of boxes 9 and 10 so I take the right lines off.

Answer:

**11. Payment page note:** it still says "After you tap Agree and pay, you will have 10 minutes to enter your card details..." Your new rule is 10 minutes from the text, plus 4 once the link is opened. New wording, or take the sentence out? (It shows on the preview site only, with the Terms box.)

Answer:

**12. Date example:** the event date question says "For example, for March 5th, press 0, 3, 0, 5." Change to "for March 5"?

Answer:

**13. Kiryas Joel in the address read-back:** the town comes from the zip, so a 10950 address is read back as "Monroe, New York", Kiryas Joel streets too. Keep "Monroe", or read "Kiryas Joel" for streets inside the village?

Answer:

## Already done (no question)

- Item 7, catalog delivery: the photo catalog already goes by text (MMS: picture 1 with the words, then picture 2), and the catalog email already has the PDF attached.
- Maze: one maze, one booking a day (confirmed).

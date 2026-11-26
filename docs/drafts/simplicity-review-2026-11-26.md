# Simplicity review, website and Admin (Abraham, Nov 26, 2026, 4:07 PM)

Abraham: "It must be easy as the rule. When I click on a button, it's not clicking." Every page was opened on a
tablet-size screen (1024 wide) and checked automatically: buttons that do nothing, buttons too small to tap, how many
main buttons compete on one page, duplicate labels, and how much there is to read. 50 pages checked.

## Done and live (no layout change)

| Page | What changed |
|---|---|
| Staff | "Set password" was greyed out until typed; now it answers "Type a password of at least 10 characters first." The username boxes are no longer filled in by the browser (the stray value). |
| Order page | "Send payment link by text" was greyed out with no reason; now it says "This customer has no mobile number..." or "Nothing is left to pay on this order." |
| Compliance | "Report to the owner now" was greyed out until typed; now it says "Type what happened first." |
| Messages (texts) | "Send text" was greyed out when empty; now "Type a message or attach a file first." Attach says when 10 files is the limit. |
| Inbox (email) | "Send" was greyed out; now it says what is missing (who, subject, message), or that email sending is not set up yet. |
| Delivery app | "Send to the office" (problem) was greyed out until typed; now "Type what went wrong first." |
| My account | "Sign out all other devices" was greyed out with one device; now it always works and says the result. |

Buttons still greyed only while a save is running ("Saving...") or where the choice does not exist (the first item's
"Move up", past dates on the booking calendar).

## Built, waiting for Abraham's OK (screenshots sent)

| Page | Proposed |
|---|---|
| Staff | One row per person (name, role, phone, Edit). Edit opens one form with every field, help under each, one Save. Deactivate separate with "Are you sure?". The Owner's own username is in the Owner's own Edit form. Preview: /admin/staff?new=1 |

## Next, one page at a time (mock-up first, then live after Abraham's OK)

The audit found these pages hardest to use, biggest first:

1. **Hotline prompts** (839 buttons, about 28,000 words on one page). Proposed: show one extension at a time (a
   list of extensions first, tap one), each line as one card with Play, Upload and Approve; the history and drafts
   behind a "More" link.
2. **Recording library** (about 23,000 words). Proposed: search box first and a short list; full details only after
   tapping a line.
3. **Catalog** (274 input boxes, 29 main buttons). Proposed: a list of items with a picture, price and Edit; one item
   opens in its own form with one Save.
4. **Messages** (about 10,000 words). Proposed: the newest 25 conversations, with "Show more".
5. **Phone settings** (84 boxes, 11 Save buttons). Proposed: one section per subject (ringing, voicemail, texts),
   each with its own Save, closed until tapped.
6. **Order page** (up to 18 buttons). Proposed: the three main actions (Confirm, Send payment link, Record payment)
   at the top; everything else under "More actions".
7. **Call log**: the "Block" buttons are small and repeat on every row; proposed one bigger "Block this number"
   inside each call's details.
8. **Customer directory sheet**: 22 small buttons; proposed bigger row menus for tablets.

Public website (home, rentals, SMS terms, privacy, terms): no dead or small buttons found; no change proposed.

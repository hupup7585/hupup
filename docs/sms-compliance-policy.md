# Hup Up Attractions — SMS Compliance Policy

**Status:** draft for Abram to review and approve. Not legal advice; have counsel review before relying on it.
**Applies to:** everyone who sends, schedules or manages customer text messages for Hup Up Attractions (owner, secretaries, delivery staff), and the automated systems (phone menu, website, admin).
**Owner of this policy:** Abram Schwartz. Review it at least once a year and whenever the law, carrier rules or our texting programs change.

## 1. Our two texting programs
| Program | What it covers | How someone joins |
|---|---|---|
| **Order and service texts** (transactional) | Reservations, orders, payments, deliveries, pickups, customer service | Separate consent on the website (unchecked box), on the phone menu (press 1 or say yes), or with staff reading the disclosure |
| **Promotional texts** (marketing) | Offers, discounts, seasonal and new-product news | A separate, explicit consent only. Never automatic, never pre-checked, never a condition of purchase |

All texts are sent from the Hup Up Attractions hotline texting number through our messaging provider (Twilio), under our registered A2P 10DLC campaign.

## 2. Consent
- **Get consent before texting.** Order texts need order-text consent. Promotional texts need promotional consent. One does not imply the other.
- **Exact disclosure.** Use only the approved consent wording on the website, phone menu and staff screens. It states: the business name, what the texts are about, that we may share the number with service providers only as necessary to deliver the messages, "Message frequency varies", "Message and data rates may apply", "Reply STOP to opt out or HELP for help", and, for promotions, "Consent is not a condition of purchase".
- **Never enroll anyone in promotions automatically,** and never check the box for them. A missed, unclear or uncertain answer is a "no".
- **Phone menu consent.** The system records the exact disclosure version, the key the customer pressed or their spoken answer (with the transcript), the date and time, and the phone number. Only a clear affirmative reply to the yes/no question counts ("yes", "yes please", "I agree"); "sure", "okay", "I guess", silence, or an unclear answer is not consent.
- **Staff-taken consent** (by phone or in person, in the admin "Text message consent" panel on the order):
  1. Read the **entire** approved disclosure shown in the panel, word for word. Don't summarize or skip parts.
  2. Check "I read the entire disclosure above to the customer, word for word." The system will not record a yes without it.
  3. Record the answer. Only "Customer clearly said yes" is consent. **Silence, uncertainty, or an unclear response counts as no consent:** choose "No clear answer, unsure, or silent".
  4. For promotional consent, ask which time zone the customer is in and record it.
  Never record consent the customer did not give, and never record it on someone else's behalf.
- **Time zone.** Ask for and record the customer's actual time zone (website form, phone menu, or staff). Don't rely on the area code alone, because people keep their number when they move.
- **Confirmation.** After someone joins a program, the system sends one confirmation text for that program. The order-texts and promotional confirmations have different wording. The promotional confirmation only confirms enrollment and never contains an offer or advertisement.

## 3. Approved templates
- Send customers only **approved templates** created by the Owner in the admin (booking confirmation, payment link, payment reminder, delivery on the way, delivery completed, delay, pickup reminder, and approved promotions).
- Delivery staff can send templates only; the system rejects free-typed text from delivery accounts.
- Do not put card numbers, passwords or other sensitive data in texts. The system blocks messages that look like card numbers.

## 4. Promotional messages
- **Required opening:** every promotional text begins with exactly
  > **Hup Up Attractions: Reply STOP to opt out.**
  and the offer comes after it. The system adds this automatically.
- **Only to customers with promotional consent** who have not opted out. The system enforces this; never try to work around it (for example by sending a promotion as a "service" text).
- **Quiet hours:** promotional texts go out only between **8:00 a.m. and 9:00 p.m. in the recipient's local time zone.**
  - The system uses the time zone the customer gave us (website, phone menu, or staff).
  - If we don't have it, the documented fallback is: send only when it is inside the window **both** in the area-code time zone(s) (every zone, if the area code covers more than one) **and** in New York (Eastern) time. Unknown area codes use New York time.
  - Promotions outside the window are blocked and logged; never resend them by another route.
- Keep promotions truthful, clear and relevant to our rentals.

## 5. Opt-outs
- Customers can revoke consent at any time by replying **STOP, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT** or **REVOKE**, or with any other reasonable message that clearly asks us to stop (for example "please stop texting me", "remove me from your list").
- The system applies opt-outs to the relevant program **immediately**: STOP (and the other keywords) covers all texts, both order and service texts and promotional texts, until the customer re-enrolls in each program; NOPROMO covers promotions only. Promotional texts that were already queued or scheduled for that customer are canceled at once and never sent. Every send also re-checks consent at the moment it goes out. Twilio also blocks further texts to that number until the customer texts START.
- At most **one non-promotional confirmation** may be sent after an opt-out. After that, **no promotional texts** to that customer, and no other texts until they opt back in.
- If a customer asks a staff member by phone, in person or by email to stop texting, record the opt-out in the admin the same day. Never later than the legal deadline (10 business days where the federal rule applies).
- **NOPROMO** is our own internal keyword that stops **promotional texts only**; order texts continue. NOPROMO does not restart promotional messages after a STOP and never undoes a STOP. To receive promotional texts again after opting out, a separate new promotional opt-in is required.
- Never ask a customer to give a reason for opting out, and never send a "we'll miss you" promotion.

## 6. Records
- The system keeps, for **at least 24 months** (and longer where the law requires):
  - **Consent records:** phone number, program (order or promotional), decision, date and time, method (website checkbox, keypad, voice, staff), the exact disclosure shown or spoken and its version, plus call, IP and browser details where available.
  - **Consent changes and opt-out history,** including the message the customer sent.
  - **Message history:** every text sent and received, including promotions, with its delivery status.
- **Original consent records are never edited or deleted.** The database rejects any change or deletion. A correction is a separate, dated entry with the reason, who made it, the date and time, a reference to the original record, and the corrected information. Corrections can only withdraw consent; they can never create it. The newest entry is the current consent.
- Message records can't be deleted for 24 months, and their content can't be changed (delivery status updates still apply).
- Records are kept for at least 24 months, or longer where the law requires. Nothing deletes them automatically before then.
- Never export these records except as the Owner approves for a legal or compliance request.

## 7. Protecting customer information (security)
- **Restricted access.** Only authorized staff with their own login can see customer phone numbers, consent records and messages, and only as their role needs: Owner and Secretary can record consent; Delivery accounts cannot; consent records and message history are not shown to Delivery accounts. The Owner removes access as soon as someone leaves or changes role.
- **Secure storage.** Records are stored only in our system's database and with our service providers (encrypted connections and encrypted storage). Don't copy customer lists, consent records or messages to personal phones, email, paper, or spreadsheets.
- Use customer phone numbers and messages only to run our business and our texting programs.
- Share them only with service providers (messaging, phone, payment and technology providers) as necessary to deliver and operate the messaging program. Never sell them, and never share them with third parties for their own marketing.
- Use only your own staff login. Don't share passwords or sign-in codes, and sign out of shared devices.
- **Immediate reporting.** Report any suspected unauthorized access to, or disclosure of, customer information (including a lost or stolen device, a shared password, a message sent to the wrong person, or an unexpected login) to the Owner **immediately**, the same hour if possible. The Owner records the incident, secures the account or system (for example, revokes sessions and changes passwords), and handles any notice required by law.

## 8. Help requests
- Customers can reply HELP, call (845) 777-7585, or email hupupattractions@gmail.com. Answer help requests promptly and politely.

## 9. Training
- Every employee who sends or manages customer texts completes training **before** getting texting access, and again **every year** or when this policy changes.
- Training covers: the two programs and consent; reading the entire disclosure and treating silence or an unclear answer as no consent; recording the customer's time zone; approved templates; the required promotional opening; quiet hours; opt-outs (keywords, other requests, and NOPROMO); records and corrections; security and immediate reporting; and what to do if something goes wrong.
- The Owner keeps a training log: employee name, date, version of this policy, and their acknowledgment.

### Employee acknowledgment
> I have read and understand the Hup Up Attractions SMS Compliance Policy. I will use approved templates, respect customer consent, observe promotional quiet hours, process opt-outs, protect customer information, and never send promotional messages to customers who have not given promotional consent.
>
> Name: ____________________  Signature: ____________________  Date: ____________

## 10. Violations
Breaking this policy can lead to losing texting access and other discipline. Report mistakes right away (for example a text sent to someone who opted out) so they can be corrected and recorded.

## 11. Consent Withdrawal and Re-Enrollment
- Customers may withdraw consent at any time. Once consent is withdrawn, the Company must immediately update the customer's messaging status and prevent further messages of the applicable category, except for a permitted confirmation of the withdrawal.
- A customer may re-enroll only after providing new, affirmative consent through an approved enrollment process. The new consent must be documented separately from the previous consent history.

**How the system enforces this:**
- **Withdrawal is immediate.** STOP (or any other opt-out keyword or clear request) turns off all texts for that number at once; NOPROMO turns off promotional texts only. Promotional texts already queued or scheduled are canceled. Every send re-checks the customer's status at the moment it goes out.
- **Only the withdrawal confirmation may follow.** After STOP, the system blocks every other text to that number, including enrollment confirmations and other automatic messages; the only exception is the single opt-out confirmation.
- **Approved enrollment processes** are the website sign-up form, the phone menu consent questions, and staff reading the entire disclosure in the admin consent panel. After a STOP, the only way back to order and service texts is **START followed by YES**: START sends a confirmation text and opens a pending confirmation for 24 hours; only a YES reply to that active confirmation restores order and service consent. A YES at any other time, after the 24 hours, or after a new STOP does nothing. START and YES never restore promotional texts; those need a new promotional opt-in. Staff cannot turn texts back on for a customer who replied STOP (no checkbox, panel answer, correction, or profile change can do it), and blocked attempts are written to the audit log.
- **Documented separately.** A re-enrollment is saved as a new consent record linked to the withdrawal it follows. The earlier consent and withdrawal records stay exactly as they were.

## 12. System Controls and Compliance Monitoring
- The Company messaging system must enforce this policy automatically wherever technically possible. Required controls include separate transactional and promotional consent records, approved message templates, promotional quiet-hour restrictions, automatic opt-out processing, employee permissions, and retention of communication records.
- Management must periodically review system activity, employee access, consent records, opt-out processing, and promotional message history. Any suspected compliance failure must be reported to the policy owner immediately and corrected promptly.

**How the system enforces this:**
| Required control | How it is enforced |
|---|---|
| Separate transactional and promotional consent records | Every consent decision is its own record with its program (order texts or promotional), and the two are asked, stored and checked separately. Records can't be edited or deleted. |
| Approved message templates | Customers only receive messages written into the system (order and payment texts, confirmations, opt-out replies). Staff have no free-form text box today; when staff texting is added, it will be template-only for Delivery and owner-approved templates for everyone. |
| Promotional quiet hours | Every promotional text is checked at the moment of sending against 8:00 a.m. - 9:00 p.m. in the customer's time zone (or the documented fallback) and blocked outside it. |
| Automatic opt-out processing | STOP, the other keywords and clear stop requests are processed automatically and immediately; queued promotions are canceled; only the opt-out confirmation may follow. |
| Employee permissions | Every admin page and action requires a signed-in staff account. Recording consent is limited to Owner and Secretary; the compliance review is Owner-only; Delivery accounts can't record consent. Actions are written to the audit log. |
| Retention of communication records | Consent records are permanent; message records can't be deleted for 24 months or have their content changed (database rules). |

**Periodic review (Owner):**
- At least every **30 days**, the Owner opens **Admin > Compliance** and reviews: the automatic checks, employee access (who has an account, role, active sessions), consent records, opt-outs processed, and promotional message history. The page flags "Review due" when 30 days have passed.
- The automatic checks look for: promotional texts sent without promotional consent at that time; promotional texts sent outside quiet hours; promotional texts missing the required opening; any text sent after a STOP and before new consent; and staff opt-ins recorded without the full disclosure.
- The Owner marks the review complete, with notes. The system records who did it, when, and how many issues the checks showed.
- Each issue found is corrected promptly (for example, removing an employee's access, adding a correction entry, or fixing a template), and the fix is noted in the review.

**Reporting a suspected failure:**
- Any employee reports a suspected compliance failure or unauthorized access **immediately** using **Admin > Compliance > Report**. The Owner (policy owner) is texted and emailed right away, and the report is kept in the audit log.
- The Owner investigates, corrects the problem promptly, and records what was done in the next review notes.

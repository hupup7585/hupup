# Draft: SMS Terms and Twilio campaign wording for press-1 promo sign-up

Prepared Nov 26, 2026, after Abraham's answer (13:12 to 13:15 ET): press 1 on the after-payment offers question
(Line 8) signs the number up right away, followed by one confirmation text. **Nothing below is live.** Each change
needs Abraham's "y" on the exact words before it is published; the Twilio campaign change is made by the Owner in the
Twilio console (free, but it starts a new review of the campaign).

## 1. SMS Terms, "How to Join Promotional Texts" (src/app/sms-terms/SmsTermsV3.tsx)

**Live now:**
> You may request our confirmation text by checking the promotional box on our website, pressing a key on our phone
> line, asking our team, or texting JOIN to (845) 415-7585. You are enrolled only when you reply YES to that
> confirmation text within 24 hours. Your YES reply is your express written consent. Texting JOIN alone does not enroll
> you.

**Draft (proposed):**
> You can join in two ways. On our phone line, after a paid order, you hear what the program is (seasonal offers by
> text, up to 5 messages a year) and press 1 to sign up; we then text you a confirmation that you are signed up, and
> you can reply STOP at any time. Or request our confirmation text by checking the promotional box on our website,
> asking our team, or texting JOIN to (845) 415-7585; you are then enrolled when you reply YES to that confirmation
> text within 24 hours. Consent is not a condition of purchase.

## 2. The confirmation text after press 1 (src/lib/sms-terms-v2.ts, PROMO_ENROLLED_SMS)

**Used now (placeholder until Abraham approves):**
> Hup Up Attractions: You are signed up for seasonal promo texts, up to 6 per year. Msg & data rates may apply. Reply
> NOPROMO to stop promos, STOP to stop all texts, HELP for help.

**Needs his exact words.** Open points: "up to 6" versus "up to 5" (Line 8 says 5; the cap is still 6); whether to
keep NOPROMO in it; the Terms link.

## 3. Twilio A2P campaign (Owner, in the Twilio console)

The registered campaign describes opt-in. It must match how people really join, or carriers can flag the campaign.

- **Message flow / opt-in description, draft addition:** "Callers who complete a paid booking on our phone line hear
  a description of the promotional program (seasonal offers, up to 5 messages per year, message and data rates may
  apply, reply STOP to opt out) and press 1 to opt in. A confirmation text is sent right away."
- **Opt-in keywords and confirmation message:** the confirmation text above (once approved) is the "opt-in message"
  sample.
- **Flag:** carriers expect the spoken opt-in to state the program name, the message frequency, "message and data
  rates may apply" and how to opt out (STOP). Line 8 as approved says the program and "up to 5 messages a year" but
  not "message and data rates may apply" or STOP. The confirmation text covers STOP and rates, but adding them to the
  spoken line is safer for the review. **Abraham's decision.**
- Updating the campaign may pause promotional sending during the review; transactional texts are a separate use case
  and keep working.

## 4. Other places that still describe YES-only sign-up (no change until approved)

- Staff disclosure (STAFF_DISCLOSURE_MARKETING_V2): staff sign-ups still use the YES flow; unchanged unless Abraham
  wants staff to sign people up directly too.
- Website promotional box: still sends the confirmation text and needs YES; unchanged.

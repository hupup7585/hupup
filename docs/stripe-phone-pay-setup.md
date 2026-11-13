# Phone payments by keypad (Stripe): setup steps for Hark

Hup Up Attractions, Nov 12, 2026. Everything stays on **Owner test** (only calls from (845) 777-7585 pay by keypad)
until Abraham approves a real test. Never paste keys or passwords in chat; enter them only in Twilio, Stripe and Vercel.

## 1. Twilio payment subaccount (PCI mode here only)
1. Twilio Console > Account > Subaccounts > **Create subaccount**. Name: `Hup Up Payments`.
2. Switch into the subaccount. Voice > Settings > General > **PCI Mode: On** (in this subaccount only; it can't be
   turned off again; never turn it on in the main account).
3. Note the subaccount's **Account SID** and **Auth Token** (Account > API keys & tokens) for step 4.

## 2. Stripe Pay Connector (in the subaccount)
1. In the subaccount: Voice > Pay Connectors > **Stripe** > Install.
2. Unique name: `Stripe_Connector` (if you choose another name, put it in `TWILIO_PAY_CONNECTOR`).
3. Connect Abraham's Stripe account "Hup Up Attractions". Turn on **test mode** for the first test; switch to live
   only after Stripe approves the account and Abraham says yes.

## 3. SIP domain (how the hotline hands the call to the payment subaccount; no extra phone number)
1. In the subaccount: Voice > SIP Domains (Manage > Domains) > **Create**.
2. Friendly name `Hup Up Payments`, SIP URI `hupup-pay` (full domain `hupup-pay.sip.twilio.com`; if that name is taken,
   use another and put the full domain in `TWILIO_PAY_SIP_DOMAIN`).
3. Voice authentication > Credential lists > **Create** list `Hotline to payments` with one credential:
   username `hotline`, and a long random password.
4. Call control configuration: **A call comes in** > Webhook > `https://hupupattractions.com/api/pay-voice/incoming`,
   HTTP POST.
5. Save.

## 4. Vercel (Production and Preview)
| Variable | Value |
|---|---|
| `TWILIO_PAY_ACCOUNT_SID` | the subaccount's Account SID |
| `TWILIO_PAY_AUTH_TOKEN` | the subaccount's Auth Token |
| `TWILIO_PAY_SIP_DOMAIN` | `hupup-pay.sip.twilio.com` (or the name you chose) |
| `TWILIO_PAY_SIP_USERNAME` | `hotline` |
| `TWILIO_PAY_SIP_PASSWORD` | the credential's password |
| `TWILIO_PAY_CONNECTOR` | only if the connector isn't named `Stripe_Connector` |

## 5. Stripe (for refunds, fees and disputes)
1. Stripe Dashboard > Developers > API keys > **Create restricted key** `Hup Up website read`:
   READ only for Balance, Balance transactions, Payouts, Charges, Disputes. Save it in Vercel as `STRIPE_READ_KEY`.
2. Create restricted key `Hup Up website refunds`: Refunds WRITE, Charges READ, PaymentIntents READ.
   Save it in Vercel as `STRIPE_REFUNDS_KEY` (Sandbox key first).
3. Create restricted key `Hup Up website disputes`: Disputes WRITE, Files WRITE, Charges READ.
   Save it in Vercel as `STRIPE_DISPUTES_KEY`.
4. Developers > Webhooks > **Add endpoint** `https://hupupattractions.com/api/stripe/webhook`, events:
   `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.refunded`.
   Save its signing secret in Vercel as `STRIPE_WEBHOOK_SECRET`.
5. Settings > Business > Customer emails: turn **off** "Successful payments" (our own receipt from info@ replaces it)
   and "Refunds" if Abraham prefers our wording there too.
6. Settings > Public details: statement descriptor `HUP UP ATTRACTIONS`.
Use test-mode keys (`rk_test_...`) while the account is in the sandbox; live keys only after Abraham's yes.

## 6. Redeploy and test
Redeploy in Vercel. Admin > Phone System > Phone settings shows **Phone payments: Owner test, Stripe test mode,
Payment subaccount: Set up**. Then Abraham calls the hotline from (845) 777-7585, books, and pays with a Stripe test
card (4242 4242 4242 4242, any future date, any security code, ZIP 10950). The order shows Paid with the Stripe
payment ID and last 4 (4242).

## 7. Sola refunds (website payments)
Sola refunds use the Sola "Website" API key: `SOLA_API_KEY` in Vercel. While testing with a Sola sandbox key, also
add `SOLA_REFUND_MODE` = `sandbox`. Live refunds (Stripe or Sola) stay off until Abraham approves them in the code.

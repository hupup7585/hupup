# Hup Up Attractions

Booking, inventory and phone hotline system for **Hup Up Attractions**, which rents bounce houses, laser tag with inflatable mazes, and paddle boats in Kiryas Joel and the surrounding area.

| Where | What |
|---|---|
| `hupupattractions.com` | Public landing page: logo, rentals, service area, hotline number. Customers book by phone only. |
| `/admin` | Owner area, signed in with a one-time code sent by **text or email**: dashboard and leaderboard, availability calendar, orders, new booking (POS), catalog, call log, settings. |
| Phone hotline | Twilio IVR with a male neural voice. Callers browse by keypad, hear item descriptions, add to cart (stock is held while they're on the call), give their name, address and email by voice, and get a Sola Payments link by text. |

## How inventory works

- A rented unit is **out on its event (delivery) day and the next day (pickup day)**. A booking for day D needs a free unit on both D and D+1.
- Units are counted as taken by orders that are **Confirmed** or **Delivered**, and by **On hold** or **Awaiting payment** orders whose time hasn't run out.
- **Phone cart = temporary hold.** If the caller hangs up before checkout, Twilio's call-status webhook releases the hold right away. After checkout, the order is held **30 minutes** for payment (2 hours for links texted from the POS) and then released if unpaid.
- Bookings lock the product row in Postgres, so two callers can never both get the last unit (see `tests/reserve.int.test.ts`).
- A cron job (`/api/cron/release-holds`) also cancels expired holds as a safety net. Availability ignores expired holds anyway, so stock is correct even between cron runs.

## Tech

Next.js 15 (App Router) · Postgres (Neon) with Drizzle ORM · Tailwind 4 · Twilio Voice and SMS · Sola Payments (Cardknox) PaymentSITE and webhook · Resend for email · Vercel hosting.

Main code:
- `src/lib/availability.ts`: the availability rule (one place, used everywhere)
- `src/lib/orders.ts`: reservations, holds, payments
- `src/lib/ivr/flow.ts`: the whole phone menu; `src/lib/ivr/parse.ts`: spoken date, name and email parsing
- `src/lib/auth.ts`: owner sign-in codes and sessions
- `src/lib/sola.ts`, `src/app/api/sola/webhook`: payment links and confirmation
- `src/app/admin/(app)/*`: admin screens

## Going live: setup checklist

1. **Logo**: replace `public/logo.svg` with the real logo (keep the file name).
2. **Database**: create a Neon Postgres database (Vercel → Storage → Neon) and copy the pooled connection string into `DATABASE_URL`.
3. **Vercel project**: import this repo and add the environment variables from `.env.example`.
4. **Tables and starter catalog are automatic.** Every Vercel build runs `vercel-build`, which applies database migrations and loads the starter catalog the first time (it never overwrites existing data). The seed adds sample items and prices. Edit them in `/admin/catalog`.
5. **Domain**: in Vercel → Domains, add `hupupattractions.com` and set the DNS records Vercel shows.
6. **Twilio**: buy a local 845 number. In its Voice settings:
   - *A call comes in* → Webhook `https://hupupattractions.com/api/voice/incoming` (HTTP POST)
   - *Call status changes* → `https://hupupattractions.com/api/voice/status`

   Then set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and the `NEXT_PUBLIC_HOTLINE_*` values. For texting US customers, register the number for A2P 10DLC in the Twilio console.
7. **Sola Payments**: in the Sola portal, create a **PaymentSITE** and add the Amount, Invoice, Name, Email and Phone fields so the link can pre-fill them. Set `SOLA_PAYMENTSITE_NAME`. Under webhooks, point transaction notifications to `https://hupupattractions.com/api/sola/webhook`, set a webhook PIN (15+ letters and numbers), and put the same PIN in `SOLA_WEBHOOK_PIN`. **Run one sandbox payment** to confirm the order flips to *Confirmed*: the field names follow Sola's published docs, which I couldn't reach while building this.
8. **Email codes**: create a Resend account, verify `hupupattractions.com`, and set `RESEND_API_KEY` and `EMAIL_FROM`.
9. **Admin sign-in**: set `ADMIN_EMAIL`, `ADMIN_PHONE` and a long random `AUTH_SECRET`.
10. **Cron**: `vercel.json` runs the hold sweep once a day (the most the Vercel Hobby plan allows). Holds are still released the moment a call ends and are ignored once expired, so stock stays correct. On Vercel Pro you can change the schedule to `*/5 * * * *`.

Then open **/admin/settings**, which shows a green check for each service that's configured.

## Local development

```bash
cp .env.example .env
```

Point `DATABASE_URL` at a local Postgres, then:

```bash
npm run db:migrate && npm run db:seed
```

```bash
npm run dev
```

Without Twilio or Resend keys, texts and emails are printed to the console, and the sign-in screen shows the code ("Dev mode code"). In production these fallbacks are off.

Simulate a full phone call against the running dev server:

```bash
npm run simulate-call
```

```bash
npx tsx scripts/simulate-call.ts --hangup-after-cart
```

Tests (the reservation tests use `DATABASE_URL`):

```bash
npm test
```

## Changing things later

- **New category or product**: `/admin/catalog`. Give a category a *phone key* (1–8) and the hotline menu says it automatically. Up to 9 items per category on the phone.
- **Voice**: `IVR_VOICE` (default `Polly.Matthew-Neural`; alternatives: `Polly.Stephen-Neural`, `Polly.Gregory-Neural`, or the newer `Polly.Matthew-Generative`).
- **Press 0** forwards to `FORWARD_PHONE` (defaults to `ADMIN_PHONE`).
- **Speech hints** for local street names live in `src/lib/ivr/flow.ts` (`FIELDS.address.hints`).

-- Abraham (Nov 12, 2026): Sola's webhook marks each order Paid or Declined, with the date and time and the card's
-- last 4 digits only (the card is typed only on Sola's own page; nothing else about the card is ever stored).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_result" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_result_at" timestamptz;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "card_last4" text;

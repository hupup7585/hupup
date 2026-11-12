-- Abraham (Nov 12, 2026): phone payments by keypad through Stripe (Twilio Pay in a separate PCI subaccount).
-- The Stripe payment ID is saved on the order; the card itself never reaches our server (last 4 only, as with Sola).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stripe_payment_id" text;

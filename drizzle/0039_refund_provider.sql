-- Abraham (Nov 13, 2026): refunds from Admin for Stripe phone payments and Sola website payments. Each refund is its
-- own dated entry; the original payment is never edited or deleted.
ALTER TABLE "order_refunds" ADD COLUMN IF NOT EXISTS "provider" text NOT NULL DEFAULT 'stripe';

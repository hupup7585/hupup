-- The number this order's texts go to (Abraham, Nov 25, 2026): set when the caller sends the confirmation to a
-- different number (box 148, key 1), or by staff on the order page; empty = the customer's phone
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "text_phone" text;

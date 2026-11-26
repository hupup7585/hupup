-- Which hold a payment link has (Abraham, Nov 26, 2026, 14:04): "phone" or "admin". Additive; null = by channel.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "link_hold_kind" text;

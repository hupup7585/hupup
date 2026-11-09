-- Abraham (Nov 9, 2026): each item's size within its category (1 = smallest). Used by the phone line to offer the
-- next size up or down when an item is booked. Empty = not offered as a size alternative. Nothing dropped or deleted.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "size_order" integer;

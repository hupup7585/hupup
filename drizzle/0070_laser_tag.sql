-- Laser tag (Abraham, Nov 17, 2026)
-- 1) One maze: items that share a unit carry the same stock group, and the group is booked at most its units a day.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_group" text;
--> statement-breakpoint
UPDATE "products" SET "stock_group" = 'maze' WHERE "name" ILIKE 'Inflatable Maze%' AND "stock_group" IS NULL;
--> statement-breakpoint
-- 2) "Laser Tag Arena + Maze $300" to Garbage (kept for old orders)
UPDATE "products" SET "trashed_at" = now(), "active" = false WHERE "name" = 'Laser Tag Arena + Maze' AND "trashed_at" IS NULL;
--> statement-breakpoint
-- 3) The additional packs come off the item list: a hidden group, offered after a maze or guns (like ocean balls)
INSERT INTO "categories" ("name", "description", "spoken_name", "ivr_digit", "sort_order", "active")
  SELECT 'Laser tag add-ons', 'Additional laser gun packs, offered after a maze or guns', 'additional laser guns', NULL, 98, false
  WHERE NOT EXISTS (SELECT 1 FROM "categories" WHERE "name" = 'Laser tag add-ons');
--> statement-breakpoint
UPDATE "products" SET "category_id" = (SELECT "id" FROM "categories" WHERE "name" = 'Laser tag add-ons'),
  "size_order" = CASE WHEN "name" ILIKE '%6-Pack%' THEN 1 ELSE 2 END
  WHERE "name" IN ('Additional 6-Pack Laser Guns', 'Additional 4-Pack Laser Guns');
--> statement-breakpoint
-- 4) Offers on an order (third pack 50% off, Thursday to Sunday, 4th Sunday free): the discount and why
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offer_discount_cents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offer_note" text;

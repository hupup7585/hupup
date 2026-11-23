-- Abraham, Nov 22, 2026: remove the old $300 laser tag item (to Garbage, kept for old orders)
UPDATE "products" SET "trashed_at" = now(), "active" = false
  WHERE "trashed_at" IS NULL
    AND ("name" ILIKE 'Laser Tag Arena%' OR ("price_cents" = 30000 AND "category_id" IN (SELECT "id" FROM "categories" WHERE "name" ILIKE '%laser%')));

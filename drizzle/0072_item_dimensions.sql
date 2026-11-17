-- Abraham, Nov 17, 2026: dimensions for each catalog item
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "dimensions" text NOT NULL DEFAULT '';

-- Garbage for catalog items (Abraham, Nov 17, 2026): an item in Garbage is off the catalog list, the website and the
-- phone menu; the Owner can restore it. Orders that already have it are untouched.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trashed_at" timestamp with time zone;

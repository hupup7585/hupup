-- Unit not verified (Abraham, Nov 25, 2026): the caller said the address has no unit, and the directory has no household there
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "unit_not_verified" boolean NOT NULL DEFAULT false;

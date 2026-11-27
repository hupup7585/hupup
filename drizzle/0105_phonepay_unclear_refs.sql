-- Deep check M59 (Nov 27, 2026): 0075 was edited 6 minutes after its first commit (7290dc9 -> 6418e76) to add
-- "unclear_refs". A database that ran the first version recorded 0075 as done and never got the column, and every
-- read of phonepay_attempts (the phone card payment tries) would then fail. Adding it again here is safe either way:
-- IF NOT EXISTS changes nothing where the column is already there. Additive only, no data touched.
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "unclear_refs" text;

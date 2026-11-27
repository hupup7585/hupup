-- Deep check 06:00 M59 (Nov 27, 2026; numbered 0105 after the 0104 paid-notice claim): 0075 was edited after its first commit to add this column. If the first version
-- ran on the live database, 0075 is recorded as done and the column was never added (the migrator never runs a
-- recorded migration again). Additive and safe to run twice: it adds the column only when it is missing.
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "unclear_refs" text;

-- Abraham, Nov 20, 2026: a closed day booked from the day before to the day after, charged as this many days
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "span_days" real;

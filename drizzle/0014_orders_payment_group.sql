-- Abraham (Nov 8, 2026): one phone call can reserve several days (one order per day) and pay for all of them with one
-- charge. Orders paid together share payment_group_id = the id of the first order in the group. Additive only.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_group_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_payment_group_idx" ON "orders" ("payment_group_id");

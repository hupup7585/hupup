ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_driver_id" integer REFERENCES "admin_users"("id");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pickup_driver_id" integer REFERENCES "admin_users"("id");

CREATE TABLE IF NOT EXISTS "equipment_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL REFERENCES "products"("id"),
	"code" text NOT NULL,
	"serial" text,
	"model" text,
	"purchase_date" date,
	"purchase_price_cents" integer,
	"replacement_value_cents" integer,
	"condition" text DEFAULT 'good' NOT NULL,
	"location" text,
	"status" text DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_units_code_idx" ON "equipment_units" ("code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL REFERENCES "equipment_units"("id"),
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"user_id" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL REFERENCES "equipment_units"("id"),
	"day" date NOT NULL,
	"order_id" integer NOT NULL REFERENCES "orders"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unit_bookings_unit_day_idx" ON "unit_bookings" ("unit_id", "day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_bookings_order_idx" ON "unit_bookings" ("order_id");

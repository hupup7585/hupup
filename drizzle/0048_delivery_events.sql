CREATE TABLE IF NOT EXISTS "delivery_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"stop" text NOT NULL,
	"stage" text NOT NULL,
	"note" text,
	"user_id" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_events_order_idx" ON "delivery_events" ("order_id", "at");

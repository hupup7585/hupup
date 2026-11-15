CREATE TABLE IF NOT EXISTS "phonepay_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL REFERENCES "orders"("id"),
	"call_sid" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"matched" boolean,
	"sola_ref" text,
	"last4" text,
	"card_type" text,
	"note" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phonepay_attempts_started_idx" ON "phonepay_attempts" ("started_at");

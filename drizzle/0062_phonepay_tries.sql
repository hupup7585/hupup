ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "pay_leg_sid" text;
--> statement-breakpoint
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "result" text;
--> statement-breakpoint
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "try_number" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES ('phoneCardProvider', '"sola"'::jsonb) ON CONFLICT ("key") DO NOTHING;

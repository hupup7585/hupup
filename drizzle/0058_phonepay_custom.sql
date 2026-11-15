ALTER TABLE "phonepay_attempts" ALTER COLUMN "order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'order' NOT NULL;

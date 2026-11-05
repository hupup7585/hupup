ALTER TABLE "customers" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "time_zone_source" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "time_zone_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "disclosure_read" boolean;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "corrects_consent_id" integer;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "correction_reason" text;--> statement-breakpoint
-- A correction points at the original consent row; the original stays unchanged (append-only trigger from 0004).
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_corrects_fk" FOREIGN KEY ("corrects_consent_id") REFERENCES "sms_consents"("id");--> statement-breakpoint
-- Every correction must say why and who made it.
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_correction_needs_reason" CHECK ("corrects_consent_id" IS NULL OR ("correction_reason" IS NOT NULL AND length(trim("correction_reason")) > 0 AND "user_id" IS NOT NULL));--> statement-breakpoint
-- Staff-recorded consent must confirm the full disclosure was read; anything else is not a staff opt-in.
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_staff_optin_disclosure" CHECK (NOT ("source" IN ('staff', 'pos') AND "action" = 'opt_in' AND "corrects_consent_id" IS NULL) OR "disclosure_read" IS TRUE) NOT VALID;--> statement-breakpoint
CREATE INDEX "sms_consents_corrects_idx" ON "sms_consents" USING btree ("corrects_consent_id");

ALTER TABLE "sms_consents" ADD COLUMN "reenrolls_after_id" integer;--> statement-breakpoint
-- A re-enrollment is a new row that points at the withdrawal (opt-out) it follows; the earlier history is untouched.
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_reenrolls_fk" FOREIGN KEY ("reenrolls_after_id") REFERENCES "sms_consents"("id");--> statement-breakpoint
-- Only an opt-in can be a re-enrollment.
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_reenroll_is_optin" CHECK ("reenrolls_after_id" IS NULL OR "action" = 'opt_in');

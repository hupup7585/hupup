CREATE TABLE "sms_reenroll_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"customer_id" integer,
	"scope" text DEFAULT 'transactional' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"prompt_text" text NOT NULL,
	"start_message" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"confirm_consent_id" integer
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "send_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_reenroll_requests" ADD CONSTRAINT "sms_reenroll_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_reenroll_phone_idx" ON "sms_reenroll_requests" USING btree ("phone","status");--> statement-breakpoint
CREATE INDEX "messages_held_idx" ON "messages" USING btree ("status","send_after");--> statement-breakpoint
-- At most one pending START confirmation per phone number (repeated STARTs can't create duplicates).
CREATE UNIQUE INDEX "sms_reenroll_one_pending" ON "sms_reenroll_requests" ("phone") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "sms_reenroll_requests" ADD CONSTRAINT "sms_reenroll_scope_transactional" CHECK ("scope" = 'transactional');--> statement-breakpoint
ALTER TABLE "sms_reenroll_requests" ADD CONSTRAINT "sms_reenroll_status_valid" CHECK ("status" IN ('pending', 'confirmed', 'expired', 'canceled'));--> statement-breakpoint
ALTER TABLE "sms_reenroll_requests" ADD CONSTRAINT "sms_reenroll_confirm_fk" FOREIGN KEY ("confirm_consent_id") REFERENCES "sms_consents"("id");--> statement-breakpoint
-- History is kept: a request can never be deleted, and once resolved (confirmed/expired/canceled) it can't change.
CREATE OR REPLACE FUNCTION sms_reenroll_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sms_reenroll_requests history cannot be deleted';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'resolved re-enrollment request % cannot be changed', OLD.id;
  END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone OR NEW.prompt_text IS DISTINCT FROM OLD.prompt_text OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION 're-enrollment request % details cannot be changed', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sms_reenroll_requests_guard BEFORE UPDATE OR DELETE ON "sms_reenroll_requests" FOR EACH ROW EXECUTE FUNCTION sms_reenroll_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION sms_reenroll_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sms_reenroll_requests history cannot be truncated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sms_reenroll_requests_no_truncate BEFORE TRUNCATE ON "sms_reenroll_requests" FOR EACH STATEMENT EXECUTE FUNCTION sms_reenroll_no_truncate();--> statement-breakpoint
-- Separate consent categories and valid values on the consent history (existing rows are not re-checked).
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_scope_valid" CHECK ("scope" IN ('transactional', 'marketing')) NOT VALID;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_action_valid" CHECK ("action" IN ('opt_in', 'opt_out', 'declined')) NOT VALID;

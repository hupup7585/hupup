ALTER TABLE "sms_consents" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "wording_version" text;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "response" text;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "speech_confidence" real;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "caller_phone" text;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "order_id" integer;--> statement-breakpoint
CREATE INDEX "sms_consents_phone_scope_idx" ON "sms_consents" USING btree ("phone","scope","created_at");--> statement-breakpoint
-- Permanent consent record: rows can be added, never changed or deleted.
CREATE OR REPLACE FUNCTION sms_consents_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sms_consents is a permanent compliance record: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sms_consents_no_update_delete BEFORE UPDATE OR DELETE ON "sms_consents" FOR EACH ROW EXECUTE FUNCTION sms_consents_append_only();--> statement-breakpoint
CREATE TRIGGER sms_consents_no_truncate BEFORE TRUNCATE ON "sms_consents" FOR EACH STATEMENT EXECUTE FUNCTION sms_consents_append_only();

ALTER TABLE "sms_consents" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "sms_consents" ADD COLUMN "page_url" text;--> statement-breakpoint
-- Message history (including promotional texts and STOP/opt-out messages) is kept at least 24 months:
-- a row can't be deleted until it is older than that. Status updates from Twilio still work.
CREATE OR REPLACE FUNCTION messages_keep_24_months() RETURNS trigger AS $$
BEGIN
  IF OLD.created_at > now() - interval '24 months' THEN
    RAISE EXCEPTION 'messages must be kept for at least 24 months (message % from %)', OLD.id, OLD.created_at;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER messages_no_early_delete BEFORE DELETE ON "messages" FOR EACH ROW EXECUTE FUNCTION messages_keep_24_months();--> statement-breakpoint
CREATE OR REPLACE FUNCTION messages_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'messages is a compliance record: TRUNCATE is not allowed';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER messages_no_truncate BEFORE TRUNCATE ON "messages" FOR EACH STATEMENT EXECUTE FUNCTION messages_no_truncate();--> statement-breakpoint
-- The message body and recipient of a sent text can't be rewritten (status fields stay updatable).
CREATE OR REPLACE FUNCTION messages_content_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.to_number IS DISTINCT FROM OLD.to_number OR NEW.from_number IS DISTINCT FROM OLD.from_number
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'message content is a compliance record and cannot be changed (message %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER messages_content_locked BEFORE UPDATE ON "messages" FOR EACH ROW EXECUTE FUNCTION messages_content_immutable();

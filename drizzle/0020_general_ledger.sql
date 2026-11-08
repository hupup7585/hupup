CREATE TABLE "gl_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"prepared_by" integer,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"reverses_id" integer,
	"file_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_source_ref_unique" UNIQUE("source_ref")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"memo" text,
	"project_id" integer
);
--> statement-breakpoint
ALTER TABLE "book_locks" ADD COLUMN "status" text DEFAULT 'locked' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_locks" ADD COLUMN "reopened_by" integer;--> statement-breakpoint
ALTER TABLE "book_locks" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book_locks" ADD COLUMN "reopen_reason" text;--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
-- Journal entries and lines are never deleted; posted lines are never edited (reversals are new entries).
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER gl_accounts_no_delete BEFORE DELETE ON gl_accounts FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_lines_frozen() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entries WHERE id = OLD.entry_id AND status IN ('posted', 'reversed')) THEN
    RAISE EXCEPTION 'Posted journal lines are never edited; post a reversal instead';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_lines_frozen BEFORE UPDATE ON journal_lines FOR EACH ROW EXECUTE FUNCTION journal_lines_frozen();--> statement-breakpoint
-- A month that was reopened (with a reason) takes entries again until it's locked again.
CREATE OR REPLACE FUNCTION book_entry_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM book_locks WHERE month = to_char(NEW.entry_date, 'YYYY-MM') AND status = 'locked') THEN
    RAISE EXCEPTION 'The month % is locked', to_char(NEW.entry_date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION book_mileage_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM book_locks WHERE month = to_char(NEW.trip_date, 'YYYY-MM') AND status = 'locked') THEN
    RAISE EXCEPTION 'The month % is locked', to_char(NEW.trip_date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_entry_lock() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'posted' AND EXISTS (SELECT 1 FROM book_locks WHERE month = to_char(NEW.entry_date, 'YYYY-MM') AND status = 'locked') THEN
    RAISE EXCEPTION 'The month % is locked', to_char(NEW.entry_date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_entries_lock BEFORE INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_entry_lock();

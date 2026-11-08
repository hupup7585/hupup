CREATE TABLE "book_bank_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"account" text DEFAULT 'bank' NOT NULL,
	"import_name" text,
	"line_date" date NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"matched_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"category" text,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"notes" text,
	"file_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"recurring_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "book_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "book_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_date" date NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"amount_cents" integer NOT NULL,
	"rental_cents" integer DEFAULT 0 NOT NULL,
	"delivery_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"method" text,
	"check_no" text,
	"party" text,
	"order_id" integer,
	"invoice_id" integer,
	"bill_id" integer,
	"product_id" integer,
	"person_name" text,
	"county" text,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"ref" text,
	"notes" text,
	"file_id" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"corrects_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"purchase_date" date NOT NULL,
	"cost_cents" integer NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"life_years" integer DEFAULT 5 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"customer_id" integer,
	"order_id" integer,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"exempt_cert_no" text,
	"exempt_file_id" integer,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_locks" (
	"month" text PRIMARY KEY NOT NULL,
	"locked_by" integer,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_mileage" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_date" date NOT NULL,
	"vehicle" text,
	"driver" text,
	"miles_tenths" integer NOT NULL,
	"purpose" text,
	"order_id" integer,
	"notes" text,
	"corrects_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_recurring" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"category" text,
	"amount_cents" integer NOT NULL,
	"method" text,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"next_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "book_bank_date_idx" ON "book_bank_lines" USING btree ("line_date");--> statement-breakpoint
CREATE INDEX "book_entries_date_idx" ON "book_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "book_entries_order_idx" ON "book_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "book_entries_kind_idx" ON "book_entries" USING btree ("kind","entry_date");--> statement-breakpoint
-- Abraham T, safety: nothing in the books is ever deleted, ledger rows are never edited (corrections are new rows),
-- and nothing can be added with a date in a locked month.
CREATE OR REPLACE FUNCTION book_no_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Bookkeeping records are never deleted; add a correction instead'; END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION book_no_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Ledger entries are never edited; add a correction instead'; END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION book_entry_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM book_locks WHERE month = to_char(NEW.entry_date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'The month % is locked', to_char(NEW.entry_date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION book_mileage_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM book_locks WHERE month = to_char(NEW.trip_date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'The month % is locked', to_char(NEW.trip_date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER book_entries_no_delete BEFORE DELETE ON book_entries FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER book_entries_no_update BEFORE UPDATE ON book_entries FOR EACH ROW EXECUTE FUNCTION book_no_update();--> statement-breakpoint
CREATE TRIGGER book_entries_lock BEFORE INSERT ON book_entries FOR EACH ROW EXECUTE FUNCTION book_entry_lock();--> statement-breakpoint
CREATE TRIGGER book_mileage_no_delete BEFORE DELETE ON book_mileage FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER book_mileage_no_update BEFORE UPDATE ON book_mileage FOR EACH ROW EXECUTE FUNCTION book_no_update();--> statement-breakpoint
CREATE TRIGGER book_mileage_lock BEFORE INSERT ON book_mileage FOR EACH ROW EXECUTE FUNCTION book_mileage_lock();--> statement-breakpoint
CREATE TRIGGER book_invoices_no_delete BEFORE DELETE ON book_invoices FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER book_bills_no_delete BEFORE DELETE ON book_bills FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER book_files_no_delete BEFORE DELETE ON book_files FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER book_equipment_no_delete BEFORE DELETE ON book_equipment FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER book_bank_lines_no_delete BEFORE DELETE ON book_bank_lines FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
CREATE TRIGGER book_locks_no_delete BEFORE DELETE ON book_locks FOR EACH ROW EXECUTE FUNCTION book_no_delete();--> statement-breakpoint
INSERT INTO book_categories (kind, name, sort_order) VALUES
  ('expense', 'Equipment purchases', 1), ('expense', 'Repairs', 2), ('expense', 'Fuel and vehicle', 3), ('expense', 'Insurance', 4),
  ('expense', 'Advertising', 5), ('expense', 'Phone and software', 6), ('expense', 'Supplies', 7), ('expense', 'Storage', 8),
  ('expense', 'Wages', 9), ('expense', 'Fees', 10)
ON CONFLICT (name) DO NOTHING;--> statement-breakpoint
-- Income from bookings already paid before the books existed (new payments are recorded as they arrive).
INSERT INTO book_entries (entry_date, kind, category, amount_cents, rental_cents, delivery_cents, tax_cents, tip_cents, method, order_id, ref, source, notes)
SELECT (o.updated_at AT TIME ZONE 'America/New_York')::date, 'income', 'Bookings', o.paid_cents,
  CASE WHEN o.paid_cents >= coalesce(o.total_cents, o.subtotal_cents) THEN o.subtotal_cents
       ELSE o.paid_cents - round(o.delivery_fee_cents::numeric * o.paid_cents / greatest(coalesce(o.total_cents, o.subtotal_cents), 1))::int - round(o.tax_cents::numeric * o.paid_cents / greatest(coalesce(o.total_cents, o.subtotal_cents), 1))::int END,
  CASE WHEN o.paid_cents >= coalesce(o.total_cents, o.subtotal_cents) THEN o.delivery_fee_cents ELSE round(o.delivery_fee_cents::numeric * o.paid_cents / greatest(coalesce(o.total_cents, o.subtotal_cents), 1))::int END,
  CASE WHEN o.paid_cents >= coalesce(o.total_cents, o.subtotal_cents) THEN o.tax_cents ELSE round(o.tax_cents::numeric * o.paid_cents / greatest(coalesce(o.total_cents, o.subtotal_cents), 1))::int END,
  CASE WHEN o.paid_cents > coalesce(o.total_cents, o.subtotal_cents) THEN o.paid_cents - coalesce(o.total_cents, o.subtotal_cents) ELSE 0 END,
  coalesce(o.payment_method, 'other'), o.id, o.sola_ref_num, 'auto', 'Recorded from the booking when the books were set up'
FROM orders o
WHERE o.paid_cents > 0 AND NOT EXISTS (SELECT 1 FROM book_entries e WHERE e.order_id = o.id AND e.source = 'auto');

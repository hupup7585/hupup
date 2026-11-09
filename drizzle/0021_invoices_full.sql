CREATE TABLE "book_invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"description" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_cents" integer NOT NULL,
	"line_cents" integer NOT NULL,
	"product_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "kind" text DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "customer_phone" text;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "subtotal_cents" integer;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "deposit_required_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "terms_days" integer;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "manual_status" text;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "related_invoice_id" integer;--> statement-breakpoint
ALTER TABLE "book_invoices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "book_invoice_lines_inv_idx" ON "book_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "book_invoices" ADD CONSTRAINT "book_invoices_number_unique" UNIQUE("number");--> statement-breakpoint
CREATE TRIGGER book_invoice_lines_no_delete BEFORE DELETE ON book_invoice_lines FOR EACH ROW EXECUTE FUNCTION book_no_delete();

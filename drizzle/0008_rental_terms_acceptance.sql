CREATE TABLE "terms_acceptances" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"customer_id" integer,
	"phone" text,
	"terms_version" text NOT NULL,
	"terms_hash" text NOT NULL,
	"terms_text" text NOT NULL,
	"method" text NOT NULL,
	"acceptance_statement" text NOT NULL,
	"amount_cents" integer,
	"ip" text,
	"user_agent" text,
	"page_url" text,
	"user_id" integer,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terms_acceptances_order_idx" ON "terms_acceptances" USING btree ("order_id","accepted_at");--> statement-breakpoint
-- Acceptance records are permanent evidence: rows can be added, never changed or deleted.
CREATE OR REPLACE FUNCTION terms_acceptances_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'terms_acceptances is a permanent record: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER terms_acceptances_no_update_delete BEFORE UPDATE OR DELETE ON "terms_acceptances" FOR EACH ROW EXECUTE FUNCTION terms_acceptances_append_only();--> statement-breakpoint
CREATE TRIGGER terms_acceptances_no_truncate BEFORE TRUNCATE ON "terms_acceptances" FOR EACH STATEMENT EXECUTE FUNCTION terms_acceptances_append_only();

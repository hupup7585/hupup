CREATE TABLE IF NOT EXISTS "order_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
	"from_status" text,
	"to_status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_status_history_order_idx" ON "order_status_history" ("order_id", "at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION order_status_history_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO order_status_history (order_id, from_status, to_status) VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS order_status_history_trg ON "orders";
--> statement-breakpoint
CREATE TRIGGER order_status_history_trg AFTER INSERT OR UPDATE OF status ON "orders" FOR EACH ROW EXECUTE FUNCTION order_status_history_log();
--> statement-breakpoint
INSERT INTO order_status_history (order_id, from_status, to_status, at, reason)
SELECT o.id, NULL, o.status, o.created_at, 'Status when history started'
FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id);

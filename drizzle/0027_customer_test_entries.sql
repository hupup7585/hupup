-- Abraham (Nov 10, 2026): mark customers as test entries instead of deleting them. Nothing is deleted.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_test" boolean NOT NULL DEFAULT false;--> statement-breakpoint
INSERT INTO "audit_log" ("user_id", "action", "entity_type", "entity_id", "before", "after")
SELECT NULL, 'customer.marked_test', 'customer', "id"::text, jsonb_build_object('name', "name", 'isTest', false), jsonb_build_object('isTest', true, 'reason', 'Abraham confirmed these are test entries (Nov 10, 2026)')
FROM "customers"
WHERE "is_test" = false AND ("name" ILIKE 'y%all see gold%' OR "name" ILIKE 'maki. france%');--> statement-breakpoint
UPDATE "customers" SET "is_test" = true WHERE "is_test" = false AND ("name" ILIKE 'y%all see gold%' OR "name" ILIKE 'maki. france%');

-- Abraham, Nov 17, 2026: (845) 213-5239 is a payment test number too (card payment by phone), next to the two others.
-- Added to whatever list is saved in Admin; never removes a number.
UPDATE "app_settings" SET "value" = to_jsonb(("value" #>> '{}') || E'\n+18452135239'), "updated_at" = now()
  WHERE "key" = 'paymentTestNumbers' AND position('2135239' in ("value" #>> '{}')) = 0;
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES ('paymentTestNumbers', '"+18457777585\n+18457990925\n+18452135239"'::jsonb)
  ON CONFLICT ("key") DO NOTHING;

-- Abraham, Nov 18, 2026: Sola PhonePay passed the test; card payment by phone for every caller (not only test numbers)
INSERT INTO "app_settings" ("key", "value") VALUES ('solaPhonePayOwnerOnly', 'false'::jsonb)
ON CONFLICT ("key") DO UPDATE SET "value" = 'false'::jsonb, "updated_at" = now();
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES ('solaPhonePayOn', 'true'::jsonb)
ON CONFLICT ("key") DO UPDATE SET "value" = 'true'::jsonb, "updated_at" = now();

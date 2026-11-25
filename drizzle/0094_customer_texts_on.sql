-- Customer texts on for everyone (Abraham, Nov 25, 2026, 00:34: "You can turn on the text messages."): the texting
-- test window is closed; consent, STOP, quiet hours and card-number rules stay. The Owner can switch it in Admin.
INSERT INTO "app_settings" ("key", "value") VALUES ('smsTestOnly', 'false'::jsonb)
ON CONFLICT ("key") DO UPDATE SET "value" = 'false'::jsonb, "updated_at" = now();

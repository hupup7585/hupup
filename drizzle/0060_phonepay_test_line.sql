-- Abraham, Nov 15, 2026: pay by card on the hotline through Sola PhonePay, for the payment test numbers only
-- ((845) 777-7585 and (845) 799-0925). Digits match his test call: PIN and pound, amount in cents and pound, 1.
INSERT INTO "app_settings" ("key", "value") VALUES ('solaPhonePayOn', 'true'::jsonb)
  ON CONFLICT ("key") DO UPDATE SET "value" = 'true'::jsonb, "updated_at" = now();
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES ('solaPhonePayOwnerOnly', 'true'::jsonb)
  ON CONFLICT ("key") DO UPDATE SET "value" = 'true'::jsonb, "updated_at" = now();
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES ('solaPhonePayDigits', '"wwwwwwwwww{pin}#wwwwwwwwwwwwwwwwwwwwwwww{amount}#wwwwwwwwww1"'::jsonb)
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now();
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES ('paymentTestNumbers', '"+18457777585\n+18457990925"'::jsonb)
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now();

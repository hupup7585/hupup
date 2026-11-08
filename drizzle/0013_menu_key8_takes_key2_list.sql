-- Abraham's new main menu (Nov 8, 2026): key 8 is now schools, corporate events and organizations, and takes over
-- the staff list key 2 had (same numbers, order and press-1 setting). Key 2 is now equipment instructions and guidance
-- with its own list, starting empty (an empty list rings the operator list). Nothing is deleted: the saved numbers move
-- to key 8, and the move is recorded in the activity log. Safe to run more than once.
INSERT INTO "audit_log" ("user_id", "action", "entity_type", "entity_id", "before", "after")
SELECT NULL, 'settings.menu_key2_list_moved_to_key8', 'settings', 'ring_key_8',
  jsonb_build_object('key2', (SELECT jsonb_object_agg("key", "value") FROM "app_settings" WHERE "key" IN ('ringTargets2', 'ringMode2', 'ringAccept2'))),
  jsonb_build_object('key8', (SELECT jsonb_object_agg(replace("key", '2', '8'), "value") FROM "app_settings" WHERE "key" IN ('ringTargets2', 'ringMode2', 'ringAccept2')))
WHERE EXISTS (SELECT 1 FROM "app_settings" WHERE "key" IN ('ringTargets2', 'ringMode2', 'ringAccept2'))
  AND NOT EXISTS (SELECT 1 FROM "app_settings" WHERE "key" IN ('ringTargets8', 'ringMode8', 'ringAccept8'));
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value", "updated_at", "updated_by")
SELECT replace("key", '2', '8'), "value", now(), "updated_by" FROM "app_settings"
WHERE "key" IN ('ringTargets2', 'ringMode2', 'ringAccept2')
  AND NOT EXISTS (SELECT 1 FROM "app_settings" WHERE "key" IN ('ringTargets8', 'ringMode8', 'ringAccept8'))
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
UPDATE "app_settings" SET "value" = CASE "key" WHEN 'ringTargets2' THEN '""'::jsonb WHEN 'ringMode2' THEN '"sequential"'::jsonb ELSE 'true'::jsonb END, "updated_at" = now()
WHERE "key" IN ('ringTargets2', 'ringMode2', 'ringAccept2')
  AND "value" = (SELECT s8."value" FROM "app_settings" s8 WHERE s8."key" = replace("app_settings"."key", '2', '8'));

-- Abraham (Phone Menu v3, section 2): who rings for each line. Each number rings 25 seconds, 3 times, then that
-- line's voicemail; staff press 1 to accept. Updates only these settings (with an audit row). Nothing deleted.
INSERT INTO app_settings (key, value, updated_at) VALUES ('operatorTargets', '"Operator | +18452135239 | 25"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO app_settings (key, value, updated_at) VALUES ('ringTargets5', '"Rental issues | +18452135239 | 25"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO app_settings (key, value, updated_at) VALUES ('ringTargets6', '"Delivery and pickup | +18452135239 | 25"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO app_settings (key, value, updated_at) VALUES ('ringTargets4', '"Customer service | +18457990925 | 25"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO app_settings (key, value, updated_at) VALUES ('operatorMode', '"sequential"'::jsonb, now()), ('ringMode4', '"sequential"'::jsonb, now()), ('ringMode5', '"sequential"'::jsonb, now()), ('ringMode6', '"sequential"'::jsonb, now()), ('operatorAcceptPrompt', 'true'::jsonb, now()), ('ringAccept4', 'true'::jsonb, now()), ('ringAccept5', 'true'::jsonb, now()), ('ringAccept6', 'true'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO audit_log (action, entity_type, after) VALUES ('settings.ring_lists_phone_menu_v3', 'settings', '{"key0":"(845) 213-5239","key3":"(845) 799-0925","key5":"(845) 213-5239","key6":"(845) 213-5239","ringSeconds":25,"attempts":3,"by":"Abraham, Phone Menu v3 (migration 0032)"}'::jsonb);

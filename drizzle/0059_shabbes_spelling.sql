-- Abraham (Nov 15, 2026): spell it "Shabbes" everywhere. Saved wording, live and draft lines, and saved settings.
-- Old versions in the history are kept as they were.
UPDATE "voice_prompts" SET "text" = replace("text", 'Shabbos', 'Shabbes') WHERE "text" LIKE '%Shabbos%';
--> statement-breakpoint
UPDATE "prompt_versions" SET "text" = replace("text", 'Shabbos', 'Shabbes') WHERE "text" LIKE '%Shabbos%' AND "status" IN ('live', 'draft');
--> statement-breakpoint
UPDATE "app_settings" SET "value" = replace("value"::text, 'Shabbos', 'Shabbes')::jsonb WHERE "value"::text LIKE '%Shabbos%';

-- Hark's Phase 1-2 review (Nov 26, 2026), H2, M13, L8: one draft per setting at most, a known status only, and only
-- the newest live version marked live (older ones become "replaced"; nothing is deleted).
UPDATE "config_versions" v SET "status" = 'discarded' WHERE "status" = 'draft' AND EXISTS (SELECT 1 FROM "config_versions" n WHERE n."key" = v."key" AND n."status" = 'draft' AND n."id" > v."id");
--> statement-breakpoint
UPDATE "config_versions" v SET "status" = 'replaced' WHERE "status" = 'live' AND EXISTS (SELECT 1 FROM "config_versions" n WHERE n."key" = v."key" AND n."status" = 'live' AND n."id" > v."id");
--> statement-breakpoint
ALTER TABLE "config_versions" ADD CONSTRAINT "config_versions_status_check" CHECK ("status" IN ('draft', 'live', 'discarded', 'replaced'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "config_versions_one_draft" ON "config_versions" ("key") WHERE "status" = 'draft';

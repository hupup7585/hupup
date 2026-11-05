CREATE TABLE "terms_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"effective_date" text NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Stored Terms versions are permanent: a version's text can never be changed or deleted.
CREATE OR REPLACE FUNCTION terms_versions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'terms_versions is a permanent record: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER terms_versions_no_update_delete BEFORE UPDATE OR DELETE ON "terms_versions" FOR EACH ROW EXECUTE FUNCTION terms_versions_append_only();--> statement-breakpoint
CREATE TRIGGER terms_versions_no_truncate BEFORE TRUNCATE ON "terms_versions" FOR EACH STATEMENT EXECUTE FUNCTION terms_versions_append_only();

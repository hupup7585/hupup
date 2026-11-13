ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "link_removed" jsonb DEFAULT '[]'::jsonb NOT NULL;

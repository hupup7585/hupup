-- Abraham: the Owner's staff name was saved as "Owner"; show his real name. Update only, nothing deleted.
UPDATE "admin_users" SET "name" = 'Abraham Schwartz' WHERE "role" = 'owner' AND btrim("name") IN ('Owner', '');

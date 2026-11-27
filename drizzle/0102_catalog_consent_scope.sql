-- Website "Text me the catalog" consent box (Abraham, Nov 27, 2026, 1:52 AM): its records are saved in sms_consents
-- with scope 'catalog' (a one-time catalog text; not order texts, not promotions). Only widens the allowed values;
-- no row is changed.
ALTER TABLE "sms_consents" DROP CONSTRAINT IF EXISTS "sms_consents_scope_valid";--> statement-breakpoint
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_scope_valid" CHECK ("scope" IN ('transactional', 'marketing', 'catalog')) NOT VALID;

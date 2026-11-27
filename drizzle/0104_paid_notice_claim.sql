-- Deep check M26 (Nov 27, 2026): the Sola payment reference whose "paid" text and email were sent. Two copies of the
-- same Sola notice at the same moment can claim it only once, so the customer gets one notice. Additive only.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paid_notice_ref" text;

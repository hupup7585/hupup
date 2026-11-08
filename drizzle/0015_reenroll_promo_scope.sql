-- SMS Terms v2 (Abraham Q): the pending-confirmation table also holds promotional confirmation texts (scope
-- 'marketing'), which a YES reply turns into written promotional consent. No rows are changed.
ALTER TABLE "sms_reenroll_requests" DROP CONSTRAINT IF EXISTS "sms_reenroll_scope_transactional";--> statement-breakpoint
ALTER TABLE "sms_reenroll_requests" ADD CONSTRAINT "sms_reenroll_scope_known" CHECK ("scope" IN ('transactional', 'marketing'));

ALTER TABLE "promotionRules" ADD COLUMN IF NOT EXISTS "endsAt" timestamp with time zone;
ALTER TABLE "promotionRules" ADD COLUMN IF NOT EXISTS "applicationMode" text NOT NULL DEFAULT 'new_only';
ALTER TABLE "promotionRules" ADD COLUMN IF NOT EXISTS "archivedAt" timestamp with time zone;
ALTER TABLE "promotionRules" DROP CONSTRAINT IF EXISTS "promotion_rules_dates_check";
ALTER TABLE "promotionRules" ADD CONSTRAINT "promotion_rules_dates_check"
  CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "promotionRules" DROP CONSTRAINT IF EXISTS "promotion_rules_mode_check";
ALTER TABLE "promotionRules" ADD CONSTRAINT "promotion_rules_mode_check"
  CHECK ("applicationMode" IN ('new_only', 'all_matching'));

ALTER TABLE "promotionRuleExecutions" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed';
ALTER TABLE "promotionRuleExecutions" ADD COLUMN IF NOT EXISTS "attemptCount" integer NOT NULL DEFAULT 1;
ALTER TABLE "promotionRuleExecutions" ADD COLUMN IF NOT EXISTS "errorMessage" text;
ALTER TABLE "promotionRuleExecutions" ADD COLUMN IF NOT EXISTS "completedAt" timestamp with time zone;
UPDATE "promotionRuleExecutions" SET "completedAt" = "executedAt" WHERE "completedAt" IS NULL AND "status" = 'completed';
ALTER TABLE "promotionRuleExecutions" DROP CONSTRAINT IF EXISTS "promotion_rule_executions_status_check";
ALTER TABLE "promotionRuleExecutions" ADD CONSTRAINT "promotion_rule_executions_status_check"
  CHECK ("status" IN ('running', 'completed', 'failed'));
ALTER TABLE "promotionRuleExecutions" DROP CONSTRAINT IF EXISTS "promotion_rule_executions_attempts_check";
ALTER TABLE "promotionRuleExecutions" ADD CONSTRAINT "promotion_rule_executions_attempts_check"
  CHECK ("attemptCount" > 0);
CREATE INDEX IF NOT EXISTS "promotion_rule_executions_status_idx"
  ON "promotionRuleExecutions" ("status", "executedAt");

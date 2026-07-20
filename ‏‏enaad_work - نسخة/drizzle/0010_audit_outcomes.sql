ALTER TABLE "auditLogs" ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'success';
ALTER TABLE "auditLogs" ADD COLUMN IF NOT EXISTS "errorCode" text;
ALTER TABLE "auditLogs" DROP CONSTRAINT IF EXISTS "audit_logs_outcome_check";
ALTER TABLE "auditLogs" ADD CONSTRAINT "audit_logs_outcome_check"
  CHECK (outcome IN ('success', 'failure', 'denied'));
CREATE INDEX IF NOT EXISTS "audit_logs_outcome_created_idx" ON "auditLogs" (outcome, "createdAt");

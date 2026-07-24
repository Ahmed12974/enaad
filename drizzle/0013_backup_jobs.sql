CREATE TABLE IF NOT EXISTS "backupJobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requestedBy" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "delivery" text NOT NULL,
  "recipient" text,
  "filename" text,
  "blobPathname" text,
  "recordCount" integer DEFAULT 0 NOT NULL,
  "blobCount" integer DEFAULT 0 NOT NULL,
  "sizeBytes" bigint DEFAULT 0 NOT NULL,
  "manifest" jsonb,
  "errorMessage" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "completedAt" timestamp with time zone,
  CONSTRAINT "backupJobs_requestedBy_user_id_fk" FOREIGN KEY ("requestedBy") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "backup_jobs_status_check" CHECK ("status" in ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT "backup_jobs_delivery_check" CHECK ("delivery" in ('download', 'email-attachment', 'email-link')),
  CONSTRAINT "backup_jobs_counts_size_check" CHECK ("recordCount" >= 0 and "blobCount" >= 0 and "sizeBytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backup_jobs_one_active_per_admin_unique"
  ON "backupJobs" USING btree ("requestedBy")
  WHERE "status" in ('queued', 'running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_jobs_status_created_idx" ON "backupJobs" USING btree ("status", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_jobs_requester_created_idx" ON "backupJobs" USING btree ("requestedBy", "createdAt");

CREATE TABLE "siteContentVersions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "siteContentId" uuid NOT NULL,
  "version" integer NOT NULL,
  "title" text,
  "content" jsonb NOT NULL,
  "status" "publication_status" NOT NULL,
  "isVisible" boolean NOT NULL,
  "startsAt" timestamp with time zone,
  "endsAt" timestamp with time zone,
  "createdBy" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "siteContentVersions_siteContentId_siteContent_id_fk" FOREIGN KEY ("siteContentId") REFERENCES "public"."siteContent"("id") ON DELETE cascade,
  CONSTRAINT "siteContentVersions_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_content_versions_item_version_unique" ON "siteContentVersions" ("siteContentId", "version");
--> statement-breakpoint
CREATE INDEX "site_content_versions_item_created_idx" ON "siteContentVersions" ("siteContentId", "createdAt");
--> statement-breakpoint
CREATE TABLE "platformSettings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updatedBy" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platformSettings_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX "platform_settings_updated_idx" ON "platformSettings" ("updatedAt");

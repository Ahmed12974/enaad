CREATE TYPE "public"."badge_rarity" AS ENUM('common', 'uncommon', 'rare', 'epic', 'legendary');--> statement-breakpoint
CREATE TYPE "public"."challenge_lifecycle" AS ENUM('draft', 'scheduled', 'open', 'active', 'paused', 'ended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('unit', 'level', 'lesson', 'quiz', 'question', 'activity', 'story', 'file', 'image', 'video', 'instruction');--> statement-breakpoint
CREATE TYPE "public"."grant_mode" AS ENUM('automatic', 'manual', 'both');--> statement-breakpoint
CREATE TYPE "public"."managed_account_status" AS ENUM('active', 'disabled', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."progress_status" AS ENUM('not_started', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."promotion_condition" AS ENUM('points', 'section_completion', 'lessons_completed', 'challenge_wins', 'activity_streak', 'achievements');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."section_access" AS ENUM('free', 'restricted');--> statement-breakpoint
CREATE TABLE "adminAllowlist" (
	"email" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'SUPER_ADMIN' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_allowlist_role_check" CHECK ("adminAllowlist"."role" = 'SUPER_ADMIN')
);
--> statement-breakpoint
CREATE TABLE "adminNotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"note" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"createdBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"imageMediaId" uuid,
	"rarity" "badge_rarity" DEFAULT 'common' NOT NULL,
	"color" text,
	"sectionId" uuid,
	"criteria" jsonb,
	"mode" "grant_mode" DEFAULT 'manual' NOT NULL,
	"isPublished" boolean DEFAULT false NOT NULL,
	"isRepeatable" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "badges_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "challengeModeration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participantId" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"actorUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challengeResults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challengeId" integer NOT NULL,
	"participantId" integer NOT NULL,
	"score" integer NOT NULL,
	"rank" integer,
	"isWinner" boolean DEFAULT false NOT NULL,
	"approvedBy" text,
	"approvedAt" timestamp with time zone,
	"rewardGrantedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_results_score_rank_check" CHECK ("challengeResults"."score" >= 0 and ("challengeResults"."rank" is null or "challengeResults"."rank" > 0))
);
--> statement-breakpoint
CREATE TABLE "challengeSettings" (
	"challengeId" integer PRIMARY KEY NOT NULL,
	"sectionId" uuid,
	"imageMediaId" uuid,
	"lifecycle" "challenge_lifecycle" DEFAULT 'draft' NOT NULL,
	"competitionType" text DEFAULT 'progress' NOT NULL,
	"participationRules" jsonb,
	"minimumParticipants" integer DEFAULT 1 NOT NULL,
	"maximumParticipants" integer,
	"scoringRules" jsonb,
	"winningRules" jsonb,
	"prizeBadgeId" uuid,
	"winnerCount" integer DEFAULT 1 NOT NULL,
	"updatedBy" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_settings_participants_winners_check" CHECK ("challengeSettings"."minimumParticipants" > 0 and ("challengeSettings"."maximumParticipants" is null or "challengeSettings"."maximumParticipants" >= "challengeSettings"."minimumParticipants") and "challengeSettings"."winnerCount" > 0)
);
--> statement-breakpoint
CREATE TABLE "contentPrerequisites" (
	"contentId" uuid NOT NULL,
	"prerequisiteId" uuid NOT NULL,
	CONSTRAINT "contentPrerequisites_contentId_prerequisiteId_unique" UNIQUE("contentId","prerequisiteId"),
	CONSTRAINT "content_prerequisites_not_self_check" CHECK ("contentPrerequisites"."contentId" <> "contentPrerequisites"."prerequisiteId")
);
--> statement-breakpoint
CREATE TABLE "educationalSections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"shortDescription" text,
	"fullDescription" text,
	"iconMediaId" uuid,
	"imageMediaId" uuid,
	"color" text,
	"ageRange" text,
	"targetLevel" text,
	"unlockRules" jsonb,
	"access" "section_access" DEFAULT 'free' NOT NULL,
	"status" "publication_status" DEFAULT 'draft' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "educationalSections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "educational_sections_order_check" CHECK ("educationalSections"."sortOrder" >= 0)
);
--> statement-breakpoint
CREATE TABLE "levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rank" integer NOT NULL,
	"minimumPoints" integer DEFAULT 0 NOT NULL,
	"color" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "levels_rank_points_check" CHECK ("levels"."rank" > 0 and "levels"."minimumPoints" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pathname" text NOT NULL,
	"originalName" text NOT NULL,
	"mediaType" text NOT NULL,
	"sizeBytes" integer NOT NULL,
	"altText" text,
	"storageProvider" text DEFAULT 'vercel-blob' NOT NULL,
	"uploadedBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "media_pathname_unique" UNIQUE("pathname"),
	CONSTRAINT "media_size_check" CHECK ("media"."sizeBytes" > 0 and "media"."sizeBytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "promotionRuleExecutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruleId" uuid NOT NULL,
	"userId" text NOT NULL,
	"sourceKey" text DEFAULT 'once' NOT NULL,
	"beforeLevelId" integer,
	"afterLevelId" integer,
	"executedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotionRules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"conditionType" "promotion_condition" NOT NULL,
	"conditionValue" jsonb NOT NULL,
	"sectionId" uuid,
	"actionType" text DEFAULT 'promote_level' NOT NULL,
	"targetLevelId" integer,
	"startsAt" timestamp with time zone,
	"isActive" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"retrospective" boolean DEFAULT false NOT NULL,
	"createdBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_rules_priority_check" CHECK ("promotionRules"."priority" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "sectionContents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sectionId" uuid NOT NULL,
	"parentId" uuid,
	"kind" "content_kind" NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"body" jsonb,
	"mediaId" uuid,
	"targetLevel" text,
	"points" integer DEFAULT 0 NOT NULL,
	"passingScore" integer,
	"status" "publication_status" DEFAULT 'draft' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"publishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "section_contents_score_points_check" CHECK ("sectionContents"."points" >= 0 and ("sectionContents"."passingScore" is null or "sectionContents"."passingScore" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "siteContent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"group" text DEFAULT 'general' NOT NULL,
	"title" text,
	"content" jsonb NOT NULL,
	"status" "publication_status" DEFAULT 'draft' NOT NULL,
	"isVisible" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updatedBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "siteContent_key_unique" UNIQUE("key"),
	CONSTRAINT "site_content_version_check" CHECK ("siteContent"."version" > 0),
	CONSTRAINT "site_content_dates_check" CHECK ("siteContent"."endsAt" is null or "siteContent"."startsAt" is null or "siteContent"."endsAt" > "siteContent"."startsAt")
);
--> statement-breakpoint
CREATE TABLE "userActivities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"activityType" text NOT NULL,
	"entityType" text,
	"entityId" text,
	"durationSeconds" integer,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_activities_duration_check" CHECK ("userActivities"."durationSeconds" is null or "userActivities"."durationSeconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "userAdminProfiles" (
	"userId" text PRIMARY KEY NOT NULL,
	"status" "managed_account_status" DEFAULT 'active' NOT NULL,
	"levelId" integer,
	"suspendedUntil" timestamp with time zone,
	"lastLoginAt" timestamp with time zone,
	"violationCount" integer DEFAULT 0 NOT NULL,
	"updatedBy" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_admin_profiles_violations_check" CHECK ("userAdminProfiles"."violationCount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "userBadges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"badgeId" uuid NOT NULL,
	"repeatKey" text DEFAULT 'singleton' NOT NULL,
	"reason" text,
	"sourceType" text,
	"sourceId" text,
	"grantedBy" text,
	"grantedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revokedAt" timestamp with time zone,
	"revokedBy" text,
	"revokeReason" text
);
--> statement-breakpoint
CREATE TABLE "userContentProgress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"contentId" uuid NOT NULL,
	"status" "progress_status" DEFAULT 'not_started' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastActivityAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	CONSTRAINT "userContentProgress_userId_contentId_unique" UNIQUE("userId","contentId"),
	CONSTRAINT "user_content_progress_values_check" CHECK ("userContentProgress"."progress" between 0 and 100 and ("userContentProgress"."score" is null or "userContentProgress"."score" between 0 and 100) and "userContentProgress"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auditLogs" ADD COLUMN "userAgent" text;--> statement-breakpoint
ALTER TABLE "auditLogs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "auditLogs" ADD COLUMN "requestId" text;--> statement-breakpoint
ALTER TABLE "adminAllowlist" ADD CONSTRAINT "adminAllowlist_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adminNotes" ADD CONSTRAINT "adminNotes_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adminNotes" ADD CONSTRAINT "adminNotes_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_imageMediaId_media_id_fk" FOREIGN KEY ("imageMediaId") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_sectionId_educationalSections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."educationalSections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeModeration" ADD CONSTRAINT "challengeModeration_participantId_challengeParticipants_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."challengeParticipants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeModeration" ADD CONSTRAINT "challengeModeration_actorUserId_user_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeResults" ADD CONSTRAINT "challengeResults_challengeId_challenges_id_fk" FOREIGN KEY ("challengeId") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeResults" ADD CONSTRAINT "challengeResults_participantId_challengeParticipants_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."challengeParticipants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeResults" ADD CONSTRAINT "challengeResults_approvedBy_user_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeSettings" ADD CONSTRAINT "challengeSettings_challengeId_challenges_id_fk" FOREIGN KEY ("challengeId") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeSettings" ADD CONSTRAINT "challengeSettings_sectionId_educationalSections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."educationalSections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeSettings" ADD CONSTRAINT "challengeSettings_imageMediaId_media_id_fk" FOREIGN KEY ("imageMediaId") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeSettings" ADD CONSTRAINT "challengeSettings_prizeBadgeId_badges_id_fk" FOREIGN KEY ("prizeBadgeId") REFERENCES "public"."badges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeSettings" ADD CONSTRAINT "challengeSettings_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contentPrerequisites" ADD CONSTRAINT "contentPrerequisites_contentId_sectionContents_id_fk" FOREIGN KEY ("contentId") REFERENCES "public"."sectionContents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contentPrerequisites" ADD CONSTRAINT "contentPrerequisites_prerequisiteId_sectionContents_id_fk" FOREIGN KEY ("prerequisiteId") REFERENCES "public"."sectionContents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educationalSections" ADD CONSTRAINT "educationalSections_iconMediaId_media_id_fk" FOREIGN KEY ("iconMediaId") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educationalSections" ADD CONSTRAINT "educationalSections_imageMediaId_media_id_fk" FOREIGN KEY ("imageMediaId") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploadedBy_user_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotionRuleExecutions" ADD CONSTRAINT "promotionRuleExecutions_ruleId_promotionRules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."promotionRules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotionRuleExecutions" ADD CONSTRAINT "promotionRuleExecutions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotionRuleExecutions" ADD CONSTRAINT "promotionRuleExecutions_beforeLevelId_levels_id_fk" FOREIGN KEY ("beforeLevelId") REFERENCES "public"."levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotionRuleExecutions" ADD CONSTRAINT "promotionRuleExecutions_afterLevelId_levels_id_fk" FOREIGN KEY ("afterLevelId") REFERENCES "public"."levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotionRules" ADD CONSTRAINT "promotionRules_sectionId_educationalSections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."educationalSections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotionRules" ADD CONSTRAINT "promotionRules_targetLevelId_levels_id_fk" FOREIGN KEY ("targetLevelId") REFERENCES "public"."levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotionRules" ADD CONSTRAINT "promotionRules_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectionContents" ADD CONSTRAINT "sectionContents_sectionId_educationalSections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."educationalSections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectionContents" ADD CONSTRAINT "sectionContents_parentId_sectionContents_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."sectionContents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectionContents" ADD CONSTRAINT "sectionContents_mediaId_media_id_fk" FOREIGN KEY ("mediaId") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteContent" ADD CONSTRAINT "siteContent_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userActivities" ADD CONSTRAINT "userActivities_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userAdminProfiles" ADD CONSTRAINT "userAdminProfiles_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userAdminProfiles" ADD CONSTRAINT "userAdminProfiles_levelId_levels_id_fk" FOREIGN KEY ("levelId") REFERENCES "public"."levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userAdminProfiles" ADD CONSTRAINT "userAdminProfiles_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userBadges" ADD CONSTRAINT "userBadges_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userBadges" ADD CONSTRAINT "userBadges_badgeId_badges_id_fk" FOREIGN KEY ("badgeId") REFERENCES "public"."badges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userBadges" ADD CONSTRAINT "userBadges_grantedBy_user_id_fk" FOREIGN KEY ("grantedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userBadges" ADD CONSTRAINT "userBadges_revokedBy_user_id_fk" FOREIGN KEY ("revokedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userContentProgress" ADD CONSTRAINT "userContentProgress_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userContentProgress" ADD CONSTRAINT "userContentProgress_contentId_sectionContents_id_fk" FOREIGN KEY ("contentId") REFERENCES "public"."sectionContents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_allowlist_email_normalized_unique" ON "adminAllowlist" USING btree (lower(trim("email")));--> statement-breakpoint
CREATE INDEX "admin_notes_user_created_idx" ON "adminNotes" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "badges_section_published_idx" ON "badges" USING btree ("sectionId","isPublished");--> statement-breakpoint
CREATE INDEX "challenge_moderation_participant_idx" ON "challengeModeration" USING btree ("participantId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_results_participant_unique" ON "challengeResults" USING btree ("participantId");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_results_rank_unique" ON "challengeResults" USING btree ("challengeId","rank") WHERE "challengeResults"."rank" is not null;--> statement-breakpoint
CREATE INDEX "challenge_results_leaderboard_idx" ON "challengeResults" USING btree ("challengeId","score");--> statement-breakpoint
CREATE INDEX "challenge_settings_lifecycle_section_idx" ON "challengeSettings" USING btree ("lifecycle","sectionId");--> statement-breakpoint
CREATE INDEX "content_prerequisites_prerequisite_idx" ON "contentPrerequisites" USING btree ("prerequisiteId");--> statement-breakpoint
CREATE INDEX "educational_sections_status_order_idx" ON "educationalSections" USING btree ("status","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "levels_name_unique" ON "levels" USING btree (lower(trim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "levels_rank_unique" ON "levels" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "media_created_at_idx" ON "media" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "media_type_deleted_idx" ON "media" USING btree ("mediaType","deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_rule_executions_once_unique" ON "promotionRuleExecutions" USING btree ("ruleId","userId","sourceKey");--> statement-breakpoint
CREATE INDEX "promotion_rule_executions_user_idx" ON "promotionRuleExecutions" USING btree ("userId","executedAt");--> statement-breakpoint
CREATE INDEX "promotion_rules_active_priority_idx" ON "promotionRules" USING btree ("isActive","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "section_contents_section_slug_unique" ON "sectionContents" USING btree ("sectionId","slug") WHERE "sectionContents"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX "section_contents_section_status_order_idx" ON "sectionContents" USING btree ("sectionId","status","sortOrder");--> statement-breakpoint
CREATE INDEX "section_contents_parent_idx" ON "sectionContents" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "site_content_group_status_order_idx" ON "siteContent" USING btree ("group","status","sortOrder");--> statement-breakpoint
CREATE INDEX "user_activities_user_created_idx" ON "userActivities" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "user_activities_type_created_idx" ON "userActivities" USING btree ("activityType","createdAt");--> statement-breakpoint
CREATE INDEX "user_admin_profiles_status_level_idx" ON "userAdminProfiles" USING btree ("status","levelId");--> statement-breakpoint
CREATE INDEX "user_admin_profiles_last_login_idx" ON "userAdminProfiles" USING btree ("lastLoginAt");--> statement-breakpoint
CREATE UNIQUE INDEX "user_badges_user_badge_repeat_unique" ON "userBadges" USING btree ("userId","badgeId","repeatKey");--> statement-breakpoint
CREATE INDEX "user_badges_badge_active_idx" ON "userBadges" USING btree ("badgeId","revokedAt");--> statement-breakpoint
CREATE INDEX "user_badges_user_granted_idx" ON "userBadges" USING btree ("userId","grantedAt");--> statement-breakpoint
CREATE INDEX "user_content_progress_content_status_idx" ON "userContentProgress" USING btree ("contentId","status");--> statement-breakpoint
CREATE INDEX "user_content_progress_user_activity_idx" ON "userContentProgress" USING btree ("userId","lastActivityAt");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "auditLogs" USING btree ("action","createdAt");
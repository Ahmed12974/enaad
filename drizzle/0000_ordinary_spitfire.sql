CREATE TYPE "public"."attempt_status" AS ENUM('active', 'grading', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."category_scope" AS ENUM('platform', 'user');--> statement-breakpoint
CREATE TYPE "public"."challenge_metric" AS ENUM('words', 'sentences', 'reviews', 'streak');--> statement-breakpoint
CREATE TYPE "public"."challenge_participant_status" AS ENUM('joined', 'active', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."competition_scope" AS ENUM('all', 'en', 'ar', 'math');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'ar');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('joined', 'active', 'grading', 'submitted', 'expired', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."question_source" AS ENUM('en', 'ar', 'math');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'content_editor', 'user_manager', 'competition_manager', 'reward_manager', 'report_viewer', 'admin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text,
	"xpReward" integer DEFAULT 0 NOT NULL,
	"coinReward" integer DEFAULT 0 NOT NULL,
	"requirementType" text NOT NULL,
	"requirementValue" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditLogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actorUserId" text,
	"action" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text,
	"before" jsonb,
	"after" jsonb,
	"ipHash" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"buttonText" text,
	"buttonUrl" text,
	"imagePathname" text,
	"imageMediaType" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"clickCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banners_dates_check" CHECK ("banners"."endsAt" is null or "banners"."startsAt" is null or "banners"."endsAt" > "banners"."startsAt"),
	CONSTRAINT "banners_click_count_check" CHECK ("banners"."clickCount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text,
	"scope" "category_scope" DEFAULT 'user' NOT NULL,
	"name" text NOT NULL,
	"normalizedName" text NOT NULL,
	"slug" text NOT NULL,
	"language" "language" DEFAULT 'en' NOT NULL,
	"description" text,
	"color" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"publicId" uuid DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"challengeId" integer,
	"title" text NOT NULL,
	"certificateNumber" text NOT NULL,
	"blobPathname" text,
	"issuedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revokedAt" timestamp with time zone,
	"revokeReason" text,
	CONSTRAINT "certificates_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "certificates_certificateNumber_unique" UNIQUE("certificateNumber")
);
--> statement-breakpoint
CREATE TABLE "challengeParticipants" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"challengeId" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"status" "challenge_participant_status" DEFAULT 'joined' NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"rewardedAt" timestamp with time zone,
	CONSTRAINT "challengeParticipants_userId_challengeId_unique" UNIQUE("userId","challengeId"),
	CONSTRAINT "challenge_participants_progress_check" CHECK ("challengeParticipants"."progress" >= 0)
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"normalizedTitle" text NOT NULL,
	"description" text NOT NULL,
	"metric" "challenge_metric" NOT NULL,
	"target" integer NOT NULL,
	"xpReward" integer DEFAULT 0 NOT NULL,
	"coinReward" integer DEFAULT 0 NOT NULL,
	"badgeName" text,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_rewards_target_check" CHECK ("challenges"."target" > 0 and "challenges"."xpReward" >= 0 and "challenges"."coinReward" >= 0),
	CONSTRAINT "challenges_dates_check" CHECK ("challenges"."endsAt" is null or "challenges"."startsAt" is null or "challenges"."endsAt" > "challenges"."startsAt")
);
--> statement-breakpoint
CREATE TABLE "competitionCategories" (
	"competitionId" integer NOT NULL,
	"categoryId" integer NOT NULL,
	CONSTRAINT "competitionCategories_competitionId_categoryId_unique" UNIQUE("competitionId","categoryId")
);
--> statement-breakpoint
CREATE TABLE "competitionParticipants" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"competitionId" integer NOT NULL,
	"status" "participant_status" DEFAULT 'joined' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"correctAnswers" integer DEFAULT 0 NOT NULL,
	"answers" jsonb,
	"xpAwarded" boolean DEFAULT false NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"startedAt" timestamp with time zone,
	"submittedAt" timestamp with time zone,
	"rewardedAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitionParticipants_userId_competitionId_unique" UNIQUE("userId","competitionId"),
	CONSTRAINT "competition_participants_score_check" CHECK ("competitionParticipants"."score" between 0 and 100 and "competitionParticipants"."correctAnswers" >= 0)
);
--> statement-breakpoint
CREATE TABLE "competitionQuestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participantId" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"source" "question_source" NOT NULL,
	"wordId" integer,
	"mathQuestionId" integer,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correctAnswer" text NOT NULL,
	CONSTRAINT "competition_questions_source_fk_check" CHECK (("competitionQuestions"."source" = 'math' and "competitionQuestions"."mathQuestionId" is not null and "competitionQuestions"."wordId" is null) or ("competitionQuestions"."source" in ('en','ar') and "competitionQuestions"."wordId" is not null and "competitionQuestions"."mathQuestionId" is null))
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"normalizedTitle" text NOT NULL,
	"description" text NOT NULL,
	"scope" "competition_scope" DEFAULT 'math' NOT NULL,
	"sectionId" integer,
	"questionCount" integer DEFAULT 10 NOT NULL,
	"xpReward" integer DEFAULT 100 NOT NULL,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_normalizedTitle_unique" UNIQUE("normalizedTitle"),
	CONSTRAINT "competitions_question_reward_check" CHECK ("competitions"."questionCount" between 1 and 30 and "competitions"."xpReward" >= 0),
	CONSTRAINT "competitions_dates_check" CHECK ("competitions"."endsAt" is null or "competitions"."startsAt" is null or "competitions"."endsAt" > "competitions"."startsAt")
);
--> statement-breakpoint
CREATE TABLE "encouragementMessages" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"minProgress" integer DEFAULT 0 NOT NULL,
	"maxProgress" integer DEFAULT 100 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encouragement_progress_range_check" CHECK ("encouragementMessages"."minProgress" between 0 and 100 and "encouragementMessages"."maxProgress" between "encouragementMessages"."minProgress" and 100)
);
--> statement-breakpoint
CREATE TABLE "examples" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"wordId" integer NOT NULL,
	"text" text NOT NULL,
	"translation" text,
	"language" "language" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mathAttemptQuestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"attemptId" integer NOT NULL,
	"questionId" integer NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mathAttempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"sectionId" integer NOT NULL,
	"requestKey" text NOT NULL,
	"status" "attempt_status" DEFAULT 'active' NOT NULL,
	"questionCount" integer NOT NULL,
	"correctAnswers" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"answers" jsonb,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	CONSTRAINT "math_attempts_question_count_check" CHECK ("mathAttempts"."questionCount" between 1 and 30),
	CONSTRAINT "math_attempts_score_check" CHECK ("mathAttempts"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "mathQuestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sectionId" integer NOT NULL,
	"question" text NOT NULL,
	"normalizedQuestion" text NOT NULL,
	"option1" text NOT NULL,
	"option2" text NOT NULL,
	"option3" text NOT NULL,
	"option4" text NOT NULL,
	"correctOption" integer NOT NULL,
	"explanation" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "math_questions_correct_option_check" CHECK ("mathQuestions"."correctOption" between 1 and 4),
	CONSTRAINT "math_questions_distinct_options_check" CHECK ("mathQuestions"."option1" <> "mathQuestions"."option2" and "mathQuestions"."option1" <> "mathQuestions"."option3" and "mathQuestions"."option1" <> "mathQuestions"."option4" and "mathQuestions"."option2" <> "mathQuestions"."option3" and "mathQuestions"."option2" <> "mathQuestions"."option4" and "mathQuestions"."option3" <> "mathQuestions"."option4")
);
--> statement-breakpoint
CREATE TABLE "mathSections" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"normalizedName" text NOT NULL,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mathSections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "mathSections_normalizedName_unique" UNIQUE("normalizedName")
);
--> statement-breakpoint
CREATE TABLE "rateLimit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recoveryTokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"purpose" text NOT NULL,
	"tokenHash" text NOT NULL,
	"targetEmail" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"usedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recoveryTokens_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "rewardLedger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"sourceType" text NOT NULL,
	"sourceId" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_ledger_non_negative_check" CHECK ("rewardLedger"."xp" >= 0 and "rewardLedger"."coins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sentences" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"sentence" text NOT NULL,
	"normalizedSentence" text NOT NULL,
	"translation" text NOT NULL,
	"category" text DEFAULT 'يومية' NOT NULL,
	"isFavorite" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"impersonatedBy" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "testAnswers" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"testId" integer NOT NULL,
	"wordId" integer,
	"question" text NOT NULL,
	"correctAnswer" text NOT NULL,
	"userAnswer" text,
	"isCorrect" boolean NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"attemptId" uuid,
	"source" text NOT NULL,
	"questionMode" text NOT NULL,
	"questionCount" integer NOT NULL,
	"correctAnswers" integer DEFAULT 0 NOT NULL,
	"wrongAnswers" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"completedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"recoveryEmail" text,
	"recoveryEmailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"banReason" text,
	"banExpires" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userAchievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"achievementId" integer NOT NULL,
	"earnedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "userAchievements_userId_achievementId_unique" UNIQUE("userId","achievementId")
);
--> statement-breakpoint
CREATE TABLE "userProgress" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"longestStreak" integer DEFAULT 0 NOT NULL,
	"dailyGoal" integer DEFAULT 10 NOT NULL,
	"weeklyGoal" integer DEFAULT 70 NOT NULL,
	"monthlyGoal" integer DEFAULT 300 NOT NULL,
	"title" text DEFAULT 'Beginner' NOT NULL,
	"lastActiveAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "userProgress_userId_unique" UNIQUE("userId"),
	CONSTRAINT "user_progress_balances_non_negative_check" CHECK ("userProgress"."xp" >= 0 and "userProgress"."coins" >= 0),
	CONSTRAINT "user_progress_goals_positive_check" CHECK ("userProgress"."dailyGoal" > 0 and "userProgress"."weeklyGoal" > 0 and "userProgress"."monthlyGoal" > 0)
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wordQuizAttempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"requestKey" text NOT NULL,
	"mode" text NOT NULL,
	"source" text NOT NULL,
	"language" "language" NOT NULL,
	"questionCount" integer NOT NULL,
	"correctAnswers" integer DEFAULT 0 NOT NULL,
	"wrongAnswers" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"status" "attempt_status" DEFAULT 'active' NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	CONSTRAINT "word_quiz_question_count_check" CHECK ("wordQuizAttempts"."questionCount" between 1 and 50),
	CONSTRAINT "word_quiz_score_check" CHECK ("wordQuizAttempts"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "wordQuizQuestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attemptId" uuid NOT NULL,
	"wordId" integer,
	"ordinal" integer NOT NULL,
	"prompt" text NOT NULL,
	"correctAnswer" text NOT NULL,
	"options" jsonb,
	"example" text,
	"userAnswer" text,
	"isCorrect" boolean,
	"answeredAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"language" "language" DEFAULT 'en' NOT NULL,
	"categoryId" integer,
	"word" text NOT NULL,
	"normalizedWord" text NOT NULL,
	"meaning" text NOT NULL,
	"englishMeaning" text,
	"arabicExplanation" text,
	"englishExplanation" text,
	"synonyms" text[] DEFAULT '{}' NOT NULL,
	"antonyms" text[] DEFAULT '{}' NOT NULL,
	"arabicExample" text,
	"englishExample" text,
	"category" text DEFAULT 'عام' NOT NULL,
	"topic" text,
	"level" text DEFAULT 'A1' NOT NULL,
	"difficulty" text DEFAULT 'easy' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"isFavorite" boolean DEFAULT false NOT NULL,
	"mistakeCount" integer DEFAULT 0 NOT NULL,
	"correctCount" integer DEFAULT 0 NOT NULL,
	"correctStreak" integer DEFAULT 0 NOT NULL,
	"reviewCount" integer DEFAULT 0 NOT NULL,
	"intervalDays" integer DEFAULT 0 NOT NULL,
	"easeFactor" integer DEFAULT 250 NOT NULL,
	"nextReviewAt" timestamp with time zone,
	"lastMistakeAt" timestamp with time zone,
	"lastReviewedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "words_non_negative_counts_check" CHECK ("words"."mistakeCount" >= 0 and "words"."correctCount" >= 0 and "words"."correctStreak" >= 0 and "words"."reviewCount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditLogs" ADD CONSTRAINT "auditLogs_actorUserId_user_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_challengeId_challenges_id_fk" FOREIGN KEY ("challengeId") REFERENCES "public"."challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeParticipants" ADD CONSTRAINT "challengeParticipants_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challengeParticipants" ADD CONSTRAINT "challengeParticipants_challengeId_challenges_id_fk" FOREIGN KEY ("challengeId") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitionCategories" ADD CONSTRAINT "competitionCategories_competitionId_competitions_id_fk" FOREIGN KEY ("competitionId") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitionCategories" ADD CONSTRAINT "competitionCategories_categoryId_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitionParticipants" ADD CONSTRAINT "competitionParticipants_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitionParticipants" ADD CONSTRAINT "competitionParticipants_competitionId_competitions_id_fk" FOREIGN KEY ("competitionId") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitionQuestions" ADD CONSTRAINT "competitionQuestions_participantId_competitionParticipants_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."competitionParticipants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitionQuestions" ADD CONSTRAINT "competitionQuestions_wordId_words_id_fk" FOREIGN KEY ("wordId") REFERENCES "public"."words"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitionQuestions" ADD CONSTRAINT "competitionQuestions_mathQuestionId_mathQuestions_id_fk" FOREIGN KEY ("mathQuestionId") REFERENCES "public"."mathQuestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sectionId_mathSections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."mathSections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examples" ADD CONSTRAINT "examples_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examples" ADD CONSTRAINT "examples_wordId_words_id_fk" FOREIGN KEY ("wordId") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mathAttemptQuestions" ADD CONSTRAINT "mathAttemptQuestions_attemptId_mathAttempts_id_fk" FOREIGN KEY ("attemptId") REFERENCES "public"."mathAttempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mathAttemptQuestions" ADD CONSTRAINT "mathAttemptQuestions_questionId_mathQuestions_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."mathQuestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mathAttempts" ADD CONSTRAINT "mathAttempts_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mathAttempts" ADD CONSTRAINT "mathAttempts_sectionId_mathSections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."mathSections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mathQuestions" ADD CONSTRAINT "mathQuestions_sectionId_mathSections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."mathSections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recoveryTokens" ADD CONSTRAINT "recoveryTokens_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewardLedger" ADD CONSTRAINT "rewardLedger_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonatedBy_user_id_fk" FOREIGN KEY ("impersonatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testAnswers" ADD CONSTRAINT "testAnswers_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testAnswers" ADD CONSTRAINT "testAnswers_testId_tests_id_fk" FOREIGN KEY ("testId") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testAnswers" ADD CONSTRAINT "testAnswers_wordId_words_id_fk" FOREIGN KEY ("wordId") REFERENCES "public"."words"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_attemptId_wordQuizAttempts_id_fk" FOREIGN KEY ("attemptId") REFERENCES "public"."wordQuizAttempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userAchievements" ADD CONSTRAINT "userAchievements_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userAchievements" ADD CONSTRAINT "userAchievements_achievementId_achievements_id_fk" FOREIGN KEY ("achievementId") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userProgress" ADD CONSTRAINT "userProgress_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordQuizAttempts" ADD CONSTRAINT "wordQuizAttempts_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordQuizQuestions" ADD CONSTRAINT "wordQuizQuestions_attemptId_wordQuizAttempts_id_fk" FOREIGN KEY ("attemptId") REFERENCES "public"."wordQuizAttempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordQuizQuestions" ADD CONSTRAINT "wordQuizQuestions_wordId_words_id_fk" FOREIGN KEY ("wordId") REFERENCES "public"."words"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_categoryId_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_name_unique" ON "achievements" USING btree ("name");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "auditLogs" USING btree ("actorUserId","createdAt");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "auditLogs" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "banners_active_order_idx" ON "banners" USING btree ("isActive","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_category_language_slug_unique" ON "categories" USING btree ("language","slug") WHERE "categories"."scope" = 'platform' and "categories"."userId" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_category_language_name_unique" ON "categories" USING btree ("userId","language","normalizedName") WHERE "categories"."scope" = 'user' and "categories"."userId" is not null;--> statement-breakpoint
CREATE INDEX "categories_scope_language_active_idx" ON "categories" USING btree ("scope","language","isActive","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_user_challenge_unique" ON "certificates" USING btree ("userId","challengeId");--> statement-breakpoint
CREATE INDEX "certificates_public_id_idx" ON "certificates" USING btree ("publicId");--> statement-breakpoint
CREATE INDEX "challenge_participants_challenge_status_idx" ON "challengeParticipants" USING btree ("challengeId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_normalized_title_unique" ON "challenges" USING btree ("normalizedTitle");--> statement-breakpoint
CREATE INDEX "challenges_active_dates_idx" ON "challenges" USING btree ("isActive","startsAt","endsAt");--> statement-breakpoint
CREATE INDEX "competition_categories_category_idx" ON "competitionCategories" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "competition_participants_competition_score_idx" ON "competitionParticipants" USING btree ("competitionId","score","correctAnswers");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_questions_participant_ordinal_unique" ON "competitionQuestions" USING btree ("participantId","ordinal");--> statement-breakpoint
CREATE INDEX "competition_questions_participant_idx" ON "competitionQuestions" USING btree ("participantId");--> statement-breakpoint
CREATE INDEX "competitions_active_dates_idx" ON "competitions" USING btree ("isActive","startsAt","endsAt");--> statement-breakpoint
CREATE INDEX "examples_word_id_idx" ON "examples" USING btree ("wordId");--> statement-breakpoint
CREATE INDEX "examples_user_id_idx" ON "examples" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "math_attempt_question_unique" ON "mathAttemptQuestions" USING btree ("attemptId","questionId");--> statement-breakpoint
CREATE UNIQUE INDEX "math_attempt_ordinal_unique" ON "mathAttemptQuestions" USING btree ("attemptId","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "math_attempts_user_request_unique" ON "mathAttempts" USING btree ("userId","requestKey");--> statement-breakpoint
CREATE INDEX "math_attempts_user_started_idx" ON "mathAttempts" USING btree ("userId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "math_questions_section_question_unique" ON "mathQuestions" USING btree ("sectionId","normalizedQuestion");--> statement-breakpoint
CREATE INDEX "math_questions_section_active_idx" ON "mathQuestions" USING btree ("sectionId","isActive");--> statement-breakpoint
CREATE INDEX "math_sections_active_order_idx" ON "mathSections" USING btree ("isActive","sortOrder");--> statement-breakpoint
CREATE INDEX "recovery_tokens_user_purpose_idx" ON "recoveryTokens" USING btree ("userId","purpose");--> statement-breakpoint
CREATE INDEX "recovery_tokens_expires_at_idx" ON "recoveryTokens" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_ledger_user_source_unique" ON "rewardLedger" USING btree ("userId","sourceType","sourceId");--> statement-breakpoint
CREATE INDEX "reward_ledger_user_created_idx" ON "rewardLedger" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "sentences_user_normalized_unique" ON "sentences" USING btree ("userId","normalizedSentence");--> statement-breakpoint
CREATE INDEX "sentences_user_created_at_idx" ON "sentences" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "test_answers_test_id_idx" ON "testAnswers" USING btree ("testId");--> statement-breakpoint
CREATE INDEX "test_answers_user_id_idx" ON "testAnswers" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "tests_user_completed_at_idx" ON "tests" USING btree ("userId","completedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "tests_attempt_unique" ON "tests" USING btree ("attemptId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_normalized_unique" ON "user" USING btree (lower(trim("email")));--> statement-breakpoint
CREATE UNIQUE INDEX "user_recovery_email_normalized_unique" ON "user" USING btree (lower(trim("recoveryEmail"))) WHERE "user"."recoveryEmail" is not null;--> statement-breakpoint
CREATE INDEX "user_role_idx" ON "user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "user_created_at_idx" ON "user" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "user_achievements_user_idx" ON "userAchievements" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "word_quiz_attempt_user_request_unique" ON "wordQuizAttempts" USING btree ("userId","requestKey");--> statement-breakpoint
CREATE INDEX "word_quiz_attempt_user_started_idx" ON "wordQuizAttempts" USING btree ("userId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "word_quiz_question_attempt_ordinal_unique" ON "wordQuizQuestions" USING btree ("attemptId","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "word_quiz_question_attempt_word_unique" ON "wordQuizQuestions" USING btree ("attemptId","wordId");--> statement-breakpoint
CREATE INDEX "word_quiz_question_attempt_idx" ON "wordQuizQuestions" USING btree ("attemptId");--> statement-breakpoint
CREATE UNIQUE INDEX "words_user_language_normalized_unique" ON "words" USING btree ("userId","language","normalizedWord");--> statement-breakpoint
CREATE INDEX "words_user_language_category_idx" ON "words" USING btree ("userId","language","categoryId");--> statement-breakpoint
CREATE INDEX "words_user_status_review_idx" ON "words" USING btree ("userId","status","nextReviewAt");
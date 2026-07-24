-- In-place upgrade for the schema shipped before migrations existed.
-- The runner wraps this file in one transaction. Any duplicate/orphan/invalid legacy
-- data aborts the migration without deleting or rewriting user-owned records.

DO $migration$ BEGIN CREATE TYPE "user_role" AS ENUM ('user','content_editor','user_manager','competition_manager','reward_manager','report_viewer','admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "language" AS ENUM ('en','ar'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "category_scope" AS ENUM ('platform','user'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "attempt_status" AS ENUM ('active','grading','completed','expired','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "participant_status" AS ENUM ('joined','active','grading','submitted','expired','disqualified'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "challenge_participant_status" AS ENUM ('joined','active','completed','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "challenge_metric" AS ENUM ('words','sentences','reviews','streak'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "competition_scope" AS ENUM ('all','en','ar','math'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN CREATE TYPE "question_source" AS ENUM ('en','ar','math'); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$
DECLARE conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count FROM (
    SELECT lower(btrim(email)) FROM "user" GROUP BY 1 HAVING count(*) > 1
  ) duplicates;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Migration blocked: % duplicate normalized user email group(s). Resolve explicitly; no accounts were changed.', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM (
    SELECT lower(btrim("recoveryEmail")) FROM "user"
    WHERE "recoveryEmail" IS NOT NULL GROUP BY 1 HAVING count(*) > 1
  ) duplicates;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Migration blocked: % duplicate normalized recovery email group(s).', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM "words" WHERE "language" NOT IN ('en','ar');
  IF conflict_count > 0 THEN RAISE EXCEPTION 'Migration blocked: % word row(s) have an invalid language.', conflict_count; END IF;
  SELECT count(*) INTO conflict_count FROM "categories" WHERE "language" NOT IN ('en','ar');
  IF conflict_count > 0 THEN RAISE EXCEPTION 'Migration blocked: % category row(s) have an invalid language.', conflict_count; END IF;
  SELECT count(*) INTO conflict_count FROM "challenges" WHERE "metric" NOT IN ('words','sentences','reviews','streak');
  IF conflict_count > 0 THEN RAISE EXCEPTION 'Migration blocked: % challenge row(s) have an invalid metric.', conflict_count; END IF;
  SELECT count(*) INTO conflict_count FROM "challengeParticipants" WHERE "status" NOT IN ('joined','active','completed','expired');
  IF conflict_count > 0 THEN RAISE EXCEPTION 'Migration blocked: % challenge participant row(s) have an invalid status.', conflict_count; END IF;
  SELECT count(*) INTO conflict_count FROM "competitions" WHERE "scope" NOT IN ('all','en','ar','math');
  IF conflict_count > 0 THEN RAISE EXCEPTION 'Migration blocked: % competition row(s) have an invalid scope.', conflict_count; END IF;
END $migration$;

UPDATE "user" SET email = lower(btrim(email)), "recoveryEmail" = lower(btrim("recoveryEmail")) WHERE email <> lower(btrim(email)) OR ("recoveryEmail" IS NOT NULL AND "recoveryEmail" <> lower(btrim("recoveryEmail")));

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS role "user_role" NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "banReason" text,
  ADD COLUMN IF NOT EXISTS "banExpires" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp with time zone;
CREATE UNIQUE INDEX IF NOT EXISTS user_email_normalized_unique ON "user" (lower(btrim(email)));
CREATE UNIQUE INDEX IF NOT EXISTS user_recovery_email_normalized_unique ON "user" (lower(btrim("recoveryEmail"))) WHERE "recoveryEmail" IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_role_idx ON "user" (role);
CREATE INDEX IF NOT EXISTS user_created_at_idx ON "user" ("createdAt");

ALTER TABLE session ADD COLUMN IF NOT EXISTS "impersonatedBy" text;
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session ("userId");
CREATE INDEX IF NOT EXISTS session_expires_at_idx ON session ("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_account_unique ON account ("providerId", "accountId");
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account ("userId");
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);
CREATE INDEX IF NOT EXISTS verification_expires_at_idx ON verification ("expiresAt");

CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_tokens_user_purpose_idx ON "recoveryTokens" ("userId", purpose);
CREATE INDEX IF NOT EXISTS recovery_tokens_expires_at_idx ON "recoveryTokens" ("expiresAt");

ALTER TABLE categories
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS scope "category_scope" NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "normalizedName" text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone NOT NULL DEFAULT now();
UPDATE categories SET "normalizedName" = lower(btrim(name)), slug = 'legacy-' || id WHERE "normalizedName" IS NULL OR slug IS NULL;
ALTER TABLE categories ALTER COLUMN "normalizedName" SET NOT NULL, ALTER COLUMN slug SET NOT NULL;
ALTER TABLE categories ALTER COLUMN language TYPE "language" USING language::"language";
CREATE UNIQUE INDEX IF NOT EXISTS platform_category_language_slug_unique ON categories (language, slug) WHERE scope = 'platform' AND "userId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_category_language_name_unique ON categories ("userId", language, "normalizedName") WHERE scope = 'user' AND "userId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS categories_scope_language_active_idx ON categories (scope, language, "isActive", "sortOrder");

ALTER TABLE words
  ALTER COLUMN language TYPE "language" USING language::"language",
  ADD COLUMN IF NOT EXISTS "categoryId" integer,
  ADD COLUMN IF NOT EXISTS "intervalDays" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "easeFactor" integer NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS "nextReviewAt" timestamp with time zone;
CREATE UNIQUE INDEX IF NOT EXISTS words_user_language_normalized_unique ON words ("userId", language, "normalizedWord");
CREATE INDEX IF NOT EXISTS words_user_language_category_idx ON words ("userId", language, "categoryId");
CREATE INDEX IF NOT EXISTS words_user_status_review_idx ON words ("userId", status, "nextReviewAt");
CREATE UNIQUE INDEX IF NOT EXISTS sentences_user_normalized_unique ON sentences ("userId", "normalizedSentence");
CREATE INDEX IF NOT EXISTS sentences_user_created_at_idx ON sentences ("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "wordQuizAttempts" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" text NOT NULL,
  "requestKey" text NOT NULL,
  mode text NOT NULL,
  source text NOT NULL,
  language "language" NOT NULL,
  "questionCount" integer NOT NULL,
  "correctAnswers" integer NOT NULL DEFAULT 0,
  "wrongAnswers" integer NOT NULL DEFAULT 0,
  score integer NOT NULL DEFAULT 0,
  status "attempt_status" NOT NULL DEFAULT 'active',
  "startedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "completedAt" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS word_quiz_attempt_user_request_unique ON "wordQuizAttempts" ("userId", "requestKey");
CREATE INDEX IF NOT EXISTS word_quiz_attempt_user_started_idx ON "wordQuizAttempts" ("userId", "startedAt");

CREATE TABLE IF NOT EXISTS "wordQuizQuestions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "attemptId" uuid NOT NULL,
  "wordId" integer,
  ordinal integer NOT NULL,
  prompt text NOT NULL,
  "correctAnswer" text NOT NULL,
  options jsonb,
  example text,
  "userAnswer" text,
  "isCorrect" boolean,
  "answeredAt" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS word_quiz_question_attempt_ordinal_unique ON "wordQuizQuestions" ("attemptId", ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS word_quiz_question_attempt_word_unique ON "wordQuizQuestions" ("attemptId", "wordId");
CREATE INDEX IF NOT EXISTS word_quiz_question_attempt_idx ON "wordQuizQuestions" ("attemptId");

ALTER TABLE tests ADD COLUMN IF NOT EXISTS "attemptId" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS tests_attempt_unique ON tests ("attemptId");
CREATE INDEX IF NOT EXISTS tests_user_completed_at_idx ON tests ("userId", "completedAt");
ALTER TABLE "testAnswers" ALTER COLUMN "wordId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS test_answers_test_id_idx ON "testAnswers" ("testId");
CREATE INDEX IF NOT EXISTS test_answers_user_id_idx ON "testAnswers" ("userId");
CREATE INDEX IF NOT EXISTS examples_word_id_idx ON examples ("wordId");
CREATE INDEX IF NOT EXISTS examples_user_id_idx ON examples ("userId");

CREATE TABLE IF NOT EXISTS "rewardLedger" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" text NOT NULL,
  "sourceType" text NOT NULL,
  "sourceId" text NOT NULL,
  xp integer NOT NULL DEFAULT 0,
  coins integer NOT NULL DEFAULT 0,
  metadata jsonb,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reward_ledger_user_source_unique ON "rewardLedger" ("userId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS reward_ledger_user_created_idx ON "rewardLedger" ("userId", "createdAt");

ALTER TABLE achievements ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS achievements_name_unique ON achievements (name);
ALTER TABLE challenges ALTER COLUMN metric TYPE "challenge_metric" USING metric::"challenge_metric", ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS challenges_normalized_title_unique ON challenges ("normalizedTitle");
CREATE INDEX IF NOT EXISTS challenges_active_dates_idx ON challenges ("isActive", "startsAt", "endsAt");
ALTER TABLE "challengeParticipants" ALTER COLUMN status TYPE "challenge_participant_status" USING status::"challenge_participant_status", ADD COLUMN IF NOT EXISTS "rewardedAt" timestamp with time zone;
CREATE INDEX IF NOT EXISTS challenge_participants_challenge_status_idx ON "challengeParticipants" ("challengeId", status);

ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS "publicId" uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "revokedAt" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "revokeReason" text;
CREATE UNIQUE INDEX IF NOT EXISTS certificates_public_id_unique ON certificates ("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS certificates_user_challenge_unique ON certificates ("userId", "challengeId");

ALTER TABLE banners
  ADD COLUMN IF NOT EXISTS "imageMediaType" text,
  ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "startsAt" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "endsAt" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "clickCount" integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS banners_active_order_idx ON banners ("isActive", "sortOrder");
ALTER TABLE "encouragementMessages" ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS encouragement_messages_message_unique ON "encouragementMessages" (message);
ALTER TABLE "mathSections" ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS math_sections_active_order_idx ON "mathSections" ("isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS math_questions_section_active_idx ON "mathQuestions" ("sectionId", "isActive");

ALTER TABLE "mathAttempts"
  ADD COLUMN IF NOT EXISTS status "attempt_status" NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS "startedAt" timestamp with time zone NOT NULL DEFAULT now(),
  ALTER COLUMN answers DROP NOT NULL,
  ALTER COLUMN answers TYPE jsonb USING NULLIF(btrim(answers), '')::jsonb,
  ALTER COLUMN "completedAt" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS math_attempts_user_request_unique ON "mathAttempts" ("userId", "requestKey");
CREATE INDEX IF NOT EXISTS math_attempts_user_started_idx ON "mathAttempts" ("userId", "startedAt");

CREATE TABLE IF NOT EXISTS "mathAttemptQuestions" (
  id serial PRIMARY KEY,
  "attemptId" integer NOT NULL,
  "questionId" integer NOT NULL,
  ordinal integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS math_attempt_question_unique ON "mathAttemptQuestions" ("attemptId", "questionId");
CREATE UNIQUE INDEX IF NOT EXISTS math_attempt_ordinal_unique ON "mathAttemptQuestions" ("attemptId", ordinal);

ALTER TABLE competitions ALTER COLUMN scope TYPE "competition_scope" USING scope::"competition_scope", ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS competitions_active_dates_idx ON competitions ("isActive", "startsAt", "endsAt");
ALTER TABLE "competitionParticipants"
  ADD COLUMN IF NOT EXISTS status "participant_status" NOT NULL DEFAULT 'joined',
  ADD COLUMN IF NOT EXISTS "startedAt" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "submittedAt" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "rewardedAt" timestamp with time zone;
UPDATE "competitionParticipants" SET status = 'submitted', "startedAt" = COALESCE("startedAt", "joinedAt"), "submittedAt" = COALESCE("submittedAt", "updatedAt") WHERE answers IS NOT NULL;
CREATE INDEX IF NOT EXISTS competition_participants_competition_score_idx ON "competitionParticipants" ("competitionId", score, "correctAnswers");

CREATE TABLE IF NOT EXISTS "competitionCategories" (
  "competitionId" integer NOT NULL,
  "categoryId" integer NOT NULL,
  UNIQUE ("competitionId", "categoryId")
);
CREATE INDEX IF NOT EXISTS competition_categories_category_idx ON "competitionCategories" ("categoryId");

CREATE TABLE IF NOT EXISTS "competitionQuestions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participantId" integer NOT NULL,
  ordinal integer NOT NULL,
  source "question_source" NOT NULL,
  "wordId" integer,
  "mathQuestionId" integer,
  prompt text NOT NULL,
  options jsonb NOT NULL,
  "correctAnswer" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS competition_questions_participant_ordinal_unique ON "competitionQuestions" ("participantId", ordinal);
CREATE INDEX IF NOT EXISTS competition_questions_participant_idx ON "competitionQuestions" ("participantId");

CREATE TABLE IF NOT EXISTS "auditLogs" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorUserId" text,
  action text NOT NULL,
  "entityType" text NOT NULL,
  "entityId" text,
  before jsonb,
  after jsonb,
  "ipHash" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx ON "auditLogs" ("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON "auditLogs" ("entityType", "entityId");

-- Interpret the legacy timestamp-without-time-zone values as UTC (the prior Vercel runtime used UTC).
DO $migration$
DECLARE column_row record;
BEGIN
  FOR column_row IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
      AND table_name = ANY (ARRAY[
        'user','session','account','verification','recoveryTokens','words','sentences','tests','testAnswers',
        'categories','examples','userProgress','achievements','userAchievements','challenges','challengeParticipants',
        'certificates','banners','encouragementMessages','mathSections','mathQuestions','mathAttempts','competitions','competitionParticipants'
      ])
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE timestamp with time zone USING %I AT TIME ZONE ''UTC''', column_row.table_name, column_row.column_name, column_row.column_name);
  END LOOP;
END $migration$;

CREATE OR REPLACE FUNCTION pg_temp.add_lughati_fk(table_name text, constraint_name text, column_name text, referenced_table text, delete_action text)
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  IF delete_action NOT IN ('CASCADE','RESTRICT','SET NULL') THEN RAISE EXCEPTION 'Invalid delete action'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass(format('%I', table_name)) AND conname = constraint_name
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s NOT VALID', table_name, constraint_name, column_name, referenced_table, delete_action);
  END IF;
END $function$;

SELECT pg_temp.add_lughati_fk('session','fk_lughati_session_impersonated_by','impersonatedBy','user','SET NULL');
SELECT pg_temp.add_lughati_fk('recoveryTokens','fk_lughati_recovery_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('categories','fk_lughati_categories_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('words','fk_lughati_words_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('words','fk_lughati_words_category','categoryId','categories','SET NULL');
SELECT pg_temp.add_lughati_fk('sentences','fk_lughati_sentences_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('wordQuizAttempts','fk_lughati_word_attempt_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('wordQuizQuestions','fk_lughati_word_question_attempt','attemptId','wordQuizAttempts','CASCADE');
SELECT pg_temp.add_lughati_fk('wordQuizQuestions','fk_lughati_word_question_word','wordId','words','SET NULL');
SELECT pg_temp.add_lughati_fk('tests','fk_lughati_tests_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('tests','fk_lughati_tests_attempt','attemptId','wordQuizAttempts','SET NULL');
SELECT pg_temp.add_lughati_fk('testAnswers','fk_lughati_test_answers_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('testAnswers','fk_lughati_test_answers_test','testId','tests','CASCADE');
SELECT pg_temp.add_lughati_fk('testAnswers','fk_lughati_test_answers_word','wordId','words','SET NULL');
SELECT pg_temp.add_lughati_fk('examples','fk_lughati_examples_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('examples','fk_lughati_examples_word','wordId','words','CASCADE');
SELECT pg_temp.add_lughati_fk('userProgress','fk_lughati_progress_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('rewardLedger','fk_lughati_rewards_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('userAchievements','fk_lughati_user_achievements_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('userAchievements','fk_lughati_user_achievements_achievement','achievementId','achievements','CASCADE');
SELECT pg_temp.add_lughati_fk('challengeParticipants','fk_lughati_challenge_participant_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('challengeParticipants','fk_lughati_challenge_participant_challenge','challengeId','challenges','CASCADE');
SELECT pg_temp.add_lughati_fk('certificates','fk_lughati_certificate_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('certificates','fk_lughati_certificate_challenge','challengeId','challenges','RESTRICT');
SELECT pg_temp.add_lughati_fk('mathQuestions','fk_lughati_math_question_section','sectionId','mathSections','RESTRICT');
SELECT pg_temp.add_lughati_fk('mathAttempts','fk_lughati_math_attempt_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('mathAttempts','fk_lughati_math_attempt_section','sectionId','mathSections','RESTRICT');
SELECT pg_temp.add_lughati_fk('mathAttemptQuestions','fk_lughati_math_attempt_question_attempt','attemptId','mathAttempts','CASCADE');
SELECT pg_temp.add_lughati_fk('mathAttemptQuestions','fk_lughati_math_attempt_question_question','questionId','mathQuestions','RESTRICT');
SELECT pg_temp.add_lughati_fk('competitions','fk_lughati_competition_section','sectionId','mathSections','RESTRICT');
SELECT pg_temp.add_lughati_fk('competitionCategories','fk_lughati_competition_category_competition','competitionId','competitions','CASCADE');
SELECT pg_temp.add_lughati_fk('competitionCategories','fk_lughati_competition_category_category','categoryId','categories','RESTRICT');
SELECT pg_temp.add_lughati_fk('competitionParticipants','fk_lughati_competition_participant_user','userId','user','CASCADE');
SELECT pg_temp.add_lughati_fk('competitionParticipants','fk_lughati_competition_participant_competition','competitionId','competitions','CASCADE');
SELECT pg_temp.add_lughati_fk('competitionQuestions','fk_lughati_competition_question_participant','participantId','competitionParticipants','CASCADE');
SELECT pg_temp.add_lughati_fk('competitionQuestions','fk_lughati_competition_question_word','wordId','words','RESTRICT');
SELECT pg_temp.add_lughati_fk('competitionQuestions','fk_lughati_competition_question_math','mathQuestionId','mathQuestions','RESTRICT');
SELECT pg_temp.add_lughati_fk('auditLogs','fk_lughati_audit_actor','actorUserId','user','SET NULL');

DO $migration$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conrelid::regclass AS relation_name, conname
    FROM pg_constraint WHERE conname LIKE 'fk_lughati_%' AND NOT convalidated
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', constraint_row.relation_name, constraint_row.conname);
  END LOOP;
END $migration$;

DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'words_non_negative_counts_check') THEN
    ALTER TABLE words ADD CONSTRAINT words_non_negative_counts_check CHECK ("mistakeCount" >= 0 AND "correctCount" >= 0 AND "correctStreak" >= 0 AND "reviewCount" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_progress_balances_non_negative_check') THEN
    ALTER TABLE "userProgress" ADD CONSTRAINT user_progress_balances_non_negative_check CHECK (xp >= 0 AND coins >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'math_questions_correct_option_check') THEN
    ALTER TABLE "mathQuestions" ADD CONSTRAINT math_questions_correct_option_check CHECK ("correctOption" BETWEEN 1 AND 4) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_ledger_non_negative_check') THEN
    ALTER TABLE "rewardLedger" ADD CONSTRAINT reward_ledger_non_negative_check CHECK (xp >= 0 AND coins >= 0) NOT VALID;
  END IF;
END $migration$;
ALTER TABLE words VALIDATE CONSTRAINT words_non_negative_counts_check;
ALTER TABLE "userProgress" VALIDATE CONSTRAINT user_progress_balances_non_negative_check;
ALTER TABLE "mathQuestions" VALIDATE CONSTRAINT math_questions_correct_option_check;
ALTER TABLE "rewardLedger" VALIDATE CONSTRAINT reward_ledger_non_negative_check;

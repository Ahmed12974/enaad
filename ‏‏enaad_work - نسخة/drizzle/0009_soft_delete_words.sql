ALTER TABLE words ADD COLUMN IF NOT EXISTS "deletedAt" timestamp with time zone;
DROP INDEX IF EXISTS "words_user_language_normalized_unique";
CREATE UNIQUE INDEX "words_user_language_normalized_unique"
  ON words ("userId", language, "normalizedWord")
  WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "words_user_deleted_idx" ON words ("userId", "deletedAt");

DO $$ BEGIN
  CREATE TYPE "competition_lifecycle" AS ENUM ('draft','scheduled','active','ended','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS lifecycle "competition_lifecycle" NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS rules text,
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "requiresVerifiedEmail" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "coinReward" integer NOT NULL DEFAULT 0;

UPDATE competitions
SET lifecycle = CASE
  WHEN "isActive" = false THEN 'draft'::competition_lifecycle
  WHEN "endsAt" IS NOT NULL AND "endsAt" <= now() THEN 'ended'::competition_lifecycle
  WHEN "startsAt" IS NOT NULL AND "startsAt" > now() THEN 'scheduled'::competition_lifecycle
  ELSE 'active'::competition_lifecycle
END;

ALTER TABLE competitions ALTER COLUMN "isActive" SET DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='competitions_priority_check') THEN
    ALTER TABLE competitions ADD CONSTRAINT competitions_priority_check CHECK (priority > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='competitions_audience_check') THEN
    ALTER TABLE competitions ADD CONSTRAINT competitions_audience_check
      CHECK (audience IN ('all','verified','new_users','existing_users'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='competitions_coin_reward_check') THEN
    ALTER TABLE competitions ADD CONSTRAINT competitions_coin_reward_check CHECK ("coinReward" >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "competitionMathSections" (
  "competitionId" integer NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  "sectionId" integer NOT NULL REFERENCES "mathSections"(id) ON DELETE RESTRICT,
  CONSTRAINT "competitionMathSections_competitionId_sectionId_unique" UNIQUE ("competitionId", "sectionId")
);

INSERT INTO "competitionMathSections" ("competitionId", "sectionId")
SELECT id, "sectionId" FROM competitions WHERE "sectionId" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS competition_math_sections_section_idx
  ON "competitionMathSections" ("sectionId");
DROP INDEX IF EXISTS competitions_active_dates_idx;
CREATE INDEX IF NOT EXISTS competitions_active_dates_idx
  ON competitions (lifecycle, "isActive", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS competitions_priority_idx
  ON competitions (priority, "createdAt");

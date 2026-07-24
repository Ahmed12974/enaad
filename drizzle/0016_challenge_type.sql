UPDATE "challengeSettings"
SET "competitionType" = 'progress'
WHERE "competitionType" NOT IN ('progress','speed','accuracy','streak');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='challenge_settings_competition_type_check') THEN
    ALTER TABLE "challengeSettings" ADD CONSTRAINT challenge_settings_competition_type_check
      CHECK ("competitionType" IN ('progress','speed','accuracy','streak'));
  END IF;
END $$;
